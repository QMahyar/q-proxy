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

describe("removed settings fields drop migrate-safe", () => {
  it("silently drops deleted fields (localDns, sourceUrls) from stored blobs", async () => {
    const { migrateSettings } = await import("../../src/settings/migrate");
    const { validateSettings } = await import("../../src/settings/validate");
    const legacyBlob = {
      version: 2,
      updatedAt: Date.now(),
      data: {
        ...structuredClone(DEFAULT_SETTINGS),
        securePath: "deployed1",
        sessionSecret: "s".repeat(64),
        localDns: "1.1.1.1",
        sourceUrls: ["https://old.example/sub"],
        addresses: [{ address: "1.2.3.4", city: "Berlin", country: "DE" }],
      },
    };
    const merged = migrateSettings(legacyBlob) as unknown as Record<string, unknown>;
    expect(merged).not.toHaveProperty("localDns");
    expect(merged).not.toHaveProperty("sourceUrls");
    const validated = validateSettings(merged);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.addresses).toEqual([{ address: "1.2.3.4", country: "DE" }]);
      expect("localDns" in validated.value).toBe(false);
      expect("sourceUrls" in validated.value).toBe(false);
    }
  });
});
