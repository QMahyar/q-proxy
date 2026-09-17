import { describe, expect, it } from "vitest";
import { MIGRATIONS, deepMergeDefaults, migrateSettings } from "../../src/settings/migrate";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../../src/types/settings";

const REMOVED_KEYS = [
  "vmessEnabled",
  "trojanEnabled",
  "ssEnabled",
  "vmessUuid",
  "trojanPassword",
  "ssPassword",
  "ssMethod",
  "ssDirect",
  "vmessPath",
  "trojanPath",
  "ssPath",
  "proxyIpMode",
  "nat64Prefixes",
  "chainProxy",
  "remoteDns",
  "urlTestIntervalSec",
  "remoteNodes",
  "remoteSubUrls",
  "speedtestIntercept",
  "totp",
];

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

describe("MIGRATIONS[2] vless-warp slimdown cut", () => {
  it("strips every removed top-level key and keeps survivors", () => {
    const step = MIGRATIONS[2]!;
    expect(step).toBeDefined();
    const input: Record<string, unknown> = {
      ...structuredClone(DEFAULT_SETTINGS),
      securePath: "keep-me",
      profileTitle: "Keep Title",
      camouflage: { mode: "static", url: "https://camo.example/page" },
    };
    for (const key of REMOVED_KEYS) {
      (input as Record<string, unknown>)[key] = key === "totp"
        ? { enabled: true, secret: "JBSWY3DPEHPK3PXP", recoveryCodes: [] }
        : `legacy-${key}`;
    }
    const out = step(input) as Record<string, unknown>;
    for (const key of REMOVED_KEYS) {
      expect(out).not.toHaveProperty(key);
    }
    expect(out.securePath).toBe("keep-me");
    expect(out.profileTitle).toBe("Keep Title");
  });

  it("maps camouflage proxy to static and always drops camouflage.url", () => {
    const step = MIGRATIONS[2]!;
    const proxied = step({ camouflage: { mode: "proxy", url: "https://camo.example/page" } }) as Record<string, unknown>;
    expect(proxied.camouflage).toEqual({ mode: "static" });
    const staticKept = step({ camouflage: { mode: "static", url: "https://camo.example/page" } }) as Record<string, unknown>;
    expect(staticKept.camouflage).toEqual({ mode: "static" });
    const offKept = step({ camouflage: { mode: "off", url: "https://camo.example/page" } }) as Record<string, unknown>;
    expect(offKept.camouflage).toEqual({ mode: "off" });
    const bare = step({ profileTitle: "x" }) as Record<string, unknown>;
    expect(bare).not.toHaveProperty("camouflage");
    expect(step(null)).toBeNull();
  });

  it("migrateSettings applies the v2 cut on a stored blob and stamps v3", () => {
    const legacyData: Record<string, unknown> = {
      ...structuredClone(DEFAULT_SETTINGS),
      securePath: "deployed1",
      sessionSecret: "s".repeat(64),
      vmessUuid: "legacy-vmess-uuid",
      trojanPassword: "legacy-trojan",
      ssPassword: "legacy-ss",
      remoteDns: "8.8.8.8",
      urlTestIntervalSec: 300,
      remoteNodes: [{ kind: "reality" }],
      remoteSubUrls: ["https://old.example/sub"],
      nat64Prefixes: ["[2a02::]"],
      chainProxy: { enabled: true, uri: "socks5://h:1080" },
      speedtestIntercept: true,
      totp: { enabled: false, secret: "", recoveryCodes: [] },
      camouflage: { mode: "proxy", url: "https://camo.example/page" },
    };
    const legacyBlob = { version: 2, updatedAt: Date.now(), data: legacyData };
    const merged = migrateSettings(legacyBlob) as unknown as Record<string, unknown>;
    expect(merged.version).toBe(SETTINGS_VERSION);
    for (const key of REMOVED_KEYS) {
      expect(merged).not.toHaveProperty(key);
    }
    expect(merged.securePath).toBe("deployed1");
    expect(merged.camouflage).toEqual({ mode: "static" });
  });
});
