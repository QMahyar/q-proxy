import { describe, expect, it } from "vitest";
import { buildSubUrls, usageView } from "../../../src/handlers/api/status";
import { BYTES_PER_REQUEST, estimatedDownloadBytes, subscriptionUserinfo } from "../../../src/subscription/headers";

function usage(today: number, total: number, up: number, down: number) {
  return { day: "2026-09-19", requestsToday: today, requestsTotal: total, bytesUpTotal: up, bytesDownTotal: down };
}

describe("usageView", () => {
  it("labels every usage payload as an estimate with byte totals", () => {
    expect(usageView(usage(3, 10, 50, 60))).toEqual({
      requestsToday: 3,
      requestsTotal: 10,
      bytesUpTotal: 50,
      bytesDownTotal: 60,
      estimated: true,
    });
  });
});

describe("buildSubUrls", () => {
  it("lists native targets plus additive surge/quanx/loon converter rows", () => {
    const urls = buildSubUrls("example.com", "secret");
    const formats = urls.filter((u) => !u.url.includes("view=html")).map((u) => u.format);
    expect(formats).toEqual(["base64", "singbox", "clash", "xray", "surge", "quanx", "loon"]);
    for (const f of ["surge", "quanx", "loon"] as const) {
      const entry = urls.find((u) => u.format === f);
      expect(entry?.url).toBe(`https://example.com/secret/sub?target=${f}`);
    }
  });

  it("keeps the existing native rows byte-identical", () => {
    expect(buildSubUrls("example.com", "secret")).toEqual([
      { format: "base64", label: "Base64/Mixed", url: "https://example.com/secret/sub" },
      { format: "singbox", label: "sing-box", url: "https://example.com/secret/sub?target=singbox" },
      { format: "clash", label: "Clash/Mihomo", url: "https://example.com/secret/sub?target=clash" },
      { format: "xray", label: "Xray JSON", url: "https://example.com/secret/sub?target=xray" },
      { format: "surge", label: "Surge", url: "https://example.com/secret/sub?target=surge" },
      { format: "quanx", label: "Quantumult X", url: "https://example.com/secret/sub?target=quanx" },
      { format: "loon", label: "Loon", url: "https://example.com/secret/sub?target=loon" },
      { format: "base64", label: "Panel info", url: "https://example.com/secret/sub?view=html" },
    ]);
  });
});
describe("header/display agreement", () => {
  it("derives the header download from the same bytes the display serializes", () => {
    const u = usage(3, 10, 50, 60);
    expect(estimatedDownloadBytes(u)).toBe(60);
    expect(subscriptionUserinfo(u)).toBe("upload=50; download=60");
    expect(usageView(u).bytesDownTotal).toBe(60);
  });

  it("falls back to requests x 1MiB in both header and display when no bytes counted yet", () => {
    const u = usage(3, 10, 0, 0);
    expect(estimatedDownloadBytes(u)).toBe(10 * BYTES_PER_REQUEST);
    expect(subscriptionUserinfo(u)).toBe(`upload=0; download=${10 * BYTES_PER_REQUEST}`);
    expect(usageView(u).bytesDownTotal).toBe(0);
  });
});
