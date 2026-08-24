import { describe, expect, it } from "vitest";
import { ASSETS } from "../../src/ui/assets";

const TOTAL_BUDGET_BYTES = 120 * 1024;

describe("ui/assets", () => {
  it("exports exactly panel, login and camo as non-empty strings", () => {
    expect(Object.keys(ASSETS).sort()).toEqual(["camo", "login", "panel"]);
    expect(typeof ASSETS.panel).toBe("string");
    expect(typeof ASSETS.login).toBe("string");
    expect(typeof ASSETS.camo).toBe("string");
    expect(ASSETS.panel.length).toBeGreaterThan(10_000);
    expect(ASSETS.login.length).toBeGreaterThan(1_000);
    expect(ASSETS.camo.length).toBeGreaterThan(500);
  });

  it("keeps the combined bundle under the size budget", () => {
    const total =
      Buffer.byteLength(ASSETS.panel, "utf8") +
      Buffer.byteLength(ASSETS.login, "utf8") +
      Buffer.byteLength(ASSETS.camo, "utf8");
    expect(total).toBeLessThan(TOTAL_BUDGET_BYTES);
  });
});

describe("panel html", () => {
  const html = ASSETS.panel;

  it("is a self-contained dark document with RTL bootstrapping", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toMatch(/<html lang="(en|fa)" dir="(rtl|ltr)">/);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("document.documentElement.dir");
    expect(html).toContain("#0a0e14");
    expect(html).toContain("#22d3ee");
    expect(html.toLowerCase()).not.toContain("<script src=");
    expect(html.toLowerCase()).not.toContain("<link ");
    expect(html).not.toContain("@import");
  });

  it("hash-routes the three views with aria tab semantics", () => {
    expect(html).toContain('id="view-home"');
    expect(html).toContain('id="view-settings"');
    expect(html).toContain('id="view-checker"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain("role='tabpanel'");
    expect(html).toContain("'sp-'+s.key");
    expect(html).toContain("#/settings/");
    expect(html).toContain("#/checker");
  });

  it("embeds the bilingual dictionary with Persian content", () => {
    expect(html).toContain("'app.name':'Q Proxy'");
    expect(html).toContain("'nav.home':'Home'");
    expect(html).toContain("'nav.home':'خانه'");
    expect(html).toContain("'tabs.settings.general':'General'");
    expect(html).toContain("'tabs.settings.general':'عمومی'");
    expect(html).toContain("\u200C");
    expect(html).toContain("'err.invalid_line'");
    expect(html).toContain("{count}");
  });

  it("persists language via the qp_lang cookie", () => {
    expect(html).toContain("qp_lang=");
    expect(html).toContain("Max-Age=31536000");
    expect(html).toContain("SameSite=Lax");
  });

  it("talks to every frozen panel API endpoint", () => {
    expect(html).toContain("api/settings");
    expect(html).toContain("api/settings/save");
    expect(html).toContain("api/settings/reset");
    expect(html).toContain("api/killswitch");
    expect(html).toContain("api/suburls");
    expect(html).toContain("api/status");
    expect(html).toContain("api/auth/logout");
    expect(html).toContain("my-ip");
    expect(html).toContain("X-Q-Panel");
    expect(html).toContain("credentials:'same-origin'");
  });

  it("ships an embedded byte-mode QR encoder with ECC M up to version 25", () => {
    expect(html).toContain("QR.render(");
    expect(html).toContain("0x11d");
    expect(html).toContain("0x537");
    expect(html).toContain("0x5412");
    expect(html).toContain("[10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28]");
    expect(html).toContain("[1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21]");
    expect(html).toContain("qr-canvas");
  });

  it("covers settings controls grouped into seven sections", () => {
    for (const section of ["general", "protocols", "ports", "proxyip", "fragment", "chain", "advanced"]) {
      expect(html).toContain(`'${section}'`);
      expect(html).toContain(`key:'${section}'`);
    }
    for (const bind of [
      "securePath",
      "profileTitle",
      "debugLogging",
      "vlessEnabled",
      "vlessUuid",
      "vmessUuid",
      "trojanPassword",
      "ssMethod",
      "earlyDataMaxBytes",
      "fingerprint",
      "randomizeSniCase",
      "customDomains",
      "hostnameOverride",
      "tlsPorts",
      "plainPorts",
      "plainPortPolicy",
      "cleanIps",
      "remoteSubUrls",
      "cdn.enabled",
      "cdn.sni",
      "proxyIpMode",
      "nat64Prefixes",
      "fragment.mode",
      "fragment.packets",
      "fragment.lengthMin",
      "fragment.lengthMax",
      "fragment.delayMin",
      "fragment.delayMax",
      "fragment.maxSplitMin",
      "fragment.maxSplitMax",
      "chainProxy.enabled",
      "chainProxy.uri",
      "enableUdp53",
      "dohUpstream",
      "urlTestIntervalSec",
      "subUpdateIntervalHours",
      "maxNodesPerFormat",
      "speedtestIntercept",
      "camouflage.mode",
      "camouflage.url",
    ]) {
      expect(html).toContain(`'${bind}'`);
    }
  });

  it("implements dirty-state apply bar, validation errors and confirms", () => {
    expect(html).toContain('id="applybar"');
    expect(html).toContain("data-action=\"apply\"");
    expect(html).toContain("data-action=\"discard\"");
    expect(html).toContain("data-action=\"reset-defaults\"");
    expect(html).toContain("field--error");
    expect(html).toContain("aria-invalid");
    expect(html).toContain("confirmDialog(");
    expect(html).toContain("beforeunload");
    expect(html).toContain("fields");
  });

  it("runs the proxy-ip checker client-side against cdn-cgi trace", () => {
    expect(html).toContain("cdn-cgi/trace");
    expect(html).toContain("mode:'no-cors'");
    expect(html).toContain("run-test");
    expect(html).toContain("stop-test");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("ck-targets");
  });

  it("renders subscriptions from api/suburls with copy fields and a QR modal", () => {
    expect(html).toContain("copy-field");
    expect(html).toContain('id="m-qr"');
    expect(html).toContain("mode=fragment");
    expect(html).toContain("aria-modal=\"true\"");
  });
});

