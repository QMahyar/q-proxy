import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../../src/types/settings";
import { resolveEchServerName, validateSettings } from "../../src/settings/validate";
import { makeFailoverStrategy } from "../../src/tunnel/egress";
import { makeTestSettings } from "../helpers/settings";

function fieldsOf(input: unknown): Record<string, string> {
  const result = validateSettings(input);
  expect(result.ok).toBe(false);
  return (result as { ok: false; fields: Record<string, string> }).fields;
}

describe("validateSettings", () => {
  it("accepts a complete valid settings object unchanged", () => {
    const result = validateSettings(makeTestSettings());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(makeTestSettings());
  });

  it("returns full normalized defaults for an empty patch", () => {
    const result = validateSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects non-object input", () => {
    for (const raw of [null, "x", 42, [], true]) {
      const result = validateSettings(raw);
      expect(result.ok).toBe(false);
    }
  });

  it("ignores unknown top-level keys and stamps version", () => {
    const result = validateSettings({ ...makeTestSettings(), evilKey: "x", version: 999 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as unknown as Record<string, unknown>).evilKey).toBeUndefined();
      expect(result.value.version).toBe(SETTINGS_VERSION);
    }
  });

  it("validates fragment min/max ordering with dotted keys", () => {
    const fields = fieldsOf({ fragment: { lengthMin: 900, lengthMax: 10 } });
    expect(fields["fragment.lengthMin"]).toBeTruthy();
  });

  it("rejects local or private doh targets", () => {
    expect(fieldsOf({ dohUpstream: "http://127.0.0.1:53/dns-query" }).dohUpstream).toBeTruthy();
    expect(fieldsOf({ dohUpstream: "https://localhost/dns-query" }).dohUpstream).toBeTruthy();
    expect(fieldsOf({ dohUpstream: "http://169.254.169.254/dns-query" }).dohUpstream).toBeTruthy();
    expect(validateSettings({ dohUpstream: "https://dns.google/dns-query" }).ok).toBe(true);
  });

  it("validates echServerName domain shape", () => {
    expect(validateSettings({ echServerName: "cloudflare-ech.com" }).ok).toBe(true);
    expect(validateSettings({ echServerName: "EXAMPLE.COM" }).ok).toBe(true);
    expect(validateSettings({ echServerName: "" }).ok).toBe(true);
    expect(fieldsOf({ echServerName: "localhost" }).echServerName).toBeTruthy();
    expect(fieldsOf({ echServerName: "example.com." }).echServerName).toBeTruthy();
    expect(fieldsOf({ echServerName: "-bad.example.com" }).echServerName).toBeTruthy();
    expect(fieldsOf({ echServerName: "has space.example.com" }).echServerName).toBeTruthy();
  });

  it("range-checks numeric fields", () => {
    for (const [key, value] of [
      ["earlyDataMaxBytes", -1],
      ["earlyDataMaxBytes", 8193],
      ["earlyDataMaxBytes", 1.5],
      ["maxNodesPerFormat", 0],
      ["subUpdateIntervalHours", 200],
      ["subUpdateIntervalHours", 0],
      ["subUpdateIntervalHours", 169],
      ["maxNodesPerFormat", 2001],
    ] as Array<[string, number]>) {
      const fields = fieldsOf({ [key]: value });
      expect(fields[key]).toBeTruthy();
    }
    expect(validateSettings({ maxNodesPerFormat: 2000 }).ok).toBe(true);
    expect(validateSettings({ earlyDataMaxBytes: 8192 }).ok).toBe(true);
    expect(validateSettings({ maxNodesPerFormat: 1 }).ok).toBe(true);
  });

  it("enforces Cloudflare-proxied default ports and custom-endpoint ports", () => {
    expect(fieldsOf({ defaultPort: 9999 }).defaultPort).toBeTruthy();
    expect(fieldsOf({ defaultPort: 80 }).defaultPort).toBeTruthy();
    expect(validateSettings({ defaultPort: 443 }).ok).toBe(true);
    expect(validateSettings({ defaultPort: 2053 }).ok).toBe(true);
    expect(fieldsOf({ customEndpoints: ["1.2.3.4:9999"] }).customEndpoints).toBeTruthy();
  });

  it("sanitizes arrays: trim, drop empties, reject over-limit and invalid entries", () => {
    const result = validateSettings({
      customEndpoints: ["1.2.3.4:443", "  1.2.3.4:443  ", "", "5.6.7.8"],
      proxyIps: ["203.0.113.7", " 203.0.113.8:443 "],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.customEndpoints).toEqual(["1.2.3.4:443", "1.2.3.4:443", "5.6.7.8"]);
      expect(result.value.proxyIps).toEqual(["203.0.113.7", "203.0.113.8:443"]);
    }
    const overLimit = validateSettings({
      proxyIps: Array.from({ length: 70 }, (_, i) => `192.0.2.${(i % 250) + 1}`),
    });
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.fields.proxyIps).toContain("too many");
    expect(fieldsOf({ proxyIps: ["has space"] }).proxyIps).toBeTruthy();
    expect(fieldsOf({ proxyIps: [42] }).proxyIps).toBeTruthy();
  });

  it("rejects non-array custom-endpoint input", () => {
    expect(fieldsOf({ customEndpoints: "nope" })["customEndpoints"]).toBeTruthy();
    expect(fieldsOf({ customEndpoints: [42] })["customEndpoints"]).toBeTruthy();
  });

  it("requires http(s) URLs in url fields", () => {
    expect(fieldsOf({ dohUpstream: "not-a-url" })["dohUpstream"]).toBeTruthy();
    expect(fieldsOf({ dohUpstream: "ftp://x" })["dohUpstream"]).toBeTruthy();
    expect(fieldsOf({ proxyIpPoolUrl: "ftp://x" })["proxyIpPoolUrl"]).toBeTruthy();
    expect(validateSettings({ dohUpstream: "https://dns.google/dns-query" }).ok).toBe(true);
    expect(validateSettings({ proxyIpPoolUrl: "https://pool.example/ips.txt" }).ok).toBe(true);
    expect(validateSettings({ proxyIpPoolUrl: "" }).ok).toBe(true);
  });

  it("matches enums exactly", () => {
    expect(fieldsOf({ language: "fr" })["language"]).toBeTruthy();
    expect(fieldsOf({ fingerprint: "nope" })["fingerprint"]).toBeTruthy();
    expect(fieldsOf({ camouflage: { mode: "mirror" } })["camouflage.mode"]).toBeTruthy();
    expect(fieldsOf({ camouflage: { mode: "proxy" } })["camouflage.mode"]).toBeTruthy();
    expect(fieldsOf({ fragment: { mode: "ultra" } })["fragment.mode"]).toBeTruthy();
    expect(fieldsOf({ fragment: { packets: "9-9" } })["fragment.packets"]).toBeTruthy();
    expect(validateSettings({ language: "fa", fingerprint: "randomized" }).ok).toBe(true);
    expect(validateSettings({ camouflage: { mode: "static" } }).ok).toBe(true);
    expect(validateSettings({ camouflage: { mode: "off" } }).ok).toBe(true);
  });

  it("requires exact boolean types", () => {
    expect(fieldsOf({ killSwitch: "yes" })["killSwitch"]).toBeTruthy();
    expect(fieldsOf({ debugLogging: 1 })["debugLogging"]).toBeTruthy();
  });

  it("ignores removed top-level keys instead of storing them", () => {
    const result = validateSettings({
      chainProxy: { enabled: true, uri: "socks5://u:p@h:1080" },
      remoteNodes: [{ kind: "reality" }],
      remoteDns: "8.8.8.8",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("chainProxy" in result.value).toBe(false);
      expect("remoteNodes" in result.value).toBe(false);
      expect("remoteDns" in result.value).toBe(false);
    }
  });

  it("restricts alpn to the known token list", () => {
    expect(fieldsOf({ alpn: ["bogus/1"] })["alpn"]).toBeTruthy();
    const result = validateSettings({ alpn: ["HTTP/1.1", " h2 ", "h2", ""] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.alpn).toEqual(["http/1.1", "h2"]);
    const over = validateSettings({ alpn: Array.from({ length: 10 }, (_, i) => `token-${i}`) });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.fields.alpn).toContain("too many");
  });

  it("validates identity strings and paths", () => {
    expect(fieldsOf({ securePath: "has space" })["securePath"]).toBeTruthy();
    expect(fieldsOf({ securePath: "" })["securePath"]).toBeTruthy();
    expect(validateSettings({ securePath: "abc-DEF_123" }).ok).toBe(true);
    expect(fieldsOf({ vlessPath: "x!" })["vlessPath"]).toBeTruthy();
    expect(fieldsOf({ customEndpoints: ["bad host!!"] })["customEndpoints"]).toBeTruthy();
    expect(fieldsOf({ nameTemplate: "a".repeat(513) })["nameTemplate"]).toBeTruthy();
    expect(fieldsOf({ passwordHash: 7 })["passwordHash"]).toBeTruthy();
    expect(validateSettings({ passwordHash: null, passwordSalt: null }).ok).toBe(true);
  });

  it("normalizes partial patches into a full Settings object", () => {
    const result = validateSettings({ profileTitle: "  Trimmed  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profileTitle).toBe("Trimmed");
      expect(result.value.defaultPort).toBe(DEFAULT_SETTINGS.defaultPort);
      expect(result.value.cdnPresets).toEqual([]);
      expect(result.value.customEndpoints).toEqual([]);
      expect(result.value.warpPresets).toEqual(["default"]);
      expect(result.value.warpCustomEndpoints).toEqual([]);
      expect(result.value.fragment.packets).toBe("tlshello");
      expect(Object.keys(result.value).sort()).toEqual(
        Object.keys(DEFAULT_SETTINGS)
          .sort()
          .filter((k) => k !== "version" || true),
      );
    }
  });
});

