import { describe, expect, it, vi } from "vitest";
import {
  buildConverterUrl,
  fetchConvertedText,
  isConverterTarget,
  patchSurgeConfig,
  type SubConverterOptions,
} from "../../src/subscription/converter";

function opts(overrides: Partial<SubConverterOptions> = {}): SubConverterOptions {
  return {
    api: "https://sub.example.com",
    config: "https://example.com/ACL4SSR.ini",
    emoji: false,
    list: false,
    udp: false,
    xudp: false,
    tls13: false,
    appendType: false,
    sort: false,
    expand: true,
    skipCertVerify: false,
    ...overrides,
  };
}

const MIXED = "https://w.test/sp12345678/sub?target=mixed";

describe("isConverterTarget", () => {
  it("matches only the subconverter-backed formats", () => {
    expect(isConverterTarget("surge")).toBe(true);
    expect(isConverterTarget("quanx")).toBe(true);
    expect(isConverterTarget("loon")).toBe(true);
    expect(isConverterTarget("base64")).toBe(false);
    expect(isConverterTarget("singbox")).toBe(false);
    expect(isConverterTarget("clash")).toBe(false);
    expect(isConverterTarget("xray")).toBe(false);
  });
});

describe("buildConverterUrl", () => {
  it("maps every subconverter toggle into query params", () => {
    const r = buildConverterUrl(
      opts({
        emoji: true,
        list: true,
        udp: true,
        xudp: true,
        tls13: true,
        appendType: true,
        sort: true,
        expand: false,
        skipCertVerify: true,
      }),
      MIXED,
      "quanx",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const u = new URL(r.value);
    expect(`${u.origin}${u.pathname}`).toBe("https://sub.example.com/sub");
    expect(u.searchParams.get("target")).toBe("quanx");
    expect(u.searchParams.get("url")).toBe(MIXED);
    expect(u.searchParams.get("config")).toBe("https://example.com/ACL4SSR.ini");
    expect(u.searchParams.get("emoji")).toBe("true");
    expect(u.searchParams.get("list")).toBe("true");
    expect(u.searchParams.get("scv")).toBe("true");
    expect(u.searchParams.get("udp")).toBe("true");
    expect(u.searchParams.get("xudp")).toBe("true");
    expect(u.searchParams.get("tls13")).toBe("true");
    expect(u.searchParams.get("append_type")).toBe("true");
    expect(u.searchParams.get("sort")).toBe("true");
    expect(u.searchParams.get("expand")).toBe("false");
  });

  it("requests surge with the ver=4 flavor like edgetunnel", () => {
    const r = buildConverterUrl(opts(), MIXED, "surge");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.value).toContain("target=surge&ver=4&url=");
  });

  it("carries cnIspCode inside the wrapped mixed URL", () => {
    const inner = `${MIXED}&cnIspCode=ct`;
    const r = buildConverterUrl(opts(), inner, "loon");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(new URL(r.value).searchParams.get("url")).toBe(inner);
  });

  it("refuses an unconfigured or non-http(s) converter api without throwing", () => {
    for (const api of ["", "  ", "ftp://x/sub", "not-a-url", "///"]) {
      const r = buildConverterUrl(opts({ api }), MIXED, "surge");
      expect(r.ok, api).toBe(false);
      if (r.ok) throw new Error("unreachable");
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("never throws on garbage input", () => {
    expect(() => buildConverterUrl(opts(), "http://[::1", "loon")).not.toThrow();
    expect(() => buildConverterUrl(opts(), `${MIXED}&cnIspCode=${"x".repeat(5000)}`, "loon")).not.toThrow();
  });
});

describe("patchSurgeConfig", () => {
  it("prepends the managed-config line with the hourly interval in seconds", () => {
    const out = patchSurgeConfig(
      "# old first line\n[Proxy]\nA = trojan, 1.2.3.4, 443",
      "https://w.test/sp/sub?target=surge",
      3,
    );
    const [first, ...rest] = out.split("\n");
    expect(first).toBe("#!MANAGED-CONFIG https://w.test/sp/sub?target=surge interval=10800 strict=false");
    expect(rest.join("\n")).toContain("[Proxy]");
    expect(rest.join("\n")).not.toContain("# old first line");
  });

  it("handles single-line converter output", () => {
    const out = patchSurgeConfig("only", "https://w.test/sp/sub?target=surge", 12);
    expect(out.split("\n")[0]).toContain("interval=43200");
  });
});

describe("fetchConvertedText", () => {
  it("returns the body for a 200 response", async () => {
    const fetchFn = vi.fn(async () => new Response("[Proxy]\nA = ss, 1.2.3.4, 443", { status: 200 }));
    const r = await fetchConvertedText("https://sub.example.com/sub?target=loon", fetchFn as typeof fetch);
    expect(r).toEqual({ ok: true, value: "[Proxy]\nA = ss, 1.2.3.4, 443" });
  });

  it("reports upstream status instead of throwing", async () => {
    const fetchFn = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    const r = await fetchConvertedText("https://sub.example.com/sub?target=loon", fetchFn as typeof fetch);
    expect(r.ok).toBe(false);
  });

  it("rejects oversize bodies instead of buffering them", async () => {
    const big = "x".repeat(3 * 1024 * 1024);
    const fetchFn = vi.fn(async () => new Response(big, { status: 200 }));
    const r = await fetchConvertedText("https://sub.example.com/sub?target=loon", fetchFn as typeof fetch, {
      maxBytes: 1024,
    });
    expect(r.ok).toBe(false);
  });

  it("reports network failures instead of throwing", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await fetchConvertedText("https://sub.example.com/sub?target=loon", fetchFn as typeof fetch);
    expect(r.ok).toBe(false);
  });
});
