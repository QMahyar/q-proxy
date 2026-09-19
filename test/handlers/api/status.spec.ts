import { describe, expect, it } from "vitest";
import { usageView } from "../../../src/handlers/api/status";
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
