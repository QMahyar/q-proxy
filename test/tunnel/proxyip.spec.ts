import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expandProxyIps,
  hashSeed,
  mulberry32,
  shuffleDeterministic,
} from "../../src/tunnel/proxyip";
import type { DohResolver } from "../../src/tunnel/resolver";
import { clearResolverCache } from "../../src/tunnel/resolver";

afterEach(() => {
  vi.unstubAllGlobals();
  clearResolverCache();
});

function fakeResolver(overrides: Partial<DohResolver> = {}): DohResolver {
  return {
    resolveA: async () => [],
    resolveAAAA: async () => [],
    resolveTXT: async () => [],
    ...overrides,
  };
}

describe("expandProxyIps", () => {
  it("expands literal IPv4 entries with optional ports without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const entries = await expandProxyIps(["1.2.3.4", "5.6.7.8:8400"], {
      resolver: fakeResolver(),
    });
    expect(entries).toEqual([
      { host: "1.2.3.4", port: 443, label: "1.2.3.4:443" },
      { host: "5.6.7.8", port: 8400, label: "5.6.7.8:8400" },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps host.tpNNN suffixes to ports with default 443 otherwise", async () => {
    const entries = await expandProxyIps(["edge.example.tp1030", "plain.example"], {
      resolver: fakeResolver({
        resolveA: async (host) => (host === "edge.example" ? ["9.9.9.9"] : ["203.0.113.44"]),
      }),
    });
    expect(entries.map((e) => `${e.host}:${e.port}`)).toEqual(["9.9.9.9:1030", "203.0.113.44:443"]);
  });

  it("expands TXT-backed domains carrying bulk lists", async () => {
    const entries = await expandProxyIps(["pool.example"], {
      resolver: fakeResolver({
        resolveTXT: async () => ['"100.0.0.1\x08100.0.0.2"', "100.0.0.3,100.0.0.4"],
      }),
    });
    expect(entries.map((e) => e.host)).toEqual(["100.0.0.1", "100.0.0.2", "100.0.0.3", "100.0.0.4"]);
    for (const entry of entries) expect(entry.port).toBe(443);
  });

  it("falls back from TXT to A then AAAA records", async () => {
    const txtOnly = await expandProxyIps(["a.example"], {
      resolver: fakeResolver({ resolveA: async () => ["6.6.6.6"] }),
    });
    expect(txtOnly.map((e) => e.host)).toEqual(["6.6.6.6"]);
    const v6Only = await expandProxyIps(["b.example"], {
      resolver: fakeResolver({ resolveAAAA: async () => ["2001:db8::1111"] }),
    });
    expect(v6Only.map((e) => e.host)).toEqual(["2001:db8::1111"]);
  });

  it("dedupes identical candidates across entries", async () => {
    const entries = await expandProxyIps(["1.1.1.1", "1.1.1.1:443"], { resolver: fakeResolver() });
    expect(entries).toHaveLength(1);
  });

  it("drops malformed entries silently", async () => {
    const entries = await expandProxyIps(["", "   ", "no spaces allowed.example"], {
      resolver: fakeResolver(),
    });
    expect(entries).toEqual([]);
  });

  it("honors bracketed IPv6 literals with ports", async () => {
    const entries = await expandProxyIps(["[2001:db8::5]:2053"], {
      resolver: fakeResolver(),
    });
    expect(entries.map((e) => `${e.host}:${e.port}`)).toEqual(["2001:db8::5:2053"]);
  });

  it("splits entries on bare carriage returns", async () => {
    const entries = await expandProxyIps(["5.6.7.8\r9.9.9.9:8443"], {
      resolver: fakeResolver(),
    });
    expect(entries.map((e) => `${e.host}:${e.port}`)).toEqual(["5.6.7.8:443", "9.9.9.9:8443"]);
  });

  it("skips private, loopback, link-local, and Cloudflare-owned literal addresses", async () => {
    const entries = await expandProxyIps(
      ["127.0.0.1", "10.0.0.7", "192.168.1.1", "169.254.1.2", "::1", "104.16.132.229", "8.8.8.8", "100.100.100.100"],
      { resolver: fakeResolver() },
    );
    expect(entries.map((e) => e.host)).toEqual(["8.8.8.8", "100.100.100.100"]);
  });

  it("filters private and Cloudflare addresses inside TXT bulk lists", async () => {
    const entries = await expandProxyIps(["pool.example"], {
      resolver: fakeResolver({
        resolveTXT: async () => ['"172.16.0.9\x08100.100.100.100"', "104.16.132.229,93.184.216.34"],
      }),
    });
    expect(entries.map((e) => e.host)).toEqual(["100.100.100.100", "93.184.216.34"]);
  });

  it("drops domain expansions that resolve only to blocked addresses", async () => {
    const entries = await expandProxyIps(["cf.example", "ok.example"], {
      resolver: fakeResolver({
        resolveA: async (host) => (host === "cf.example" ? ["104.16.132.229"] : ["6.6.6.6"]),
      }),
    });
    expect(entries.map((e) => e.host)).toEqual(["6.6.6.6"]);
  });
});

describe("deterministic shuffle", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

  it("is stable for the same seed and input order", () => {
    const seed = hashSeed("target.example.com");
    const once = shuffleDeterministic(items, seed);
    const twice = shuffleDeterministic(items, seed);
    expect(once).toEqual(twice);
  });

  it("keeps every element exactly once", () => {
    const shuffled = shuffleDeterministic(items, hashSeed("another.target"));
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it("produces identical PRNG streams for identical seeds", () => {
    const r1 = mulberry32(hashSeed("seed"));
    const r2 = mulberry32(hashSeed("seed"));
    for (let i = 0; i < 32; i++) expect(r1()).toBe(r2());
  });

  it("varies the ordering across distinct target seeds", () => {
    const orders = new Set<string>();
    for (const target of ["t1.example", "t2.example", "t3.example", "t4.example"]) {
      orders.add(shuffleDeterministic(items, hashSeed(target)).join(""));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
