import { describe, expect, it } from "vitest";
import { SUB_FORMATS } from "../../src/subscription/negotiate";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { readFileSync } from "node:fs";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { join } from "node:path";

const quickstart = readFileSync(join(process.cwd(), "docs", "QUICKSTART.md"), "utf8");

describe("docs/quickstart", () => {
  it("names only shipped ?target= formats so client tabs cannot drift", () => {
    const targets = [...quickstart.matchAll(/\?target=([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of new Set(targets)) {
      expect((SUB_FORMATS as readonly string[])).toContain(target);
    }
  });

  it("covers every served sync format with a client tab", () => {
    for (const format of SUB_FORMATS) {
      expect(quickstart).toContain(`?target=${format}`);
    }
  });
});
