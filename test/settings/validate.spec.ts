import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../../src/types/settings";
import { resolveEchServerName, validateSettings } from "../../src/settings/validate";
import { handleCamouflage } from "../../src/handlers/camouflage";
import { makeFailoverStrategy } from "../../src/tunnel/egress";
import { ASSETS } from "../../src/ui/assets";
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

  it("rejects local or private doh and remote dns targets", () => {
    expect(fieldsOf({ dohUpstream: "http://127.0.0.1:53/dns-query" }).dohUpstream).toBeTruthy();
    expect(fieldsOf({ dohUpstream: "https://localhost/dns-query" }).dohUpstream).toBeTruthy();
    expect(fieldsOf({ dohUpstream: "http://169.254.169.254/dns-query" }).dohUpstream).toBeTruthy();
    expect(fieldsOf({ remoteDns: "http://10.0.0.5/dns-query" }).remoteDns).toBeTruthy();
    expect(fieldsOf({ remoteDns: "192.168.1.1" }).remoteDns).toBeTruthy();
    expect(fieldsOf({ remoteDns: "192.168.1.1:443" }).remoteDns).toBeTruthy();
    expect(fieldsOf({ remoteDns: "127.0.0.1:53" }).remoteDns).toBeTruthy();
    expect(fieldsOf({ remoteDns: "localhost:3000" }).remoteDns).toBeTruthy();
    expect(validateSettings({ dohUpstream: "https://dns.google/dns-query" }).ok).toBe(true);
    expect(validateSettings({ remoteDns: "https://dns.google/dns-query" }).ok).toBe(true);
    expect(validateSettings({ remoteDns: "8.8.8.8" }).ok).toBe(true);
    expect(validateSettings({ remoteDns: "8.8.8.8:53" }).ok).toBe(true);
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

  it("normalizes a bare remoteDns host into an https dns-query URL", () => {
    const result = validateSettings({ remoteDns: "8.8.8.8" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.remoteDns).toBe("https://8.8.8.8/dns-query");
    const v6 = validateSettings({ remoteDns: "2606:4700::1111" });
    expect(v6.ok).toBe(true);
    if (v6.ok) expect(v6.value.remoteDns).toBe("https://[2606:4700::1111]/dns-query");
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

  it("enforces Cloudflare-proxied default ports and address ports", () => {
    expect(fieldsOf({ defaultPort: 9999 }).defaultPort).toBeTruthy();
    expect(fieldsOf({ defaultPort: 80 }).defaultPort).toBeTruthy();
    expect(validateSettings({ defaultPort: 443 }).ok).toBe(true);
    expect(validateSettings({ defaultPort: 2053 }).ok).toBe(true);
    expect(fieldsOf({ addresses: [{ address: "1.2.3.4", port: 9999 }] }).addresses).toBeTruthy();
  });

  it("sanitizes arrays: trim, dedupe, drop empties, cap counts", () => {
    const result = validateSettings({
      addresses: [{ address: "1.2.3.4" }, { address: " 1.2.3.4 " }, { address: "5.6.7.8" }],
      proxyIps: Array.from({ length: 70 }, (_, i) => `192.0.2.${(i % 250) + 1}`),
      nat64Prefixes: Array.from({ length: 12 }, () => "[2a02:898:146:64::]"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addresses.length).toBe(2);
      expect(result.value.proxyIps.length).toBeLessThanOrEqual(64);
      expect(result.value.nat64Prefixes.length).toBeLessThanOrEqual(8);
    }
  });

  it("drops invalid nat64 prefixes silently and rejects non-array address input", () => {
    const result = validateSettings({ nat64Prefixes: ["[2a02::]", "not valid!!"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nat64Prefixes).toEqual(["[2a02::]"]);
    expect(fieldsOf({ addresses: "nope" })["addresses"]).toBeTruthy();
    expect(fieldsOf({ addresses: [{ address: "1.2.3.4:99999" }] })["addresses"]).toBeTruthy();
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
    expect(fieldsOf({ proxyIpMode: "warp" })["proxyIpMode"]).toBeTruthy();
    expect(fieldsOf({ camouflage: { mode: "mirror" } })["camouflage.mode"]).toBeTruthy();
    expect(fieldsOf({ fragment: { mode: "ultra" } })["fragment.mode"]).toBeTruthy();
    expect(fieldsOf({ fragment: { packets: "9-9" } })["fragment.packets"]).toBeTruthy();
    expect(validateSettings({ language: "fa", fingerprint: "randomized" }).ok).toBe(true);
  });

  it("requires exact boolean types", () => {
    expect(fieldsOf({ killSwitch: "yes" })["killSwitch"]).toBeTruthy();
    expect(fieldsOf({ debugLogging: 1 })["debugLogging"]).toBeTruthy();
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
    expect(fieldsOf({ addresses: [{ address: "bad host" }] })["addresses"]).toBeTruthy();
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
      expect(result.value.addresses).toEqual([]);
      expect(result.value.fragment.packets).toBe("tlshello");
      expect(Object.keys(result.value).sort()).toEqual(
        Object.keys(DEFAULT_SETTINGS)
          .sort()
          .filter((k) => k !== "version" || true),
      );
    }
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

  it("allows empty addresses (falls back to the worker hostname)", () => {
    expect(validateSettings({ addresses: [] }).ok).toBe(true);
  });
});

describe("addresses with pinned ports", () => {
  it("normalizes ip:port entries and drops inline ports into a port field", () => {
    const result = validateSettings({
      addresses: [
        { address: "1.2.3.4:2053" },
        { address: " 5.6.7.8 " },
        { address: "[2606:4700::1]:8443" },
        { address: "2606:4700::99" },
        { address: "edge.example.com" },
        { address: "edge.example.com:2096" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.addresses).toEqual([
        { address: "1.2.3.4", port: 2053 },
        { address: "5.6.7.8" },
        { address: "[2606:4700::1]", port: 8443 },
        { address: "[2606:4700::99]" },
        { address: "edge.example.com" },
        { address: "edge.example.com", port: 2096 },
      ]);
    }
  });

  it("caps the list at 64 normalized entries", () => {
    const list = Array.from({ length: 80 }, (_, i) => ({ address: `10.0.0.${i + 1}`, port: 443 }));
    const result = validateSettings({ addresses: list });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.addresses.length).toBe(64);
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
      telegram: { enabled: true, botToken: VALID_TOKEN, chatId: "@my_channel" },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.telegram).toEqual({ enabled: true, botToken: VALID_TOKEN, chatId: "@my_channel" });
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

  it("rejects chat ids that are not numeric or @names", () => {
    for (const chatId of ["not valid", "@a", "12ab!"]) {
      const result = validateSettings({ telegram: { chatId } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields["telegram.chatId"]).toBeTruthy();
    }
  });

  it("caps chat id length at 64 characters", () => {
    const result = validateSettings({ telegram: { chatId: "@" + "a".repeat(70) } });
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a private camouflage URL at save in proxy mode", () => {
    for (const url of [
      "http://127.0.0.1/page",
      "http://10.0.0.5/page",
      "http://192.168.1.1/page",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost/page",
      "http://[::1]/page",
    ]) {
      const result = validateSettings({ camouflage: { mode: "proxy", url } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields["camouflage.url"]).toBeTruthy();
    }
    expect(validateSettings({ camouflage: { mode: "proxy", url: "https://camo.example/page" } }).ok).toBe(true);
    expect(validateSettings({ camouflage: { mode: "static", url: "" } }).ok).toBe(true);
  });

  it("rejects a private chainProxy host at save when enabled", () => {
    for (const uri of [
      "socks5://127.0.0.1:1080",
      "socks5://10.0.0.5:1080",
      "http://192.168.1.1:8080",
      "http://localhost:8080",
      "socks5://[::1]:1080",
    ]) {
      const result = validateSettings({ chainProxy: { enabled: true, uri } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields["chainProxy.uri"]).toBeTruthy();
    }
    expect(validateSettings({ chainProxy: { enabled: true, uri: "socks5://chain.example:1080" } }).ok).toBe(true);
    expect(validateSettings({ chainProxy: { enabled: false, uri: "" } }).ok).toBe(true);
  });

  it("rejects private proxyIps entries at save", () => {
    for (const entry of ["127.0.0.1", "10.0.0.5", "192.168.1.1:443", "localhost", "10.0.0.5:8443"]) {
      const result = validateSettings({ proxyIps: [entry] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields.proxyIps).toBeTruthy();
    }
    expect(validateSettings({ proxyIps: ["8.8.8.8", "93.184.216.34:443"] }).ok).toBe(true);
  });

  it("blocks a camouflage redirect to a private host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data/" } })),
    );
    const res = await handleCamouflage(
      new Request("https://x/junk"),
      {} as never,
      makeTestSettings({ camouflage: { mode: "proxy", url: "https://camo.example/page" } }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ASSETS.camo);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("omits private and Cloudflare proxyIP candidates from the failover strategy", async () => {
    const s = makeTestSettings({ proxyIpMode: "proxyip", proxyIps: ["127.0.0.1", "10.0.0.5", "104.16.132.229", "8.8.8.8"] });
    const strategy = await makeFailoverStrategy(s, { host: "dest.example.com", port: 443 });
    const proxied = strategy.candidates.filter((c) => c.via === "proxyip").map((c) => c.host);
    expect(proxied).not.toContain("127.0.0.1");
    expect(proxied).not.toContain("10.0.0.5");
    expect(proxied).not.toContain("104.16.132.229");
    expect(proxied).toContain("8.8.8.8");
  });
});

describe("address country/city metadata", () => {
  it("normalizes country to uppercase", () => {
    const result = validateSettings({ addresses: [{ address: "1.2.3.4", country: "de" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.addresses).toEqual([{ address: "1.2.3.4", country: "DE" }]);
    const spaced = validateSettings({ addresses: [{ address: "1.2.3.4", country: " us " }] });
    expect(spaced.ok).toBe(true);
    if (spaced.ok) expect(spaced.value.addresses).toEqual([{ address: "1.2.3.4", country: "US" }]);
  });

  it("rejects non-2-letter country values", () => {
    for (const country of ["USA", "U", "U1", "12", "D-", "ABC", 42]) {
      const fields = fieldsOf({ addresses: [{ address: "1.2.3.4", country }] });
      expect(fields.addresses, `country ${String(country)}`).toBeTruthy();
    }
    expect(validateSettings({ addresses: [{ address: "1.2.3.4", country: "FR" }] }).ok).toBe(true);
  });

  it("trims city and caps it at 64 characters", () => {
    const result = validateSettings({ addresses: [{ address: "1.2.3.4", city: "  Berlin  " }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.addresses).toEqual([{ address: "1.2.3.4", city: "Berlin" }]);
    expect(fieldsOf({ addresses: [{ address: "1.2.3.4", city: "a".repeat(65) }] }).addresses).toBeTruthy();
    expect(validateSettings({ addresses: [{ address: "1.2.3.4", city: "a".repeat(64) }] }).ok).toBe(true);
    expect(fieldsOf({ addresses: [{ address: "1.2.3.4", city: 42 }] }).addresses).toBeTruthy();
  });

  it("treats empty country and city as absent", () => {
    const result = validateSettings({ addresses: [{ address: "1.2.3.4", country: "", city: "   " }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.addresses).toEqual([{ address: "1.2.3.4" }]);
  });

  it("keeps country and city together on one entry", () => {
    const result = validateSettings({
      addresses: [{ address: "1.2.3.4", country: "de", city: "Frankfurt", label: "DE-1" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.addresses).toEqual([
        { address: "1.2.3.4", label: "DE-1", country: "DE", city: "Frankfurt" },
      ]);
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

describe("vlessFlow and ssDirect", () => {
  it("default to empty flow and direct off", () => {
    const d = validateSettings({});
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.value.vlessFlow).toBe("");
      expect(d.value.ssDirect).toBe(false);
    }
    expect(validateSettings({ vlessFlow: "", ssDirect: false }).ok).toBe(true);
    expect(validateSettings({ vlessFlow: "xtls-rprx-vision", ssDirect: true }).ok).toBe(true);
  });

  it("accepts only known flows", () => {
    expect(fieldsOf({ vlessFlow: "xtls-rprx-vision-extra" }).vlessFlow).toBeTruthy();
    expect(fieldsOf({ vlessFlow: "vision" }).vlessFlow).toBeTruthy();
    expect(fieldsOf({ vlessFlow: 0 }).vlessFlow).toBeTruthy();
  });

  it("rejects non-boolean ssDirect values", () => {
    expect(fieldsOf({ ssDirect: "yes" }).ssDirect).toBeTruthy();
    expect(fieldsOf({ ssDirect: 1 }).ssDirect).toBeTruthy();
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

describe("totp settings block", () => {
  const SECRET = "JBSWY3DPEHPK3PXP";
  const DIGEST = "ab".repeat(32);

  it("defaults to disabled with no secret or codes", () => {
    const d = validateSettings({});
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.value.totp).toEqual({ enabled: false, secret: "", recoveryCodes: [] });
  });

  it("accepts a full valid totp patch and normalizes it", () => {
    const result = validateSettings({
      totp: { enabled: true, secret: "jbsw y3dp-ehpk 3pxp", recoveryCodes: [DIGEST.toUpperCase(), DIGEST] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.totp).toEqual({ enabled: true, secret: SECRET, recoveryCodes: [DIGEST] });
  });

  it("requires a secret when enabling", () => {
    expect(fieldsOf({ totp: { enabled: true } })["totp.secret"]).toBeTruthy();
    expect(fieldsOf({ totp: { enabled: true, secret: "" } })["totp.secret"]).toBeTruthy();
    expect(validateSettings({ totp: { enabled: true, secret: SECRET } }).ok).toBe(true);
  });

  it("rejects malformed secrets", () => {
    for (const secret of ["short", "JBSWY3DP", "JBSW!3DPEHPK3PXP", "JBSWY3DPEHPK3PX0", "JBSWY3DPEHPK3PX8", "JBSWY3DPEHPK3PX1"]) {
      expect(fieldsOf({ totp: { secret } })["totp.secret"]).toBeTruthy();
    }
    expect(validateSettings({ totp: { secret: SECRET } }).ok).toBe(true);
  });

  it("validates recovery code shape strictly", () => {
    expect(fieldsOf({ totp: { recoveryCodes: "nope" } })["totp.recoveryCodes"]).toBeTruthy();
    expect(fieldsOf({ totp: { recoveryCodes: [42] } })["totp.recoveryCodes"]).toBeTruthy();
    expect(fieldsOf({ totp: { recoveryCodes: ["xyz"] } })["totp.recoveryCodes"]).toBeTruthy();
    expect(validateSettings({ totp: { recoveryCodes: ["AB".repeat(32)] } }).ok).toBe(true);
    expect(fieldsOf({ totp: { recoveryCodes: Array.from({ length: 17 }, (_, i) => String(i).padStart(64, "0")) } })["totp.recoveryCodes"]).toBeTruthy();
    expect(validateSettings({ totp: { recoveryCodes: [] } }).ok).toBe(true);
  });

  it("rejects non-object totp blocks and non-boolean flags", () => {
    expect(fieldsOf({ totp: [1] }).totp).toBe("must be an object");
    expect(fieldsOf({ totp: { enabled: "yes" } })["totp.enabled"]).toBeTruthy();
  });

  it("keeps totp out of the round-trip fixture", () => {
    const result = validateSettings(makeTestSettings());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(makeTestSettings());
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
});
