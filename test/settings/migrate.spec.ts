import { describe, expect, it } from "vitest";
import { deepMergeDefaults } from "../../src/settings/migrate";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

describe("deepMergeDefaults prototype-pollution guard", () => {
  it("skips __proto__ / constructor / prototype keys", () => {
    const polluted: Record<string, unknown> = {};
    deepMergeDefaults({} as Record<string, unknown>, {
      __proto__: { polluted: 1 },
      constructor: { polluted: 1 },
      prototype: { polluted: 1 },
      profileTitle: "x",
    });
    expect((polluted as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
  });

  it("uses Object.hasOwn and does not copy unknown keys from patch", () => {
    const base = { ...DEFAULT_SETTINGS };
    const out = deepMergeDefaults(base, { unknownField: "evil" } as unknown as Record<string, unknown>);
    expect((out as unknown as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it("caps recursion depth to avoid stack overflow", () => {
    let deep: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < 50; i++) {
      const next: Record<string, unknown> = {};
      cursor.nested = next;
      cursor = next;
    }
    expect(() => deepMergeDefaults(structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>, deep)).not.toThrow();
  });
});