describe("login html", () => {
  const html = ASSETS.login;

  it("is self-contained and bilingual", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toMatch(/<html lang="(en|fa)" dir="(rtl|ltr)">/);
    expect(html).toContain("document.cookie.match(/(?:^|;\\s*)qp_lang=(en|fa)/)");
    expect(html).toContain("'setup.title':'Create passphrase'");
    expect(html).toContain("گذرواژه");
    expect(html.toLowerCase()).not.toContain("<script src=");
  });

  it("posts credentials with the CSRF header and handles both first-run signals", () => {
    expect(html).toContain("auth/login");
    expect(html).toContain("auth/setup");
    expect(html).toContain("SETUP_REQUIRED");
    expect(html).toContain("hasPassword===false");
    expect(html).toContain("ALREADY_SET");
    expect(html).toContain("X-Q-Panel");
    expect(html).toContain("newPassword");
    expect(html).toContain("Retry-After");
  });

  it("redirects into the panel on success", () => {
    expect(html).toContain("location.replace(BASE+'panel')");
  });
});

describe("camo html", () => {
  const html = ASSETS.camo;

  it("is an innocuous static page with zero scripts and zero project references", () => {
    expect(html).toContain("<!doctype html>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("proxy");
    expect(html.toLowerCase()).not.toContain("vpn");
    expect(html.toLowerCase()).not.toContain("q-proxy");
    expect(html.toLowerCase()).not.toContain("http://");
    expect(html.toLowerCase()).not.toContain("https://");
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });
});
