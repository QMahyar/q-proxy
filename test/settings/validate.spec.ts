import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../../src/types/settings";
import { validateSettings } from "../../src/settings/validate";
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

  it("range-checks numeric fields", () => {
    for (const [key, value] of [
      ["earlyDataMaxBytes", -1],
      ["earlyDataMaxBytes", 8193],
      ["earlyDataMaxBytes", 1.5],
      ["urlTestIntervalSec", 59],
      ["urlTestIntervalSec", 86401],
      ["subUpdateIntervalHours", 0],
      ["subUpdateIntervalHours", 169],
      ["maxNodesPerFormat", 2001],
    ] as Array<[string, number]>) {
      const fields = fieldsOf({ [key]: value });
      expect(fields[key]).toBeTruthy();
    }
    expect(validateSettings({ maxNodesPerFormat: 2000 }).ok).toBe(true);
    expect(validateSettings({ earlyDataMaxBytes: 8192 }).ok).toBe(true);
    expect(validateSettings({ urlTestIntervalSec: 60 }).ok).toBe(true);
  });

  it("enforces Cloudflare port sets and keeps tls/plain disjoint", () => {
    expect(fieldsOf({ tlsPorts: [80] })["tlsPorts"]).toBeTruthy();
    expect(fieldsOf({ plainPorts: [443] })["plainPorts"]).toBeTruthy();
    expect(fieldsOf({ tlsPorts: [2053, 2053.5] })["tlsPorts"]).toBeTruthy();
    expect(fieldsOf({ tlsPorts: "443" })["tlsPorts"]).toBeTruthy();
    const result = validateSettings({ tlsPorts: [2053], plainPorts: [80, 8080] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const p of result.value.tlsPorts) expect(result.value.plainPorts).not.toContain(p);
    }
  });

  it("sanitizes string arrays: trim, dedupe, drop empties, cap counts", () => {
    const result = validateSettings({
      customDomains: [" a.com ", "", "b.com", "a.com"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.customDomains).toEqual(["a.com", "b.com"]);

    const many = validateSettings({
      customDomains: Array.from({ length: 25 }, (_, i) => `d${i}.example.com`),
      cleanIps: Array.from({ length: 70 }, (_, i) => `10.0.0.${i % 256}`),
      proxyIps: Array.from({ length: 70 }, (_, i) => `10.1.0.${i % 256}`),
      nat64Prefixes: Array.from({ length: 12 }, () => "[2a02:898:146:64::]"),
    });
    expect(many.ok).toBe(true);
    if (many.ok) {
      expect(many.value.customDomains.length).toBe(16);
      expect(many.value.cleanIps.length).toBeLessThanOrEqual(64);
      expect(many.value.proxyIps.length).toBeLessThanOrEqual(64);
      expect(many.value.nat64Prefixes.length).toBeLessThanOrEqual(8);
    }
  });

  it("drops invalid array items silently and rejects non-array input", () => {
    const result = validateSettings({ nat64Prefixes: ["[2a02::]", "not valid!!"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nat64Prefixes).toEqual(["[2a02::]"]);
    expect(fieldsOf({ cleanIps: "nope" })["cleanIps"]).toBeTruthy();
    expect(fieldsOf({ remoteSubUrls: [123] })["remoteSubUrls"]).toBeTruthy();
  });

  it("requires http(s) URLs in URL lists and url fields", () => {
    expect(fieldsOf({ remoteSubUrls: ["ftp://bad.example/sub"] })["remoteSubUrls"]).toBeTruthy();
    expect(validateSettings({ remoteSubUrls: ["https://ok.example/sub"] }).ok).toBe(true);
    expect(fieldsOf({ dohUpstream: "not-a-url" })["dohUpstream"]).toBeTruthy();
    expect(fieldsOf({ dohUpstream: "ftp://x" })["dohUpstream"]).toBeTruthy();
    expect(validateSettings({ remoteDns: "1.1.1.1" }).ok).toBe(true);
  });

  it("matches enums exactly", () => {
    expect(fieldsOf({ language: "fr" })["language"]).toBeTruthy();
    expect(fieldsOf({ ssMethod: "chacha20-poly1305" })["ssMethod"]).toBeTruthy();
    expect(fieldsOf({ fingerprint: "nope" })["fingerprint"]).toBeTruthy();
    expect(fieldsOf({ plainPortPolicy: "sometimes" })["plainPortPolicy"]).toBeTruthy();
    expect(fieldsOf({ proxyIpMode: "warp" })["proxyIpMode"]).toBeTruthy();
    expect(fieldsOf({ camouflage: { mode: "mirror" } })["camouflage.mode"]).toBeTruthy();
    expect(fieldsOf({ fragment: { mode: "ultra" } })["fragment.mode"]).toBeTruthy();
    expect(fieldsOf({ fragment: { packets: "9-9" } })["fragment.packets"]).toBeTruthy();
    expect(validateSettings({ language: "fa", fingerprint: "randomized" }).ok).toBe(true);
  });

  it("requires exact boolean types", () => {
    expect(fieldsOf({ killSwitch: "yes" })["killSwitch"]).toBeTruthy();
    expect(fieldsOf({ debugLogging: 1 })["debugLogging"]).toBeTruthy();
    expect(fieldsOf({ cdn: { enabled: null } })["cdn.enabled"]).toBeTruthy();
  });

  it("validates chainProxy uri only when enabled", () => {
    expect(fieldsOf({ chainProxy: { enabled: true, uri: "" } })["chainProxy.uri"]).toBeTruthy();
    expect(
      fieldsOf({ chainProxy: { enabled: true, uri: "https://h.example" } })["chainProxy.uri"],
    ).toBeTruthy();
    expect(validateSettings({ chainProxy: { enabled: true, uri: "socks5://u:p@h:1080" } }).ok).toBe(
      true,
    );
    expect(validateSettings({ chainProxy: { enabled: true, uri: "http://h:8080" } }).ok).toBe(true);
    expect(validateSettings({ chainProxy: { enabled: false, uri: "" } }).ok).toBe(true);
  });

  it("validates camouflage url only in proxy mode", () => {
    expect(fieldsOf({ camouflage: { mode: "proxy", url: "" } })["camouflage.url"]).toBeTruthy();
    expect(validateSettings({ camouflage: { mode: "static", url: "" } }).ok).toBe(true);
    expect(
      validateSettings({ camouflage: { mode: "proxy", url: "https://camo.example/page" } }).ok,
    ).toBe(true);
  });

  it("restricts alpn to the known token list", () => {
    expect(fieldsOf({ alpn: ["bogus/1"] })["alpn"]).toBeTruthy();
    const result = validateSettings({ alpn: ["HTTP/1.1", " h2 ", "h2", ""] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.alpn).toEqual(["http/1.1", "h2"]);
  });

  it("validates identity strings and paths", () => {
    expect(fieldsOf({ securePath: "has space" })["securePath"]).toBeTruthy();
    expect(fieldsOf({ securePath: "" })["securePath"]).toBeTruthy();
    expect(validateSettings({ securePath: "abc-DEF_123" }).ok).toBe(true);
    expect(fieldsOf({ vlessPath: "x!" })["vlessPath"]).toBeTruthy();
    expect(fieldsOf({ hostnameOverride: "bad host" })["hostnameOverride"]).toBeTruthy();
    expect(validateSettings({ hostnameOverride: "" }).ok).toBe(true);
    expect(fieldsOf({ passwordHash: 7 })["passwordHash"]).toBeTruthy();
    expect(validateSettings({ passwordHash: null, passwordSalt: null }).ok).toBe(true);
  });

  it("normalizes partial patches into a full Settings object", () => {
    const result = validateSettings({ profileTitle: "  Trimmed  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profileTitle).toBe("Trimmed");
      expect(result.value.tlsPorts).toEqual(DEFAULT_SETTINGS.tlsPorts);
      expect(result.value.fragment.packets).toBe("tlshello");
      expect(Object.keys(result.value).sort()).toEqual(
        Object.keys(DEFAULT_SETTINGS)
          .sort()
          .filter((k) => k !== "version" || true),
      );
    }
  });
});

describe("empty tlsPorts guard", () => {
  it("rejects an empty tlsPorts list with a clear message", () => {
    const result = validateSettings({ tlsPorts: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.tlsPorts).toContain("at least one TLS port");
    }
  });

  it("allows empty plainPorts (never policy)", () => {
    const result = validateSettings({ plainPorts: [] });
    expect(result.ok).toBe(true);
  });
});

describe("cleanIps with pinned ports", () => {
  it("normalizes ip:port entries and drops invalid lines", () => {
    const result = validateSettings({
      cleanIps: [
        "1.2.3.4:2053",
        " 5.6.7.8 ",
        "[2606:4700::1]:8443",
        "2606:4700::99",
        "edge.example.com",
        "edge.example.com:2096",
        "ijasdijkabd",
        "1.2.3.4:99999",
        "1.2.3.4:abc",
        ":8080",
        "",
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cleanIps).toEqual([
        "1.2.3.4:2053",
        "5.6.7.8",
        "[2606:4700::1]:8443",
        "[2606:4700::99]",
        "edge.example.com",
        "edge.example.com:2096",
      ]);
    }
  });

  it("dedupes entries after normalization", () => {
    const result = validateSettings({ cleanIps: ["1.2.3.4:443", "1.2.3.4:443", "  1.2.3.4:443 "] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cleanIps).toEqual(["1.2.3.4:443"]);
  });

  it("caps the list at 64 normalized entries", () => {
    const list = Array.from({ length: 80 }, (_, i) => `10.0.0.${i + 1}:443`);
    const result = validateSettings({ cleanIps: list });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.cleanIps.length).toBe(64);
  });
});
