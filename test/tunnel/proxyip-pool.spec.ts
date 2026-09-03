import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRelayEndpointCache,
  collectProxyPool,
  collectProxyPoolDetailed,
  fetchPoolUrl,
  parsePoolEndpoints,
  resolveRelayEndpoints,
  tcpProbe,
} from "../../src/tunnel/proxyip-pool";
import type { DohResolver } from "../../src/tunnel/resolver";
import { clearResolverCache, DNS_TYPE_A } from "../../src/tunnel/resolver";
import type { Socket } from "../../src/types/tunnel";
import { makeTestSettings } from "../helpers/settings";

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock("cloudflare:sockets", () => ({
  connect: connectMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  clearResolverCache();
  clearRelayEndpointCache();
  connectMock.mockReset();
});

function fakeResolver(overrides: Partial<DohResolver> = {}): DohResolver {
  return {
    resolveA: async () => [],
    resolveAAAA: async () => [],
    resolveTXT: async () => [],
    ...overrides,
  };
}

function aRecordingResolver(aCalls: string[], ips: (name: string) => string[]): DohResolver {
  return fakeResolver({
    resolveA: async (name) => {
      aCalls.push(name);
      return ips(name);
    },
  });
}

function encodeName(name: string): Uint8Array {
  const parts = name.split(".");
  let len = 1;
  for (const p of parts) len += p.length + 1;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out[off++] = p.length;
    for (let i = 0; i < p.length; i++) out[off++] = p.charCodeAt(i);
  }
  out[off] = 0;
  return out;
}