describe("onboarding bootstrap fields", () => {
  it("defaults passwordIsBootstrap to false and seededAt to epoch 0", () => {
    const result = validateSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passwordIsBootstrap).toBe(false);
      expect(result.value.seededAt).toBe(0);
    }
  });

  it("preserves both fields through a full validate round-trip", () => {
    const result = validateSettings(
      makeTestSettings({ passwordIsBootstrap: true, seededAt: 1_700_000_000_000, passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passwordIsBootstrap).toBe(true);
      expect(result.value.seededAt).toBe(1_700_000_000_000);
    }
    const plain = validateSettings(makeTestSettings());
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.value.passwordIsBootstrap).toBe(false);
      expect(plain.value.seededAt).toBe(0);
    }
  });

  it("allows the bootstrap flag only with an existing admin password", () => {
    const withHash = validateSettings({ passwordIsBootstrap: true, passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) });
    expect(withHash.ok).toBe(true);
    if (withHash.ok) expect(withHash.value.passwordIsBootstrap).toBe(true);
    for (const patch of [{ passwordIsBootstrap: true }, { passwordIsBootstrap: true, passwordHash: null }]) {
      const result = validateSettings(patch);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields.passwordIsBootstrap).toBeTruthy();
    }
    expect(validateSettings({ passwordIsBootstrap: false, passwordHash: null }).ok).toBe(true);
  });

  it("validates the seed timestamp shape", () => {
    expect(fieldsOf({ seededAt: -1 }).seededAt).toBeTruthy();
    expect(fieldsOf({ seededAt: 1.5 }).seededAt).toBeTruthy();
    expect(fieldsOf({ seededAt: "now" }).seededAt).toBeTruthy();
    expect(fieldsOf({ seededAt: 4_102_444_800_001 }).seededAt).toBeTruthy();
    expect(validateSettings({ seededAt: 0 }).ok).toBe(true);
    expect(validateSettings({ seededAt: Date.now() }).ok).toBe(true);
  });

  it("rejects non-boolean passwordIsBootstrap values", () => {
    expect(fieldsOf({ passwordIsBootstrap: "yes" }).passwordIsBootstrap).toBeTruthy();
    expect(fieldsOf({ passwordIsBootstrap: 1 }).passwordIsBootstrap).toBeTruthy();
  });
});

