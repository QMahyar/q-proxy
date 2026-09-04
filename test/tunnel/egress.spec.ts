import { afterEach, describe, expect, it, vi } from "vitest";
import { createEgressOpener, makeFailoverStrategy, openEgressWithSpeculativeDirect } from "../../src/tunnel/egress";
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
    return { target: TARGET, candidates };
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

  it("caps a walk of hanging dials at the total budget instead of per-candidate timeouts", async () => {
    const hanging = vi.fn(async (): Promise<Socket> => new Promise<Socket>(() => {}));
    const opener = createEgressOpener(
      strategyOf([
        { via: "direct", label: "first", host: "a", port: 1 },
        { via: "proxyip", label: "second", host: "b", port: 2 },
        { via: "proxyip", label: "third", host: "c", port: 3 },
        { via: "proxyip", label: "fourth", host: "d", port: 4 },
        { via: "proxyip", label: "fifth", host: "e", port: 5 },
      ]),
      hanging,
      { dialTimeoutMs: 2000, totalBudgetMs: 300 },
    );
    const start = Date.now();
    await expect(opener.open(TARGET, null)).rejects.toThrow("all egress candidates failed");
    expect(Date.now() - start).toBeLessThan(5000);
    expect(hanging).not.toHaveBeenCalledTimes(5);
  });

  it("bounds retry walks with the same total budget", async () => {
    const good = fakeSocket();
    const calls: string[] = [];
    const dialImpl = vi.fn(async (candidate: EgressCandidate): Promise<Socket> => {
      calls.push(candidate.label);
      if (candidate.label === "first") return good.socket;
      return new Promise<Socket>(() => {});
    });
    const opener = createEgressOpener(
      strategyOf([
        { via: "direct", label: "first", host: "a", port: 1 },
        { via: "proxyip", label: "second", host: "b", port: 2 },
        { via: "proxyip", label: "third", host: "c", port: 3 },
        { via: "proxyip", label: "fourth", host: "d", port: 4 },
      ]),
      dialImpl,
      { dialTimeoutMs: 2000, totalBudgetMs: 200 },
    );
    await opener.open(TARGET, null);
    const start = Date.now();
    await expect(opener.retry(TARGET, null)).resolves.toBeNull();
    expect(Date.now() - start).toBeLessThan(5000);
    expect(calls).toContain("second");
    expect(calls).not.toContain("fourth");
  });
});

describe("openEgressWithSpeculativeDirect", () => {
  it("starts the direct dial before DNS expansion finishes and still prefers direct", async () => {
    let resolveFetch!: (res: Response) => void;
    const fetchGate = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(async () => fetchGate);
    vi.stubGlobal("fetch", fetchMock);
    const s = makeTestSettings({ proxyIpMode: "proxyip", proxyIps: ["proxy.example.com"] });
    const sock = fakeSocket();
    const seen: string[] = [];
    const dialImpl = vi.fn(async (candidate: EgressCandidate): Promise<Socket> => {
      seen.push(`${candidate.via}:${candidate.host}:${candidate.port}`);
      if (candidate.via === "direct") return sock.socket;
      return new Promise<Socket>(() => {});
    });
    const pending = openEgressWithSpeculativeDirect(s, TARGET, null, dialImpl);
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).toHaveBeenCalled();
    expect(dialImpl).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([`direct:${TARGET.host}:${TARGET.port}`]);
    resolveFetch(new Response(new Uint8Array([0, 1, 2])));
    const { established, opener } = await pending;
    expect(established.via).toBe("direct");
    expect(established.candidateIndex).toBe(0);
    expect(established.strategy.candidates[0]).toMatchObject({ via: "direct" });
    expect(opener).toBeDefined();
  });

  it("keeps chain first and closes the unused speculative direct socket", async () => {
    const s = makeTestSettings({
      chainProxy: { enabled: true, uri: "socks5://u:p@chain.example:1080" },
      proxyIpMode: "proxyip",
      proxyIps: ["1.1.1.1"],
    });
    const chainSock = fakeSocket();
    let directClosed = false;
    const directSock = fakeSocket();
    directSock.socket.close = async () => {
      directClosed = true;
    };
    const dialImpl = vi.fn(async (candidate: EgressCandidate): Promise<Socket> => {
      if (candidate.via === "chain") return chainSock.socket;
      if (candidate.via === "direct") return directSock.socket;
      throw new Error(`dial refused ${candidate.label}`);
    });
    const { established } = await openEgressWithSpeculativeDirect(s, TARGET, null, dialImpl);
    expect(established.via).toBe("chain");
    expect(established.candidateIndex).toBe(0);
    expect(established.strategy.candidates.map((c) => c.via)).toEqual(["chain", "direct", "proxyip"]);
    await Promise.resolve();
    expect(directClosed).toBe(true);
  });

  it("omits direct for blocked hosts and never dials it", async () => {
    const s = makeTestSettings({ proxyIpMode: "proxyip", proxyIps: ["93.184.216.34"] });
    const target: DialTarget = { host: "10.0.0.5", port: 80 };
    const sock = fakeSocket();
    const dialImpl = vi.fn(async (_candidate: EgressCandidate): Promise<Socket> => sock.socket);
    const { established } = await openEgressWithSpeculativeDirect(s, target, null, dialImpl);
    expect(established.strategy.candidates.some((c) => c.via === "direct")).toBe(false);
    expect(dialImpl.mock.calls.some(([c]) => c?.via === "direct")).toBe(false);
    expect(established.via).toBe("proxyip");
  });
});
