import { describe, expect, it } from "vitest";
import { MIGRATIONS, deepMergeDefaults, migrateSettings } from "../../src/settings/migrate";
import { validateSettings } from "../../src/settings/validate";
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
    // B5 revived trojan/ss names as live settings: the v2 cut still drops
    // the legacy values, then deepMergeDefaults refills B5 defaults.
    const REVIVED_DEFAULTS: Record<string, unknown> = {
      trojanEnabled: false,
      ssEnabled: false,
      trojanPassword: "",
      ssMethod: "aes-128-gcm",
      trojanPath: "",
    };
    for (const key of REMOVED_KEYS) {
      if (key in REVIVED_DEFAULTS) {
        expect(merged).toHaveProperty(key);
        expect(merged[key]).toEqual(REVIVED_DEFAULTS[key]);
      } else {
        expect(merged).not.toHaveProperty(key);
      }
    }
    expect(merged.securePath).toBe("deployed1");
    expect(merged.camouflage).toEqual({ mode: "static", reverseUrl: "" });
  });
});

describe("versionless legacy payloads", () => {
  it("migrates a flat v0 payload instead of wiping it to defaults", () => {
    const flat = {
      hostnameOverride: "legacy.example.com",
      cleanIps: ["198.51.100.7"],
      securePath: "deployed9",
    };
    const out = migrateSettings(flat) as unknown as Record<string, unknown>;
    expect(out.version).toBe(SETTINGS_VERSION);
    expect(out.securePath).toBe("deployed9");
    const lines = out.customEndpoints as string[];
    expect(lines).toContain("legacy.example.com");
    expect(lines).toContain("198.51.100.7");
    expect(validateSettings(JSON.parse(JSON.stringify(out))).ok).toBe(true);
  });

  it("carries legacy cdn host and sni into the new globals", () => {
    const out = migrateSettings({
      securePath: "deployed4",
      cdn: { enabled: true, addresses: ["198.51.100.20"], host: "Cdn-Example.COM", sni: "sni.example.com" },
    }) as unknown as Record<string, unknown>;
    expect(out.cdnHost).toBe("cdn-example.com");
    expect(out.cdnSni).toBe("sni.example.com");
    expect(out.customEndpoints).toContain("198.51.100.20");
    expect(validateSettings(JSON.parse(JSON.stringify(out))).ok).toBe(true);
  });

  it("maps stored v2 address objects to custom endpoint lines", () => {
    const blob = {
      version: 2,
      updatedAt: Date.now(),
      data: {
        ...structuredClone(DEFAULT_SETTINGS),
        securePath: "deployed2",
        vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
        sessionSecret: "s".repeat(64),
        addresses: [
          { address: "198.51.100.9", port: 443 },
          { address: "old.example.com" },
          { address: "198.51.100.10", port: 22 },
          { address: "198.51.100.11", enabled: false },
          { address: "" },
        ],
      },
    };
    const out = migrateSettings(blob) as unknown as Record<string, unknown>;
    expect(out.version).toBe(SETTINGS_VERSION);
    expect(out).not.toHaveProperty("addresses");
    const lines = out.customEndpoints as string[];
    expect(lines).toContain("198.51.100.9:443");
    expect(lines).toContain("old.example.com");
    expect(JSON.stringify(lines)).not.toContain("198.51.100.10");
    expect(JSON.stringify(lines)).not.toContain("198.51.100.11");
    expect(validateSettings(JSON.parse(JSON.stringify(out))).ok).toBe(true);
  });

  it("keeps a non-proxied legacy default port off the migrated settings", () => {
    const out = migrateSettings({ tlsPorts: [22] }) as unknown as Record<string, unknown>;
    expect(out.defaultPort).toBe(DEFAULT_SETTINGS.defaultPort);
    const kept = migrateSettings({ tlsPorts: [8443] }) as unknown as Record<string, unknown>;
    expect(kept.defaultPort).toBe(8443);
  });

  it("regenerates a malformed vlessUuid and keeps a valid one", () => {
    const identity = { securePath: "deployed3", sessionSecret: "s".repeat(64) };
    const healed = migrateSettings({ ...identity, vlessUuid: "not-a-uuid" });
    expect(healed.vlessUuid).not.toBe("not-a-uuid");
    expect(healed.vlessUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(validateSettings(JSON.parse(JSON.stringify(healed))).ok).toBe(true);
    const kept = migrateSettings({ vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4" });
    expect(kept.vlessUuid).toBe("d342d11e-d424-4583-b36e-524ab1f0afa4");
  });
});

describe("B1 subscription migration (3 -> 4)", () => {
  it("fills subName/skipCertVerify/subConverter defaults on a v3 blob", () => {
    const blob = {
      version: 3,
      updatedAt: Date.now(),
      data: { ...structuredClone(DEFAULT_SETTINGS), version: 3, securePath: "deployed-b1" },
    };
    const out = migrateSettings(blob);
    expect(out.version).toBe(SETTINGS_VERSION);
    expect(out.securePath).toBe("deployed-b1");
    expect(out.subName).toBe("");
    expect(out.skipCertVerify).toBe(false);
    expect(out.subConverter).toEqual(DEFAULT_SETTINGS.subConverter);
    expect(validateSettings(JSON.parse(JSON.stringify(out))).ok).toBe(true);
  });

  it("keeps explicit B1 values and repairs malformed shapes", () => {
    const blob = {
      version: 3,
      updatedAt: Date.now(),
      data: {
        ...structuredClone(DEFAULT_SETTINGS),
        securePath: "deployed-b1b",
        subName: "Keep Me",
        skipCertVerify: true,
        subConverter: "not-an-object",
      },
    };
    const out = migrateSettings(blob);
    expect(out.subName).toBe("Keep Me");
    expect(out.skipCertVerify).toBe(true);
    expect(out.subConverter).toEqual(DEFAULT_SETTINGS.subConverter);
    expect(validateSettings(JSON.parse(JSON.stringify(out))).ok).toBe(true);
  });
});

describe("telegram identity lock migration", () => {
  it("clears a legacy @username chatId so validation keeps passing", () => {
    const blob = {
      version: SETTINGS_VERSION,
      updatedAt: Date.now(),
      data: { ...structuredClone(DEFAULT_SETTINGS), telegram: { enabled: true, botToken: "t", chatId: "@opsalerts" } },
    };
    const out = migrateSettings(blob);
    expect(out.telegram.chatId).toBe("");
  });

  it("keeps numeric and empty chat ids untouched", () => {
    for (const chatId of ["424242", "-100999", ""]) {
      const blob = {
        version: SETTINGS_VERSION,
        updatedAt: Date.now(),
        data: { ...structuredClone(DEFAULT_SETTINGS), telegram: { enabled: true, botToken: "t", chatId } },
      };
      expect(migrateSettings(blob).telegram.chatId).toBe(chatId);
    }
  });
});