function buildDnsResponse(aRecord: [number, number, number, number]): Uint8Array {
  const question = concat(encodeName("relay.example"), new Uint8Array([0, 0]), new Uint8Array([0, 1]));
  const header = new Uint8Array(12);
  header[2] = 0x81;
  header[3] = 0x80;
  header[5] = 1;
  header[7] = 1;
  const answerName = new Uint8Array([0xc0, 0x0c]);
  const fixed = new Uint8Array(10);
  fixed[0] = (DNS_TYPE_A >> 8) & 0xff;
  fixed[1] = DNS_TYPE_A & 0xff;
  fixed[2] = 0;
  fixed[3] = 1;
  fixed[4] = 0;
  fixed[5] = 300;
  fixed[8] = 0;
  fixed[9] = 4;
  const rdata = new Uint8Array(aRecord);
  return concat(header, question, answerName, fixed, rdata);
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function sortedIps(endpoints: { ip: string; port: number }[]): string[] {
  return endpoints.map((e) => `${e.ip}:${e.port}`).sort();
}

describe("fetchPoolUrl", () => {
  it("parses a JSON array of ip:port strings with default port 443", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('["203.0.113.5:8443","203.0.113.6","198.51.100.7"]')),
    );
    const out = await fetchPoolUrl("https://pool.example/list");
    expect(sortedIps(out)).toEqual(["198.51.100.7:443", "203.0.113.5:8443", "203.0.113.6:443"]);
  });

  it("parses newline-separated text, strips quotes, and dedupes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('"203.0.113.7:2053"\r\n203.0.113.8\n203.0.113.8\n\n')),
    );
    const out = await fetchPoolUrl("https://pool.example/list.txt");
    expect(sortedIps(out)).toEqual(["203.0.113.7:2053", "203.0.113.8:443"]);
  });

  it("skips non-string JSON items and malformed tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('["203.0.113.4", 5, null, {"ip":"1.2.3.4"}, "not a host here", "198.51.100.9"]')),
    );
    const out = await fetchPoolUrl("https://pool.example/list");
    expect(sortedIps(out)).toEqual(["198.51.100.9:443", "203.0.113.4:443"]);
  });

  it("dedupes across formats and caps at 64 entries", async () => {
    const items = Array.from({ length: 70 }, (_, i) => `203.0.113.${i + 1}`);
    items.push("203.0.113.1:443", "203.0.113.1");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(items))));
    const out = await fetchPoolUrl("https://pool.example/list");
    expect(out).toHaveLength(64);
    expect(new Set(out.map((e) => `${e.ip}:${e.port}`)).size).toBe(64);
  });

  it("drops private, loopback, link-local, and Cloudflare-owned addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response('["127.0.0.1","10.0.0.7","192.168.1.1","169.254.1.2","::1","104.16.132.229","203.0.113.9"]'),
      ),
    );
    const out = await fetchPoolUrl("https://pool.example/list");
    expect(sortedIps(out)).toEqual(["203.0.113.9:443"]);
  });

  it("returns [] when the upstream fails, the body is garbage, or the URL is not fetchable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("boom")) throw new Error("network down");
        return new Response("~~ ?? ~~", { status: 200 });
      }),
    );
    expect(await fetchPoolUrl("https://pool.example/boom")).toEqual([]);
    expect(await fetchPoolUrl("https://pool.example/garbage")).toEqual([]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchPoolUrl("http://127.0.0.1/pool")).toEqual([]);
    expect(await fetchPoolUrl("ftp://pool.example/list")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("parsePoolEndpoints", () => {
  it("splits on commas and semicolons in plain text mode", () => {
    const out = parsePoolEndpoints("203.0.113.1, 203.0.113.2;198.51.100.3:8443");
    expect(sortedIps(out)).toEqual(["198.51.100.3:8443", "203.0.113.1:443", "203.0.113.2:443"]);
  });

  it("treats bare 1.2.3.4 and 1.2.3.4:443 as the same endpoint", () => {
    expect(parsePoolEndpoints("203.0.113.1\n203.0.113.1:443")).toEqual([{ ip: "203.0.113.1", port: 443 }]);
  });

  it("accepts bracketed IPv6 literals with ports", () => {
    expect(parsePoolEndpoints("[2001:db8::5]:443")).toEqual([{ ip: "2001:db8::5", port: 443 }]);
  });
});

describe("resolveRelayEndpoints", () => {
  it("resolves the colo-prefixed domain and the fallback domain, deduping results", async () => {
    const aCalls: string[] = [];
    const resolver = aRecordingResolver(aCalls, () => ["203.0.113.10", "198.51.100.11"]);
    const out = await resolveRelayEndpoints(makeTestSettings(), "MRS", resolver);
    expect(aCalls).toEqual(["mrs.proxyip.cmliussss.net", "proxyip.tp1.090227.xyz"]);
    expect(sortedIps(out)).toEqual(["198.51.100.11:443", "203.0.113.10:443"]);
  });

  it("uses the bare domain when the colo is empty", async () => {
    const aCalls: string[] = [];
    const resolver = aRecordingResolver(aCalls, () => ["203.0.113.10"]);
    await resolveRelayEndpoints(makeTestSettings(), "", resolver);
    expect(aCalls).toEqual(["proxyip.cmliussss.net", "proxyip.tp1.090227.xyz"]);
  });

  it("caches per colo for ~5 minutes", async () => {
    const aCalls: string[] = [];
    const resolver = aRecordingResolver(aCalls, () => ["203.0.113.10"]);
    const s = makeTestSettings();
    await resolveRelayEndpoints(s, "mrs", resolver);
    await resolveRelayEndpoints(s, "MRS", resolver);
    expect(aCalls).toEqual(["mrs.proxyip.cmliussss.net", "proxyip.tp1.090227.xyz"]);
    await resolveRelayEndpoints(s, "fra", resolver);
    expect(aCalls).toEqual([
      "mrs.proxyip.cmliussss.net",
      "proxyip.tp1.090227.xyz",
      "fra.proxyip.cmliussss.net",
      "proxyip.tp1.090227.xyz",
    ]);
  });

  it("shuffles deterministically and caps at 8 candidates", async () => {
    const ips = Array.from({ length: 12 }, (_, i) => `198.51.100.${i + 1}`);
    const resolver = aRecordingResolver([], () => ips);
    const s = makeTestSettings();
    const first = await resolveRelayEndpoints(s, "mrs", resolver);
    expect(first).toHaveLength(8);
    expect(new Set(first.map((e) => e.ip)).size).toBe(8);
    clearRelayEndpointCache();
    const second = await resolveRelayEndpoints(s, "mrs", resolver);
    expect(second).toEqual(first);
    expect(sortedIps(second).every((k) => ips.map((ip) => `${ip}:443`).includes(k))).toBe(true);
  });

  it("returns [] when DoH yields nothing", async () => {
    const out = await resolveRelayEndpoints(makeTestSettings(), "mrs", fakeResolver());
    expect(out).toEqual([]);
  });
});

describe("collectProxyPool", () => {
  it("merges the user list with the pool URL and dedupes across sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('["203.0.113.1:443","203.0.113.2"]')),
    );
    const s = makeTestSettings({
      proxyIps: ["203.0.113.1:443"],
      proxyIpPoolUrl: "https://pool.example/list",
    });
    const result = await collectProxyPoolDetailed(s, "mrs");
    expect(result.source).toBe("list");
    expect(sortedIps(result.endpoints)).toEqual(["203.0.113.1:443", "203.0.113.2:443"]);
    expect(await collectProxyPool(s, "mrs")).toEqual(result.endpoints);
  });

  it("reports the url source when the user list is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("203.0.113.3\n203.0.113.4:2053")),
    );
    const s = makeTestSettings({ proxyIps: [], proxyIpPoolUrl: "https://pool.example/list" });
    const result = await collectProxyPoolDetailed(s, "mrs");
    expect(result.source).toBe("url");
    expect(sortedIps(result.endpoints)).toEqual(["203.0.113.3:443", "203.0.113.4:2053"]);
  });

  it("falls back to DoH-resolved relay endpoints when both list and URL are empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(buildDnsResponse([203, 0, 113, 10]) as unknown as BodyInit)),
    );
    const s = makeTestSettings({ proxyIps: [], proxyIpPoolUrl: "" });
    const result = await collectProxyPoolDetailed(s, "MRS");
    expect(result.source).toBe("doh");
    expect(result.endpoints).toEqual([{ ip: "203.0.113.10", port: 443 }]);
  });

  it("caps the merged pool at 64 endpoints", async () => {
    const ips = Array.from({ length: 70 }, (_, i) => `203.0.113.${i + 1}`);
    const s = makeTestSettings({ proxyIps: ips });
    const out = await collectProxyPool(s, "mrs");
    expect(out).toHaveLength(64);
  });

  it("resolves domain entries in the user list through the settings DoH upstream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(buildDnsResponse([198, 51, 100, 44]) as unknown as BodyInit)),
    );
    const s = makeTestSettings({ proxyIps: ["pool-list.example"], proxyIpPoolUrl: "" });
    const result = await collectProxyPoolDetailed(s, "mrs");
    expect(result.source).toBe("list");
    expect(result.endpoints).toEqual([{ ip: "198.51.100.44", port: 443 }]);
  });
});

