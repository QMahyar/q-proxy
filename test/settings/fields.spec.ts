import { describe, expect, it } from "vitest";
import panelHtml from "../../src/ui/panel.html";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { SETTING_FIELD_DESCRIPTORS } from "../../src/settings/fields";

interface FlField {
  path: string | string[];
  label: string | null;
  hint: string | null;
  [key: string]: unknown;
}

interface FlCard {
  title?: string | null;
  fields?: FlField[];
}

interface FlSection {
  key: string;
  cards: FlCard[];
}

interface Dict {
  en: Record<string, string>;
  fa: Record<string, string>;
}

const VERSION_PATH = "version";
const PSEUDO_UI_PATHS = ["__privateDoh"];
const NON_REGISTRY_UI_PATHS: string[] = ["warpPresets", "warpCustomEndpoints"];
const WARP_GLOBAL_UI_MARKERS = ["warp-endpoints", "data-warp-preset", "warp-eps-custom"];
const READONLY_UI_PATHS = ["securePath"];
const SHELL_MANAGED_PATHS = ["killSwitch", "language"];
const API_MANAGED_PATHS = ["passwordHash", "passwordSalt", "sessionSecret", "passwordIsBootstrap", "seededAt"];

function settingLeafPaths(value: unknown, prefix = ""): string[] {
  if (prefix.length > 0 && (value === null || typeof value !== "object" || Array.isArray(value))) {
    return [prefix];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => settingLeafPaths(v, prefix ? `${prefix}.${k}` : k));
}

function buildPanelRegistry(): { dict: Dict; fields: FlField[] } {
  const dictStart = panelHtml.indexOf("const DICT={");
  const dictEnd = panelHtml.indexOf("const getLangCookie");
  const flStart = panelHtml.indexOf("const FL=");
  const flEnd = panelHtml.indexOf("function helpTrigger");
  expect(dictStart).toBeGreaterThan(-1);
  expect(dictEnd).toBeGreaterThan(dictStart);
  expect(flStart).toBeGreaterThan(dictEnd);
  expect(flEnd).toBeGreaterThan(flStart);
  const factory = new Function(
    "SS_METHODS",
    "FPS",
    "PACKETS",
    "getPath",
    `${panelHtml.slice(dictStart, dictEnd)}\n${panelHtml.slice(flStart, flEnd)}\nreturn { DICT, SECTIONS };`,
  ) as (...args: unknown[]) => { DICT: Dict; SECTIONS: FlSection[] };
  const ssMethods = ["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"];
  const fingerprints = ["chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized"];
  const packets = ["tlshello", "1-1", "1-2", "1-3", "1-5"];
  const getPath = (obj: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>(
      (acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      obj,
    );
  const { DICT, SECTIONS } = factory(ssMethods, fingerprints, packets, getPath);
  const fields: FlField[] = [];
  for (const section of SECTIONS) {
    for (const card of section.cards ?? []) {
      for (const f of card.fields ?? []) fields.push(f);
    }
  }
  return { dict: DICT, fields };
}

function flPathsOf(fields: FlField[]): string[] {
  const paths: string[] = [];
  for (const f of fields) {
    for (const p of Array.isArray(f.path) ? f.path : [f.path]) paths.push(String(p));
  }
  return paths;
}

describe("settings single source of truth drift", () => {
  const tablePaths = SETTING_FIELD_DESCRIPTORS.map((d) => d.path);

  it("descriptor table has no duplicate paths", () => {
    expect(new Set(tablePaths).size).toBe(tablePaths.length);
  });

  it("descriptor table covers every DEFAULT_SETTINGS settable leaf exactly", () => {
    const leaves = settingLeafPaths(DEFAULT_SETTINGS).filter((p) => p !== VERSION_PATH);
    expect(tablePaths.slice().sort()).toEqual(leaves.slice().sort());
  });

  it("every panel FL() path is a known setting field (or the documented pseudo-field)", () => {
    const { fields } = buildPanelRegistry();
    const tableSet = new Set(tablePaths);
    const extras = flPathsOf(fields).filter((p) => !tableSet.has(p));
    expect(extras.sort()).toEqual(PSEUDO_UI_PATHS.slice().sort());
  });

  it("every setting field missing from FL() is exactly the documented exception set", () => {
    const { fields } = buildPanelRegistry();
    const flSet = new Set(flPathsOf(fields));
    const unbound = tablePaths.filter((p) => !flSet.has(p));
    expect(unbound.sort()).toEqual([...NON_REGISTRY_UI_PATHS, ...READONLY_UI_PATHS, ...SHELL_MANAGED_PATHS, ...API_MANAGED_PATHS].sort());
    for (const marker of WARP_GLOBAL_UI_MARKERS) {
      expect(panelHtml).toContain(marker);
    }
    for (const p of READONLY_UI_PATHS) {
      expect(panelHtml).not.toContain(`data-bind="${p}"`);
      expect(panelHtml).toContain("panelAddressCardHtml");
    }
  });

  it("every i18n key referenced by the FL() registry exists in both dictionaries", () => {
    const { dict, fields } = buildPanelRegistry();
    const refs: string[] = [];
    for (const f of fields) {
      for (const key of [f.label, f.hint, f.help, f.protoLabelKey]) {
        if (typeof key === "string" && key.length > 0) refs.push(key);
      }
    }
    expect(refs.length).toBeGreaterThan(50);
    const missing = refs.filter((k) => !(k in dict.en) || !(k in dict.fa));
    expect(missing).toEqual([]);
  });

  it("en and fa dictionaries define the same key set", () => {
    const { dict } = buildPanelRegistry();
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.fa).sort());
  });

  it("panel CDN preset mirror matches the shipped preset data", async () => {
    const { CDN_PRESETS } = await import("../../src/nodes/cdn-presets");
    const m = /const CDN_PRESETS=(\[.*?\]);/.exec(panelHtml);
    expect(m).not.toBeNull();
    const mirror = new Function(`return (${m![1]});`)() as Array<{ id: string; ip: string; port: number }>;
    expect(mirror.map((p) => ({ id: p.id, ip: p.ip, port: p.port }))).toEqual(
      CDN_PRESETS.map((p) => ({ id: p.id, ip: p.ip, port: p.port })),
    );
  });
});

