import { describe, expect, it, vi } from "vitest";
import { subscriptionHeaders, throttleHeaders } from "../../src/subscription/headers";
import type { ProxyNode } from "../../src/types/node";
import type { UsageSnapshot } from "../../src/types/context";

const usage: UsageSnapshot = { day: "2026-08-23", requestsToday: 2, requestsTotal: 5 };

const nodes: ProxyNode[] = [];

describe("subscriptionHeaders", () => {
  it("emits the exact header set with base64 title and byte-accurate userinfo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
    try {
      expect(
        subscriptionHeaders("clash", "Q Proxy", nodes, usage, {
          updateIntervalHours: 12,
          webPageUrl: "https://w.test/sp/panel",
        }),
      ).toEqual({
        "Profile-Title": "base64:USBQcm94eQ==",
        "Subscription-Userinfo": "upload=0; download=5242880",
        "Content-Disposition": "attachment; filename*=UTF-8''Q%20Proxy.yaml",
        "Cache-Control": "public, max-age=60, s-maxage=60",
        Expires: "Wed, 02 Sep 2026 00:01:00 GMT",
        "Profile-Update-Interval": "60",
        "profile-web-page-url": "https://w.test/sp/panel",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("picks the extension per format", () => {
    const mk = (format: Parameters<typeof subscriptionHeaders>[0]): Record<string, string> =>
      subscriptionHeaders(format, "T", nodes, usage, { updateIntervalHours: 6, webPageUrl: "" });
    expect(mk("base64")["Content-Disposition"]).toContain("T.txt");
    expect(mk("singbox")["Content-Disposition"]).toContain("T.json");
    expect(mk("surge")["Content-Disposition"]).toContain("T.conf");
    expect(mk("loon")["Content-Disposition"]).toContain("T.conf");
    expect(mk("clash")["Content-Disposition"]).toContain("T.yaml");
  });

  it("omits profile-web-page-url when empty and pins the update interval to the fixed throttle", () => {
    const h = subscriptionHeaders("base64", "T", nodes, usage, { updateIntervalHours: 0, webPageUrl: "" });
    expect("profile-web-page-url" in h).toBe(false);
    expect(h["Profile-Update-Interval"]).toBe("60");
  });

  it("scales download estimate by requestsTotal * 1 MiB", () => {
    const h = subscriptionHeaders("base64", "T", nodes, { ...usage, requestsTotal: 100 }, {
      updateIntervalHours: 1,
      webPageUrl: "",
    });
    expect(h["Subscription-Userinfo"]).toBe(`upload=0; download=${100 * 1024 * 1024}`);
  });

  it("appends expire=<unix seconds> when meta.expireAt is set", () => {
    const h = subscriptionHeaders("base64", "T", nodes, usage, {
      updateIntervalHours: 12,
      webPageUrl: "",
      expireAt: 1893456000123,
    });
    expect(h["Subscription-Userinfo"]).toBe(`upload=0; download=5242880; expire=${Math.floor(1893456000123 / 1000)}`);
  });

  it("omits expire when meta.expireAt is null or absent", () => {
    const explicitNull = subscriptionHeaders("base64", "T", nodes, usage, {
      updateIntervalHours: 12,
      webPageUrl: "",
      expireAt: null,
    });
    expect(explicitNull["Subscription-Userinfo"]).toBe("upload=0; download=5242880");
    const absent = subscriptionHeaders("base64", "T", nodes, usage, {
      updateIntervalHours: 12,
      webPageUrl: "",
    });
    expect(absent["Subscription-Userinfo"]).toBe("upload=0; download=5242880");
  });

  it("omits expire when meta.expireAt is zero or negative", () => {
    for (const expireAt of [0, -1]) {
      const h = subscriptionHeaders("base64", "T", nodes, usage, {
        updateIntervalHours: 12,
        webPageUrl: "",
        expireAt,
      });
      expect(h["Subscription-Userinfo"]).toBe("upload=0; download=5242880");
    }
  });
});

describe("throttleHeaders", () => {
  it("emits the fixed 60s cache-throttle triple derived from now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
    try {
      expect(throttleHeaders()).toEqual({
        "Cache-Control": "public, max-age=60, s-maxage=60",
        Expires: "Wed, 02 Sep 2026 00:01:00 GMT",
        "Profile-Update-Interval": "60",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
