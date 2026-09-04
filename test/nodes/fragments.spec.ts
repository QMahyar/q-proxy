import { describe, expect, it } from "vitest";
import { FRAGMENT_PRESETS, fragmentQuery } from "../../src/nodes/fragments";
import type { FragmentSettings } from "../../src/types/settings";

function fragment(overrides: Partial<FragmentSettings> = {}): FragmentSettings {
  return {
    mode: "off",
    packets: "tlshello",
    lengthMin: 100,
    lengthMax: 200,
    delayMin: 1,
    delayMax: 1,
    maxSplitMin: 2,
    maxSplitMax: 4,
    ...overrides,
  };
}

describe("FRAGMENT_PRESETS", () => {
  it("defines low, medium, high, and severe presets", () => {
    expect(Object.keys(FRAGMENT_PRESETS).sort()).toEqual(["high", "low", "medium", "severe"]);
    expect(FRAGMENT_PRESETS.low).toEqual({ lengthMin: 100, lengthMax: 200, delayMin: 1, delayMax: 1 });
    expect(FRAGMENT_PRESETS.medium).toEqual({ lengthMin: 50, lengthMax: 100, delayMin: 1, delayMax: 5 });
    expect(FRAGMENT_PRESETS.high).toEqual({ lengthMin: 10, lengthMax: 20, delayMin: 10, delayMax: 20 });
    expect(FRAGMENT_PRESETS.severe).toEqual({ lengthMin: 1, lengthMax: 5, delayMin: 1, delayMax: 5 });
  });
});

describe("fragmentQuery", () => {
  it("returns an empty string when mode is off", () => {
    expect(fragmentQuery(fragment({ mode: "off" }))).toBe("");
  });

  it("emits a bare frag param for each preset mode", () => {
    for (const mode of ["low", "medium", "high", "severe"] as const) {
      expect(fragmentQuery(fragment({ mode }))).toBe(`frag=${mode}`);
    }
  });

  it("ignores numeric tuning fields in preset modes", () => {
    expect(
      fragmentQuery(
        fragment({ mode: "medium", packets: "1-3", lengthMin: 1, lengthMax: 2, delayMin: 3, delayMax: 4 }),
      ),
    ).toBe("frag=medium");
  });

  it("emits the full custom param set in custom mode", () => {
    expect(fragmentQuery(fragment({ mode: "custom" }))).toBe(
      "frag=custom&fpackets=tlshello&flen=100-200&fdelay=1-1&fsplit=2-4",
    );
  });

  it("reflects custom packet and range values", () => {
    expect(
      fragmentQuery(
        fragment({
          mode: "custom",
          packets: "1-3",
          lengthMin: 10,
          lengthMax: 20,
          delayMin: 5,
          delayMax: 9,
          maxSplitMin: 1,
          maxSplitMax: 3,
        }),
      ),
    ).toBe("frag=custom&fpackets=1-3&flen=10-20&fdelay=5-9&fsplit=1-3");
  });
});