describe("echAuto binding", () => {
  it("declares echAuto as a boolean setting defaulting to off", () => {
    const row = SETTING_FIELD_DESCRIPTORS.find((d) => d.path === "echAuto");
    expect(row).toBeDefined();
    expect(row!.spec).toEqual({ kind: "bool" });
    expect(DEFAULT_SETTINGS.echAuto).toBe(false);
  });

  it("binds the auto toggle and the manual override in the panel with i18n in both languages", () => {
    const { dict, fields } = buildPanelRegistry();
    const paths = flPathsOf(fields);
    expect(paths).toContain("echAuto");
    expect(paths).toContain("echServerName");
    for (const key of [
      "protocols.ech.auto",
      "protocols.ech.auto_hint",
      "protocols.ech.auto_help",
      "protocols.ech.preview_manual",
      "protocols.ech.preview_auto",
      "protocols.ech.preview_off",
    ]) {
      expect(dict.en[key]).toBeTruthy();
      expect(dict.fa[key]).toBeTruthy();
    }
  });
});

describe("onboarding bootstrap fields", () => {
  it("declares passwordIsBootstrap and seededAt with safe defaults", () => {
    expect(DEFAULT_SETTINGS.passwordIsBootstrap).toBe(false);
    expect(DEFAULT_SETTINGS.seededAt).toBe(0);
    const bootstrapRow = SETTING_FIELD_DESCRIPTORS.find((d) => d.path === "passwordIsBootstrap");
    expect(bootstrapRow).toBeDefined();
    expect(bootstrapRow!.spec).toEqual({ kind: "bool" });
    const seededRow = SETTING_FIELD_DESCRIPTORS.find((d) => d.path === "seededAt");
    expect(seededRow).toBeDefined();
    expect(seededRow!.spec).toEqual({ kind: "int", min: 0, max: 4_102_444_800_000 });
  });

  it("keeps both fields out of the panel registry as API-managed state", () => {
    const { fields } = buildPanelRegistry();
    const paths = flPathsOf(fields);
    expect(paths).not.toContain("passwordIsBootstrap");
    expect(paths).not.toContain("seededAt");
    const tablePaths = SETTING_FIELD_DESCRIPTORS.map((d) => d.path);
    const unbound = tablePaths.filter((p) => !new Set(paths).has(p));
    expect(unbound).toContain("passwordIsBootstrap");
    expect(unbound).toContain("seededAt");
  });
});

describe("vlessFlow setting", () => {
  it("declares the field with safe defaults and drops ssDirect", () => {
    expect(DEFAULT_SETTINGS.vlessFlow).toBe("");
    expect("ssDirect" in DEFAULT_SETTINGS).toBe(false);
    const flowRow = SETTING_FIELD_DESCRIPTORS.find((d) => d.path === "vlessFlow");
    expect(flowRow).toBeDefined();
    expect(flowRow!.spec).toEqual({ kind: "enum", allowed: ["", "xtls-rprx-vision"] });
    expect(SETTING_FIELD_DESCRIPTORS.some((d) => d.path === "ssDirect")).toBe(false);
  });

  it("binds the field in the panel with i18n in both languages", () => {
    const { dict, fields } = buildPanelRegistry();
    const paths = flPathsOf(fields);
    expect(paths).toContain("vlessFlow");
    expect(paths).not.toContain("ssDirect");
    for (const key of [
      "protocols.flow.label",
      "protocols.flow.hint",
      "protocols.flow.off",
      "protocols.flow.vision",
    ]) {
      expect(dict.en[key]).toBeTruthy();
      expect(dict.fa[key]).toBeTruthy();
    }
  });
});

describe("allowedIps", () => {
  it("declares allowedIps as a custom list defaulting to allow-all", () => {
    const row = SETTING_FIELD_DESCRIPTORS.find((d) => d.path === "allowedIps");
    expect(row).toBeDefined();
    expect(row!.spec).toEqual({ kind: "custom" });
    expect(DEFAULT_SETTINGS.allowedIps).toEqual([]);
  });

  it("binds the allowlist editor in the panel with i18n in both languages", () => {
    const { dict, fields } = buildPanelRegistry();
    expect(flPathsOf(fields)).toContain("allowedIps");
    for (const key of [
      "security.allowlist.label",
      "security.allowlist.hint",
    ]) {
      expect(dict.en[key]).toBeTruthy();
      expect(dict.fa[key]).toBeTruthy();
    }
  });
});