describe("tcpProbe", () => {
  function fakeSocket(onClose?: () => void): Socket {
    return {
      readable: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      writable: new WritableStream<Uint8Array>(),
      close: async () => {
        onClose?.();
      },
    };
  }

  it("returns latency and closes the socket when connect succeeds", async () => {
    let closed = false;
    connectMock.mockResolvedValue(fakeSocket(() => (closed = true)));
    const latency = await tcpProbe("203.0.113.5", 443);
    expect(typeof latency).toBe("number");
    expect(latency!).toBeGreaterThanOrEqual(0);
    expect(closed).toBe(true);
    expect(connectMock).toHaveBeenCalledWith("203.0.113.5:443", { allowHalfOpen: true });
  });

  it("brackets IPv6 hosts in the connect address", async () => {
    connectMock.mockResolvedValue(fakeSocket());
    await tcpProbe("2001:db8::5", 8443);
    expect(connectMock).toHaveBeenCalledWith("[2001:db8::5]:8443", { allowHalfOpen: true });
  });

  it("returns null when connect rejects", async () => {
    connectMock.mockRejectedValue(new Error("connection refused"));
    expect(await tcpProbe("203.0.113.5", 443)).toBeNull();
  });

  it("returns null after the 4s timeout and still closes the late socket", async () => {
    vi.useFakeTimers();
    try {
      let closed = false;
      const socket = fakeSocket(() => (closed = true));
      connectMock.mockImplementation(
        () =>
          new Promise<Socket>((resolve) => {
            setTimeout(() => resolve(socket), 5000);
          }),
      );
      const pending = tcpProbe("203.0.113.5", 443);
      const settled = expect(pending).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(4500);
      await settled;
      await vi.advanceTimersByTimeAsync(1000);
      expect(closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
