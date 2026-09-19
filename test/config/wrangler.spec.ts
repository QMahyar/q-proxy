import { describe, expect, it } from "vitest";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { readFileSync } from "node:fs";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { join } from "node:path";

const toml = readFileSync(join(process.cwd(), "wrangler.toml"), "utf8");

describe("config/wrangler", () => {
  it("enables nodejs_compat so prod resolves what tests resolve", () => {
    const flags = toml.match(/compatibility_flags\s*=\s*\[([^\]]*)\]/);
    expect(flags, "compatibility_flags missing from wrangler.toml").not.toBeNull();
    expect(flags![1]).toMatch(/["']nodejs_compat["']/);
  });

  it("pins a compatibility date younger than 180 days", () => {
    const date = toml.match(/compatibility_date\s*=\s*["'](\d{4}-\d{2}-\d{2})["']/);
    expect(date, "compatibility_date missing from wrangler.toml").not.toBeNull();
    const ageDays = (Date.now() - new Date(date![1] + "T00:00:00Z").getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThanOrEqual(0);
    expect(ageDays).toBeLessThan(180);
  });
});
