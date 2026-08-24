import { describe, expect, it } from "vitest";
import { subscriptionHeaders } from "../../src/subscription/headers";
import type { ProxyNode } from "../../src/types/node";
import type { UsageSnapshot } from "../../src/types/context";

const usage: UsageSnapshot = { day: "2026-08-23", requestsToday: 2, requestsTotal: 5 };

const nodes: ProxyNode[] = [];

describe("subscriptionHeaders", () => {
  it("emits the exact header set with base64 title and byte-accurate userinfo", () => {
    expect(
      subscriptionHeaders("clash", "Q Proxy", nodes, usage, {
        updateIntervalHours: 12,
        webPageUrl: "https://w.test/sp/panel",
      }),
    ).toEqual({
      "Profile-Title": "base64:USBQcm94eQ==",
      "Subscription-Userinfo": "upload=0; download=5242880",
      "Profile-Update-Interval": "12",
      "Content-Disposition": "attachment; filename*=UTF-8''Q%20Proxy.yaml",
      "Cache-Control": "no-store",
      "profile-web-page-url": "https://w.test/sp/panel",
    });
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

  it("omits profile-web-page-url when empty and clamps interval to >=1", () => {
    const h = subscriptionHeaders("base64", "T", nodes, usage, { updateIntervalHours: 0, webPageUrl: "" });
    expect("profile-web-page-url" in h).toBe(false);
    expect(h["Profile-Update-Interval"]).toBe("1");
  });

  it("scales download estimate by requestsTotal * 1 MiB", () => {
    const h = subscriptionHeaders("base64", "T", nodes, { ...usage, requestsTotal: 100 }, {
      updateIntervalHours: 1,
      webPageUrl: "",
    });
    expect(h["Subscription-Userinfo"]).toBe(`upload=0; download=${100 * 1024 * 1024}`);
  });
});