describe("defaultPort guard", () => {
  it("rejects a non-Cloudflare default port with a clear message", () => {
    const result = validateSettings({ defaultPort: 8081 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.defaultPort).toContain("Cloudflare-proxied");
    }
  });

  it("allows empty custom endpoints (falls back to presets, then hostname)", () => {
    expect(validateSettings({ customEndpoints: [] }).ok).toBe(true);
  });
});

describe("custom endpoint lines", () => {
  it("keeps valid ip:port, bare host, and bracketed ipv6 lines verbatim", () => {
    const result = validateSettings({
      customEndpoints: [
        "1.2.3.4:2053",
        " 5.6.7.8 ",
        "[2606:4700::1]:8443",
        "2606:4700::99",
        "edge.example.com",
        "edge.example.com:2096",
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.customEndpoints).toEqual([
        "1.2.3.4:2053",
        "5.6.7.8",
        "[2606:4700::1]:8443",
        "2606:4700::99",
        "edge.example.com",
        "edge.example.com:2096",
      ]);
    }
  });

  it("names every offending line and applies nothing on any bad line", () => {
    const result = validateSettings({
      customEndpoints: ["1.2.3.4:443", "not a host!!", "5.6.7.8:9999"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.customEndpoints).toContain("line 2");
      expect(result.fields.customEndpoints).toContain("not a host!!");
    }
    const outOfFamily = validateSettings({ customEndpoints: ["9.9.9.9:22"] });
    expect(outOfFamily.ok).toBe(false);
    if (!outOfFamily.ok) {
      expect(outOfFamily.fields.customEndpoints).toContain("line 1");
      expect(outOfFamily.fields.customEndpoints).toContain("9.9.9.9:22");
    }
  });

  it("rejects non-string lines and over-limit lists instead of truncating", () => {
    expect(fieldsOf({ customEndpoints: [42] })["customEndpoints"]).toBeTruthy();
    const list = Array.from({ length: 80 }, (_, i) => `10.1.0.${i + 1}:443`);
    const result = validateSettings({ customEndpoints: list });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields.customEndpoints).toContain("too many");
    const presets = validateSettings({ cdnPresets: Array.from({ length: 70 }, (_, i) => `p-${i}`) });
    expect(presets.ok).toBe(false);
    if (!presets.ok) expect(presets.fields.cdnPresets).toContain("too many");
  });

  it("validates the WARP custom box with the same per-line discipline (any port allowed)", () => {
    expect(fieldsOf({ warpCustomEndpoints: ["bogus!!"] })["warpCustomEndpoints"]).toBeTruthy();
    expect(fieldsOf({ warpCustomEndpoints: [42] })["warpCustomEndpoints"]).toBeTruthy();
    const result = validateSettings({ warpCustomEndpoints: ["162.159.192.1:2408", "engage.cloudflareclient.com:500", "9.9.9.9:22"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warpCustomEndpoints).toEqual(["162.159.192.1:2408", "engage.cloudflareclient.com:500", "9.9.9.9:22"]);
    }
  });

  it("accepts preset id lists and drops nothing silently", () => {
    expect(fieldsOf({ cdnPresets: "nope" })["cdnPresets"]).toBeTruthy();
    expect(fieldsOf({ cdnPresets: [42] })["cdnPresets"]).toBeTruthy();
    const result = validateSettings({ cdnPresets: ["cf-443-a", "cf-80-a"], warpPresets: ["default", "nope"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cdnPresets).toEqual(["cf-443-a", "cf-80-a"]);
      expect(result.value.warpPresets).toEqual(["default", "nope"]);
    }
  });
});

describe("telegram settings block", () => {
  const VALID_TOKEN = `123456789:${"A".repeat(35)}`;

  it("defaults to a disabled empty bot", () => {
    const result = validateSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.telegram).toEqual({ enabled: false, botToken: "", chatId: "" });
  });

  it("accepts a full valid telegram patch", () => {
    const result = validateSettings({
      telegram: { enabled: true, botToken: VALID_TOKEN, chatId: "424242" },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.telegram).toEqual({ enabled: true, botToken: VALID_TOKEN, chatId: "424242" });
  });

  it("rejects a malformed token shape when enabled", () => {
    for (const token of ["not-a-token", "123456:" + "x".repeat(34), "abc:" + "x".repeat(35), "123456789:" + "x".repeat(36)]) {
      const result = validateSettings({ telegram: { enabled: true, botToken: token } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields["telegram.botToken"]).toBeTruthy();
    }
  });

  it("allows an unshaped token while disabled and accepts clearing it", () => {
    const result = validateSettings({ telegram: { enabled: false, botToken: "garbage" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.telegram.botToken).toBe("garbage");
    const cleared = validateSettings({ telegram: { enabled: false, botToken: "", chatId: "" } });
    expect(cleared.ok).toBe(true);
  });

  it("rejects non-numeric chat ids including @usernames", () => {
    for (const chatId of ["not valid", "@a", "12ab!", "@my_channel", "@OpsAlerts"]) {
      const result = validateSettings({ telegram: { chatId } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields["telegram.chatId"]).toMatch(/numeric/);
    }
  });

  it("accepts numeric, negative, and empty chat ids", () => {
    for (const chatId of ["424242", "-100999", ""]) {
      const result = validateSettings({ telegram: { chatId } });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.telegram.chatId).toBe(chatId);
    }
  });

  it("caps chat id length at 64 characters", () => {
    const result = validateSettings({ telegram: { chatId: "9".repeat(70) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields["telegram.chatId"]).toBeTruthy();
  });

  it("keeps token shape enforcement after a partial enable patch", () => {
    const result = validateSettings({ telegram: { botToken: VALID_TOKEN, chatId: "-100999", enabled: true } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.telegram.chatId).toBe("-100999");
      expect(result.value.telegram.enabled).toBe(true);
    }
    const badEnable = validateSettings({ telegram: { botToken: "garbage", chatId: "-100999", enabled: true } });
    expect(badEnable.ok).toBe(false);
    if (!badEnable.ok) expect(badEnable.fields["telegram.botToken"]).toBeTruthy();
  });

  it("rejects non-object telegram blocks", () => {
    const result = validateSettings({ telegram: [1] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields.telegram).toBe("must be an object");
  });
});

describe("ssrf guards", () => {
  it("rejects private proxyIps entries at save", () => {
    for (const entry of ["127.0.0.1", "10.0.0.5", "192.168.1.1:443", "localhost", "10.0.0.5:8443"]) {
      const result = validateSettings({ proxyIps: [entry] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields.proxyIps).toBeTruthy();
    }
    expect(validateSettings({ proxyIps: ["8.8.8.8", "93.184.216.34:443"] }).ok).toBe(true);
  });

  it("rejects private proxyIpPoolUrl and dohUpstream targets at save", () => {
    for (const url of [
      "http://127.0.0.1/ips.txt",
      "http://10.0.0.5/ips.txt",
      "http://192.168.1.1/ips.txt",
      "http://localhost/ips.txt",
    ]) {
      const result = validateSettings({ proxyIpPoolUrl: url });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields.proxyIpPoolUrl).toBeTruthy();
    }
    expect(validateSettings({ proxyIpPoolUrl: "https://pool.example/ips.txt" }).ok).toBe(true);
  });

  it("omits private and Cloudflare proxyIP candidates from the failover strategy", async () => {
    const s = makeTestSettings({ proxyIps: ["127.0.0.1", "10.0.0.5", "104.16.132.229", "8.8.8.8"] });
    const strategy = await makeFailoverStrategy(s, { host: "dest.example.com", port: 443 });
    const proxied = strategy.candidates.filter((c) => c.via === "proxyip").map((c) => c.host);
    expect(proxied).not.toContain("127.0.0.1");
    expect(proxied).not.toContain("10.0.0.5");
    expect(proxied).not.toContain("104.16.132.229");
    expect(proxied).toContain("8.8.8.8");
  });
});

describe("echAuto", () => {
  it("defaults to false and accepts explicit booleans", () => {
    const d = validateSettings({});
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.value.echAuto).toBe(false);
    expect(validateSettings({ echAuto: true }).ok).toBe(true);
    expect(validateSettings({ echAuto: false }).ok).toBe(true);
  });

  it("rejects non-boolean values", () => {
    expect(fieldsOf({ echAuto: "yes" }).echAuto).toBeTruthy();
    expect(fieldsOf({ echAuto: 1 }).echAuto).toBeTruthy();
  });

  it("still validates the manual server name shape when auto is on", () => {
    expect(validateSettings({ echAuto: true, echServerName: "edge.example.com" }).ok).toBe(true);
    expect(fieldsOf({ echAuto: true, echServerName: "localhost" }).echServerName).toBeTruthy();
    expect(validateSettings({ echAuto: true, echServerName: "" }).ok).toBe(true);
  });
});

describe("vlessFlow", () => {
  it("defaults to empty flow", () => {
    const d = validateSettings({});
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.value.vlessFlow).toBe("");
      expect("ssDirect" in d.value).toBe(false);
    }
    expect(validateSettings({ vlessFlow: "" }).ok).toBe(true);
    expect(validateSettings({ vlessFlow: "xtls-rprx-vision" }).ok).toBe(true);
  });

  it("accepts only known flows", () => {
    expect(fieldsOf({ vlessFlow: "xtls-rprx-vision-extra" }).vlessFlow).toBeTruthy();
    expect(fieldsOf({ vlessFlow: "vision" }).vlessFlow).toBeTruthy();
    expect(fieldsOf({ vlessFlow: 0 }).vlessFlow).toBeTruthy();
  });
});

describe("resolveEchServerName", () => {
  it("returns null when ECH is disabled", () => {
    expect(
      resolveEchServerName(makeTestSettings({ echEnabled: false, echAuto: true }), "edge.example.com"),
    ).toEqual({ name: null, warning: null });
    expect(
      resolveEchServerName(
        makeTestSettings({ echEnabled: false, echServerName: "manual.example.com" }),
        "edge.example.com",
      ),
    ).toEqual({ name: null, warning: null });
  });

  it("prefers the manual override over auto derivation", () => {
    const auto = makeTestSettings({
      echEnabled: true,
      echAuto: true,
      echServerName: "manual.example.com",
    });
    expect(resolveEchServerName(auto, "edge.example.com")).toEqual({
      name: "manual.example.com",
      warning: null,
    });
    const legacy = makeTestSettings({
      echEnabled: true,
      echAuto: false,
      echServerName: "manual.example.com",
    });
    expect(resolveEchServerName(legacy, "edge.example.com")).toEqual({
      name: "manual.example.com",
      warning: null,
    });
  });

  it("derives the SNI when auto is on and no manual name is set", () => {
    const s = makeTestSettings({ echEnabled: true, echAuto: true, echServerName: "" });
    expect(resolveEchServerName(s, "edge.example.com")).toEqual({
      name: "edge.example.com",
      warning: null,
    });
  });

  it("warns instead of emitting when auto cannot derive a usable name", () => {
    const s = makeTestSettings({ echEnabled: true, echAuto: true, echServerName: "" });
    for (const sni of [null, "", "  ", "127.0.0.1", "localhost", "not a host!"]) {
      const r = resolveEchServerName(s, sni);
      expect(r.name).toBeNull();
      expect(r.warning).toBeTruthy();
    }
  });

  it("keeps the legacy SNI fallback without warnings when auto is off", () => {
    const s = makeTestSettings({ echEnabled: true, echAuto: false, echServerName: "" });
    expect(resolveEchServerName(s, "edge.example.com")).toEqual({
      name: "edge.example.com",
      warning: null,
    });
  });

  it("trims surrounding whitespace", () => {
    const s = makeTestSettings({ echEnabled: true, echAuto: true, echServerName: "  " });
    expect(resolveEchServerName(s, "  edge.example.com  ")).toEqual({
      name: "edge.example.com",
      warning: null,
    });
  });
});

describe("subscription settings block (B1)", () => {
  it("defaults subName/skipCertVerify/subConverter", () => {
    const result = validateSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subName).toBe("");
      expect(result.value.skipCertVerify).toBe(false);
      expect(result.value.subConverter).toEqual({
        api: "",
        config: "",
        emoji: false,
        list: false,
        udp: false,
        xudp: false,
        tls13: false,
        appendType: false,
        sort: false,
        expand: true,
      });
    }
  });

  it("accepts a full valid subscription patch", () => {
    const result = validateSettings({
      subName: "MySub 1",
      skipCertVerify: true,
      subConverter: {
        api: "https://sub.example.com",
        config: "https://example.com/rules.ini",
        emoji: true,
        list: true,
        udp: true,
        xudp: true,
        tls13: true,
        appendType: true,
        sort: true,
        expand: false,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subName).toBe("MySub 1");
      expect(result.value.skipCertVerify).toBe(true);
      expect(result.value.subConverter.api).toBe("https://sub.example.com");
      expect(result.value.subConverter.expand).toBe(false);
    }
  });

  it("trims and token-checks subName, empty falls back", () => {
    expect(validateSettings({ subName: "  " }).ok).toBe(true);
    if (validateSettings({ subName: "  " }).ok) {
      const v = validateSettings({ subName: "  Pad " });
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.value.subName).toBe("Pad");
    }
    for (const bad of ["a/b", "x?y", "semi;colon", "quote\"q", "back\\slash", "a".repeat(65)]) {
      expect(fieldsOf({ subName: bad }).subName, bad).toBeTruthy();
    }
    expect(fieldsOf({ subName: 42 }).subName).toBeTruthy();
  });

  it("requires exact booleans for skipCertVerify and converter flags", () => {
    expect(fieldsOf({ skipCertVerify: "yes" }).skipCertVerify).toBeTruthy();
    expect(fieldsOf({ subConverter: { emoji: 1 } })["subConverter.emoji"]).toBeTruthy();
    expect(fieldsOf({ subConverter: { sort: "true" } })["subConverter.sort"]).toBeTruthy();
  });

  it("requires http(s) converter urls and guards the api against local targets", () => {
    expect(fieldsOf({ subConverter: { api: "ftp://x/sub" } })["subConverter.api"]).toBeTruthy();
    expect(fieldsOf({ subConverter: { api: "not-a-url" } })["subConverter.api"]).toBeTruthy();
    expect(fieldsOf({ subConverter: { config: "ftp://x/rules.ini" } })["subConverter.config"]).toBeTruthy();
    for (const local of ["http://127.0.0.1/sub", "http://10.0.0.5/sub", "http://localhost/sub"]) {
      expect(fieldsOf({ subConverter: { api: local } })["subConverter.api"], local).toBeTruthy();
    }
    expect(validateSettings({ subConverter: { api: "https://sub.example.com" } }).ok).toBe(true);
    expect(validateSettings({ subConverter: { api: "", config: "" } }).ok).toBe(true);
    // config is never fetched server-side: any public http(s) URL is fine
    expect(validateSettings({ subConverter: { config: "http://cdn.example/rules.ini" } }).ok).toBe(true);
  });

  it("rejects non-object subConverter blocks", () => {
    const result = validateSettings({ subConverter: [1] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields.subConverter).toBe("must be an object");
  });
});

describe("allowedIps", () => {
  it("defaults to an empty list that allows all", () => {
    const result = validateSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.allowedIps).toEqual([]);
  });

  it("accepts exact ips and cidr ranges in v4 and v6", () => {
    const list = ["203.0.113.9", "10.0.0.0/8", "2001:db8::1", "2001:db8::/32"];
    const result = validateSettings({ allowedIps: list });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.allowedIps).toEqual(list);
  });

  it("trims, dedupes and drops empty entries", () => {
    const result = validateSettings({ allowedIps: ["  203.0.113.9 ", "203.0.113.9", "", "   "] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.allowedIps).toEqual(["203.0.113.9"]);
  });

  it("rejects hostnames, malformed cidrs and non-string entries", () => {
    expect(fieldsOf({ allowedIps: ["example.com"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: ["1.2.3.4/33"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: ["1.2.3.4/"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: ["1.2.3.4/24/5"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: ["1.2.3.4/abc"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: ["2001:db8::/129"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: ["not an ip"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: ["1.2.3.4:443"] }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: "1.2.3.4" }).allowedIps).toBeTruthy();
    expect(fieldsOf({ allowedIps: [42] }).allowedIps).toBeTruthy();
  });

  it("rejects over-limit lists instead of truncating", () => {
    const list = Array.from({ length: 70 }, (_, i) => `203.0.113.${(i % 250) + 1}`);
    const result = validateSettings({ allowedIps: list });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields.allowedIps).toContain("too many");
    const bypass = validateSettings({
      routingRules: { customBypass: Array.from({ length: 210 }, (_, i) => `example-${i}.com`) },
    });
    expect(bypass.ok).toBe(false);
    if (!bypass.ok) expect(bypass.fields["routingRules.customBypass"]).toContain("too many");
  });
});
