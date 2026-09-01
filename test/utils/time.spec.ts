import { describe, expect, it } from "vitest";
import { dayKeyUtc, unixNow } from "../../src/utils/time";

describe("dayKeyUtc", () => {
  it("formats UTC year-month-day with zero padding", () => {
    expect(dayKeyUtc(new Date("2026-09-01T00:00:00.000Z"))).toBe("2026-09-01");
    expect(dayKeyUtc(new Date("2026-01-05T23:59:59.999Z"))).toBe("2026-01-05");
    expect(dayKeyUtc(new Date("2026-01-06T00:00:00.000Z"))).toBe("2026-01-06");
  });

  it("handles leap days, epoch and far-future dates", () => {
    expect(dayKeyUtc(new Date("2024-02-29T12:00:00.000Z"))).toBe("2024-02-29");
    expect(dayKeyUtc(new Date(0))).toBe("1970-01-01");
    expect(dayKeyUtc(new Date("2100-12-31T23:59:59.000Z"))).toBe("2100-12-31");
  });

  it("defaults to the current UTC date", () => {
    const now = new Date();
    expect(dayKeyUtc(now)).toBe(now.toISOString().slice(0, 10));
  });
});

describe("unixNow", () => {
  it("returns the current time as whole seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const now = unixNow();
    const after = Math.floor(Date.now() / 1000);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
    expect(Number.isInteger(now)).toBe(true);
  });
});
