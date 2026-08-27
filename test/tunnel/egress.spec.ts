import { afterEach, describe, expect, it, vi } from "vitest";
import { createEgressOpener, makeFailoverStrategy } from "../../src/tunnel/egress";
import { clearResolverCache } from "../../src/tunnel/resolver";
import type { DialTarget, EgressCandidate, Socket } from "../../src/types/tunnel";
import { equalsBytes } from "../../src/utils/bytes";
import { makeTestSettings } from "../helpers/settings";

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock("cloudflare:sockets", () => ({
  connect: connectMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  clearResolverCache();
  connectMock.mockReset();
});

function fakeSocket(): { socket: Socket; writes: Uint8Array[] } {
  const writes: Uint8Array[] = [];
  const socket: Socket = {
    readable: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
    writable: new WritableStream<Uint8Array>({
      write: (chunk) => {
        writes.push(chunk);
      },
    }),
    close: async () => {},
  };
  return { socket, writes };
}

const TARGET: DialTarget = { host: "dest.example.com", port: 443 };

describe("makeFailoverStrategy", () => {
  it("orders chain first, then direct, then proxyip candidates", async () => {
    const s = makeTestSettings({
      chainProxy: { enabled: true, uri: "socks5://u:p@chain.example:1080" },
      proxyIpMode: "proxyip",
      proxyIps: ["1.1.1.1", "2.2.2.2"],
    });
    const strategy = await makeFailoverStrategy(s, TARGET);
    expect(strategy.candidates.map((c) => c.via)).toEqual(["chain", "direct", "proxyip", "proxyip"]);
    expect(strategy.candidates[0]).toMatchObject({ host: "chain.example", port: 1080 });
    expect(strategy.candidates[1]).toMatchObject({ host: TARGET.host, port: TARGET.port });
    expect(strategy.hasNext(strategy.candidates.length - 1)).toBe(false);
    expect(strategy.hasNext(0)).toBe(true);
  });

  it("omits direct for Cloudflare IP targets", async () => {
    const s = makeTestSettings({
      proxyIpMode: "proxyip",
      proxyIps: ["1.1.1.1"],
    });
    const strategy = await makeFailoverStrategy(s, { host: "104.16.132.229", port: 443 });
    expect(strategy.candidates.some((c) => c.via === "direct")).toBe(false);
  });

  it("omits direct for localhost and private targets", async () => {
    const s = makeTestSettings({ proxyIpMode: "proxyip", proxyIps: [] });
    for (const host of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "::1", "localhost"]) {
      const strategy = await makeFailoverStrategy(s, { host, port: 80 });
      expect(strategy.candidates.some((c) => c.via === "direct"), host).toBe(false);
    }
  });

  it("keeps direct for ordinary domains and public IPs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }), { status: 200 })),
    );
    const s = makeTestSettings({ proxyIpMode: "nat64" });
    const domainStrategy = await makeFailoverStrategy(s, TARGET);
    expect(domainStrategy.candidates[0]!.via).toBe("direct");
    const ipStrategy = await makeFailoverStrategy(s, { host: "93.184.216.34", port: 443 });
    expect(ipStrategy.candidates[0]!.via).toBe("direct");
  });

  it("synthesizes one nat64 candidate per prefix with the target port", async () => {
    const s = makeTestSettings({ proxyIpMode: "nat64" });
    const strategy = await makeFailoverStrategy(s, { host: "1.2.3.4", port: 8443 });
    const nat64 = strategy.candidates.filter((c) => c.via === "nat64");
    expect(nat64.length).toBe(s.nat64Prefixes.length);
    for (const candidate of nat64) expect(candidate.port).toBe(8443);
    for (const prefix of s.nat64Prefixes) {
      const bare = prefix.replace(/^\[|\]$/g, "");
      expect(nat64.some((c) => c.host.startsWith(bare.replace(/:+$/, "")) || c.label.includes(prefix))).toBe(true);
    }
  });

  it("shuffles the proxyip pool deterministically per target and caps at 8", async () => {
    const pool = Array.from({ length: 12 }, (_, i) => `${10 + i}.0.0.${i + 1}`);
    const s = makeTestSettings({ proxyIpMode: "proxyip", proxyIps: pool });
    const a = await makeFailoverStrategy(s, TARGET);
    const b = await makeFailoverStrategy(s, TARGET);
    const proxyA = a.candidates.filter((c) => c.via === "proxyip").map((c) => c.host);
    const proxyB = b.candidates.filter((c) => c.via === "proxyip").map((c) => c.host);
    expect(proxyA).toEqual(proxyB);
    expect(proxyA.length).toBe(8);
    expect(new Set(proxyA).size).toBe(8);
    const otherTarget = await makeFailoverStrategy(s, { host: "other.example.com", port: 443 });
    const proxyOther = otherTarget.candidates.filter((c: EgressCandidate) => c.via === "proxyip").map((c) => c.host);
    expect(proxyOther).toHaveLength(8);
    const poolSet = new Set(pool);
    expect(proxyOther.every((h) => poolSet.has(h))).toBe(true);
  });

  it("skips chain candidates when disabled or unparseable", async () => {
    const off = makeTestSettings({ chainProxy: { enabled: false, uri: "socks5://h:1080" } });
    expect((await makeFailoverStrategy(off, TARGET)).candidates.some((c) => c.via === "chain")).toBe(false);
    const bad = makeTestSettings({ chainProxy: { enabled: true, uri: "ftp://nope" } });
    expect((await makeFailoverStrategy(bad, TARGET)).candidates.some((c) => c.via === "chain")).toBe(false);
  });

  it("keeps direct when its host:port collides with the chain candidate", async () => {
    const s = makeTestSettings({
      chainProxy: { enabled: true, uri: "socks5://dest.example.com:443" },
      proxyIpMode: "proxyip",
      proxyIps: ["93.184.216.34"],
    });
    const strategy = await makeFailoverStrategy(s, TARGET);
    expect(strategy.candidates.map((c) => `${c.via}:${c.host}:${c.port}`)).toEqual([
      "chain:dest.example.com:443",
      "direct:dest.example.com:443",
      "proxyip:93.184.216.34:443",
    ]);
  });

  it("still dedupes duplicate non-direct candidates by host:port", async () => {
    const s = makeTestSettings({
      chainProxy: { enabled: true, uri: "socks5://93.184.216.34:443" },
      proxyIpMode: "proxyip",
      proxyIps: ["93.184.216.34"],
    });
    const strategy = await makeFailoverStrategy(s, TARGET);
    expect(strategy.candidates.map((c) => `${c.via}:${c.host}:${c.port}`)).toEqual([
      "chain:93.184.216.34:443",
      "direct:dest.example.com:443",
    ]);
  });

  it("drops nat64 candidates whose resolved ipv4 is private or Cloudflare-owned", async () => {
    const s = makeTestSettings({ proxyIpMode: "nat64" });
    const privateStrategy = await makeFailoverStrategy(s, { host: "10.1.2.3", port: 443 });
    expect(privateStrategy.candidates.filter((c) => c.via === "nat64")).toHaveLength(0);
    const cfStrategy = await makeFailoverStrategy(s, { host: "104.16.132.229", port: 443 });
    expect(cfStrategy.candidates.filter((c) => c.via === "nat64")).toHaveLength(0);
    const publicStrategy = await makeFailoverStrategy(s, { host: "1.2.3.4", port: 443 });
    expect(publicStrategy.candidates.filter((c) => c.via === "nat64")).toHaveLength(s.nat64Prefixes.length);
  });
});

