import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../../src/types/settings";
import { MIGRATIONS, deepMergeDefaults, migrateSettings } from "../../src/settings/migrate";
import { makeTestSettings } from "../helpers/settings";

afterEach(() => {
  vi.restoreAllMocks();
});

function fullV1(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(makeTestSettings()));
}

describe("migrateSettings", () => {
  it("returns pristine defaults for empty or non-object blobs", () => {
    for (const raw of [null, undefined, "", "garbage", 42, true, [], ["x"]]) {
      expect(migrateSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("returns defaults when version is missing or non-finite", () => {
    expect(migrateSettings({ securePath: "kept" })).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ version: Number.NaN })).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ version: "1" })).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ version: null })).toEqual(DEFAULT_SETTINGS);
    const out = migrateSettings({ version: Number.POSITIVE_INFINITY });
    expect(out.securePath).toBe("");
  });

  it("merges current-version payloads over defaults", () => {
    const stored = fullV1();
    delete stored.killSwitch;
    delete stored.camouflage;
    const out = migrateSettings(stored);
    expect(out.version).toBe(SETTINGS_VERSION);
    expect(out.killSwitch).toBe(false);
    expect(out.camouflage).toEqual(DEFAULT_SETTINGS.camouflage);
    expect(out.profileTitle).toBe(stored.profileTitle as string);
    expect(out.vlessUuid).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("fills missing nested fragment keys from defaults", () => {
    const stored = { version: SETTINGS_VERSION, data: { fragment: { lengthMin: 42 } } };
    const out = migrateSettings(stored);
    expect(out.fragment.lengthMin).toBe(42);
    expect(out.fragment.lengthMax).toBe(DEFAULT_SETTINGS.fragment.lengthMax);
    expect(out.fragment.mode).toBe("off");
  });

  it("unwraps the KV blob shape {version, updatedAt, data}", () => {
    const wrapped = migrateSettings({
      version: SETTINGS_VERSION,
      updatedAt: 123,
      data: { profileTitle: "Wrapped" },
    });
    const bare = migrateSettings({ version: SETTINGS_VERSION, profileTitle: "Bare" });
    expect(wrapped.profileTitle).toBe("Wrapped");
    expect(bare.profileTitle).toBe("Bare");
    expect(wrapped.tlsPorts).toEqual(DEFAULT_SETTINGS.tlsPorts);
  });

  it("applies sequential migrations for older versions", () => {
    const seen: number[] = [];
    try {
      MIGRATIONS[-1] = (data: unknown) => {
        seen.push(-1);
        return data;
      };
      MIGRATIONS[0] = (data: unknown) => {
        seen.push(0);
        return { ...(data as object) };
      };
      const out = migrateSettings({ version: -1, data: { language: "en" } });
      expect(seen).toEqual([-1, 0]);
      expect(out.language).toBe("en");
      expect(out.version).toBe(SETTINGS_VERSION);
    } finally {
      delete MIGRATIONS[-1];
      delete MIGRATIONS[0];
    }
  });

  it("merges best-effort and warns for newer stored versions", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = migrateSettings({
      version: SETTINGS_VERSION + 99,
      data: { profileTitle: "From Future", brandNewKey: "opaque" },
    });
    expect(out.version).toBe(SETTINGS_VERSION);
    expect(out.profileTitle).toBe("From Future");
    expect(JSON.stringify(out)).not.toContain("brandNewKey");
    expect(spy.mock.calls.some((call) => String(call.join(" ")).includes("newer than app"))).toBe(
      true,
    );
  });

  it("does not mutate the raw blob or the defaults constant", () => {
    const stored = { version: SETTINGS_VERSION, data: { profileTitle: "X" } };
    migrateSettings(stored);
    expect(stored.data).toEqual({ profileTitle: "X" });
    expect(DEFAULT_SETTINGS.profileTitle).toBe("Q Proxy");
  });

  it("replaces arrays wholesale instead of element-merging", () => {
    const out = migrateSettings({
      version: SETTINGS_VERSION,
      data: { tlsPorts: [2053] },
    });
    expect(out.tlsPorts).toEqual([2053]);
  });
});

describe("deepMergeDefaults", () => {
  it("ignores unknown top-level keys and undefined values", () => {
    const out = deepMergeDefaults(structuredClone(DEFAULT_SETTINGS), {
      evil: "x",
      profileTitle: undefined,
    });
    expect(out.profileTitle).toBe(DEFAULT_SETTINGS.profileTitle);
    expect((out as unknown as Record<string, unknown>).evil).toBeUndefined();
  });

  it("deep merges nested objects while keeping sibling defaults", () => {
    const out = deepMergeDefaults(structuredClone(DEFAULT_SETTINGS), {
      cdn: { enabled: true },
    });
    expect(out.cdn.enabled).toBe(true);
    expect(out.cdn.host).toBe("");
    expect(out.cdn.addresses).toEqual([]);
  });

  it("does not mutate base or patch inputs", () => {
    const base = structuredClone(DEFAULT_SETTINGS);
    const patch = { fragment: { lengthMin: 5 } };
    const out = deepMergeDefaults(base, patch);
    expect(base.fragment.lengthMin).toBe(100);
    expect(patch.fragment.lengthMin).toBe(5);
    expect(out.fragment.lengthMin).toBe(5);
  });

  it("returns a defaults clone when patch is not an object", () => {
    const out = deepMergeDefaults(structuredClone(DEFAULT_SETTINGS), "nope");
    expect(out).toEqual(DEFAULT_SETTINGS);
  });
});
