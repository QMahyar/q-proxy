import { describe, expect, it } from "vitest";
import { SUB_FORMATS } from "../../src/subscription/negotiate";
import { SUB_CONTENT_TYPES } from "../../src/subscription/render";
import { EXTENSIONS } from "../../src/subscription/headers";
import { WARP_FORMATS } from "../../src/warp/formats/registry";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { readFileSync } from "node:fs";

const LABELS_PATH = "src/ui/panel/format-labels.js";
const DICT_PATH = "src/ui/panel/dict.js";

type FormatMeta = { key: string; hint: string; ext: string };

const parseLabels = (): Record<string, FormatMeta> => {
  const src = readFileSync(LABELS_PATH, "utf8");
  const start = src.indexOf("{", src.indexOf("FORMAT_LABELS="));
  const line = src.slice(start, src.indexOf("};", start));
  const out: Record<string, FormatMeta> = {};
  for (const m of line.matchAll(/(\w+):\{key:'([^']+)',hint:'([^']+)',ext:'([^']+)'\}/g)) {
    out[m[1]!] = { key: m[2]!, hint: m[3]!, ext: m[4]! };
  }
  return out;
};

const parseOrder = (): string[] => {
  const src = readFileSync(LABELS_PATH, "utf8");
  const line = src.slice(src.indexOf("FORMAT_ORDER="));
  const m = /\[([^\]]*)\]/.exec(line);
  expect(m).toBeTruthy();
  return m![1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
};

const dictKeys = (label: string): string[] => {
  const src = readFileSync(DICT_PATH, "utf8");
  return [...src.matchAll(new RegExp(`'${label.replace(/\./g, "\\.")}':'`, "g"))].map(() => label);
};

describe("panel format-labels registry", () => {
  it("covers exactly the server's SUB_FORMATS (no missing, no extra)", () => {
    const labels = parseLabels();
    expect(Object.keys(labels).sort()).toEqual([...SUB_FORMATS].sort());
  });

  it("every format has a dict label + hint in both languages", () => {
    const labels = parseLabels();
    for (const f of SUB_FORMATS) {
      expect(dictKeys(labels[f]!.key).length).toBe(2);
      expect(dictKeys(labels[f]!.hint).length).toBe(2);
    }
  });

  it("client ext matches the server's filename extension per format", () => {
    const labels = parseLabels();
    for (const f of SUB_FORMATS) {
      expect(labels[f]!.ext).toBe(EXTENSIONS[f]);
    }
  });

  it("FORMAT_ORDER contains every server format exactly once", () => {
    const order = parseOrder();
    expect(order.sort()).toEqual([...SUB_FORMATS].sort());
    expect(new Set(order).size).toBe(order.length);
  });

  it("orders base64 first, then clash, then the rest", () => {
    const order = parseOrder();
    expect(order[0]).toBe("base64");
    expect(order[1]).toBe("clash");
  });

  it("mirrors the server's content-type families (sanity on format identity)", () => {
    expect(SUB_CONTENT_TYPES.base64).toContain("text/plain");
    expect(SUB_CONTENT_TYPES.clash).toContain("yaml");
    expect(SUB_CONTENT_TYPES.singbox).toContain("json");
  });
});

describe("panel WARP format registry (warp.js WARP_W)", () => {
  const WARP_W_PATH = "src/ui/panel/warp.js";

  const parseWarpIds = (): string[] => {
    const src = readFileSync(WARP_W_PATH, "utf8");
    const at = src.indexOf("WARP_W=");
    const line = src.slice(at, src.indexOf("];") + 2);
    return [...line.matchAll(/\{id:'([a-z0-9-]+)'/g)].map((m) => m[1]!);
  };

  it("covers exactly the server's WARP_FORMATS, in registry order", () => {
    expect(parseWarpIds()).toEqual([...WARP_FORMATS]);
  });

  it("every WARP format has a bilingual dict label (no hardcoded EN in the renderer)", () => {
    for (const f of WARP_FORMATS) {
      expect(dictKeys(`warp.fmt.${f}`).length).toBe(2);
    }
  });

  it("legacy hardcoded table and duplicate per-account renderer are gone", () => {
    const src = readFileSync(WARP_W_PATH, "utf8");
    expect(src.includes("WARP_F")).toBe(false);
    expect(src.includes("warpSubsHtml")).toBe(false);
  });
});