describe("createEgressOpener", () => {
  function strategyOf(candidates: EgressCandidate[]) {
    const target = TARGET;
    return {
      target,
      candidates,
      hasNext: (i: number) => i + 1 < candidates.length,
    };
  }

  it("walks candidates sequentially until one dials", async () => {
    const attempts: string[] = [];
    const good = fakeSocket();
    const firstPacket = new Uint8Array([1, 2, 3]);
    const dialImpl = vi.fn(async (candidate: EgressCandidate, _t: DialTarget, fp: Uint8Array | null): Promise<Socket> => {
      attempts.push(candidate.label);
      if (candidate.label === "second") {
        if (fp !== null && fp.length > 0) {
          const writer = good.socket.writable.getWriter();
          await writer.write(fp);
          writer.releaseLock();
        }
        return good.socket;
      }
      throw new Error(`dial refused ${candidate.label}`);
    });
    const opener = createEgressOpener(
      strategyOf([
        { via: "direct", label: "first", host: "a", port: 1 },
        { via: "proxyip", label: "second", host: "b", port: 2 },
        { via: "proxyip", label: "third", host: "c", port: 3 },
      ]),
      dialImpl,
    );
    const established = await opener.open(TARGET, firstPacket);
    expect(attempts).toEqual(["first", "second"]);
    expect(established.candidateIndex).toBe(1);
    expect(established.via).toBe("proxyip");
    expect(good.writes).toHaveLength(1);
    expect(equalsBytes(good.writes[0]!, firstPacket)).toBe(true);
  });

  it("throws when every candidate fails", async () => {
    const dialImpl = vi.fn(async () => {
      throw new Error("refused");
    });
    const opener = createEgressOpener(
      strategyOf([{ via: "direct", label: "only", host: "a", port: 1 }]),
      dialImpl,
    );
    await expect(opener.open(TARGET, null)).rejects.toThrow("all egress candidates failed");
  });

  it("retry resumes after the last successful index and returns null when exhausted", async () => {
    const attempts: string[] = [];
    const second = fakeSocket();
    const fourth = fakeSocket();
    const dialImpl = vi.fn(async (candidate: EgressCandidate): Promise<Socket> => {
      attempts.push(candidate.label);
      if (candidate.label === "second") return second.socket;
      if (candidate.label === "fourth") return fourth.socket;
      throw new Error(`dial refused ${candidate.label}`);
    });
    const opener = createEgressOpener(
      strategyOf([
        { via: "direct", label: "first", host: "a", port: 1 },
        { via: "proxyip", label: "second", host: "b", port: 2 },
        { via: "proxyip", label: "third", host: "c", port: 3 },
        { via: "nat64", label: "fourth", host: "d", port: 4 },
      ]),
      dialImpl,
    );
    await opener.open(TARGET, null);
    expect(attempts).toEqual(["first", "second"]);
    const retried = await opener.retry(TARGET, null);
    expect(retried).not.toBeNull();
    expect(retried!.candidateIndex).toBe(3);
    expect(retried!.via).toBe("nat64");
    expect(attempts).toEqual(["first", "second", "third", "fourth"]);
    expect(await opener.retry(TARGET, null)).toBeNull();
  });

  it("does not write an empty or null first packet", async () => {
    const sock = fakeSocket();
    const dialImpl = vi.fn(async (): Promise<Socket> => sock.socket);
    const opener = createEgressOpener(
      strategyOf([{ via: "direct", label: "only", host: "a", port: 1 }]),
      dialImpl,
    );
    await opener.open(TARGET, null);
    expect(sock.writes).toHaveLength(0);
  });

  it("times out a hung dial, walks on, and closes sockets that arrive late", async () => {
    vi.useFakeTimers();
    try {
      const closeCalls: number[] = [];
      const dialImpl = vi.fn(async (): Promise<Socket> => {
        return new Promise((resolve) => {
          setTimeout(() => {
            const late = fakeSocket();
            late.socket.close = async () => {
              closeCalls.push(1);
            };
            resolve(late.socket);
          }, 60);
        });
      });
      const opener = createEgressOpener(
        strategyOf([
          { via: "direct", label: "first", host: "a", port: 1 },
          { via: "proxyip", label: "second", host: "b", port: 2 },
        ]),
        dialImpl,
        { dialTimeoutMs: 20 },
      );
      const settled = expect(opener.open(TARGET, null)).rejects.toThrow("all egress candidates failed");
      await vi.advanceTimersByTimeAsync(120);
      await settled;
      expect(dialImpl).toHaveBeenCalledTimes(2);
      expect(closeCalls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the socket when writing the first packet fails on the default dial", async () => {
    let closed = false;
    const socket: Socket = {
      readable: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      writable: new WritableStream<Uint8Array>({
        write: () => {
          throw new Error("write refused");
        },
      }),
      close: async () => {
        closed = true;
      },
    };
    connectMock.mockResolvedValue(socket);
    const opener = createEgressOpener(
      strategyOf([{ via: "direct", label: "only", host: "203.0.113.9", port: 443 }]),
    );
    await expect(opener.open(TARGET, new Uint8Array([1, 2, 3]))).rejects.toThrow("all egress candidates failed");
    expect(closed).toBe(true);
  });
});
