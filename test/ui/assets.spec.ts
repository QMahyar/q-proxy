import { describe, expect, it } from "vitest";
import { ASSETS } from "../../src/ui/assets";
import { buildSubUrls } from "../../src/handlers/api/status";

const TOTAL_BUDGET_BYTES = 256 * 1024;

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
    expect(html).toContain("#05080f");
    expect(html).toContain("#22d3ee");
    expect(html.toLowerCase()).not.toContain("<script src=");
    expect(html).not.toContain('href="http');
    expect(html).not.toContain("src=");
    expect(html).not.toContain("@import");
  });

  it("hash-routes the two views with aria tab semantics", () => {
    expect(html).toContain('id="view-home"');
    expect(html).toContain('id="view-settings"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain("role='tabpanel'");
    expect(html).toContain("'sp-'+s.key");
    expect(html).toContain("#/settings/");
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
    expect(html).toContain("api/bootstrap");
    expect(html).toContain("api/settings/save");
    expect(html).toContain("api/settings/reset");
    expect(html).toContain("api/killswitch");
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

  it("covers settings controls grouped into sections", () => {
    for (const section of ["general", "protocols", "addresses", "egress", "fragment", "chain", "advanced", "users", "warp", "sources"]) {
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
      "addresses",
      "defaultPort",
      "nameTemplate",
      "remoteSubUrls",
      "proxyIpMode",
      "proxyIps",
      "proxyIpPoolUrl",
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

  it("renders subscriptions from api/suburls with copy fields and a QR modal", () => {
    expect(html).toContain("copy-field");
    expect(html).toContain('id="m-qr"');
    expect(html).toContain("mode=fragment");
    expect(html).toContain("aria-modal=\"true\"");
  });
});

describe("panel ui p08", () => {
  const html = ASSETS.panel;

  it("binds routingRules.blockAds and blockMalware toggles with entries in both dictionaries", () => {
    expect(html).toContain("FL('routingRules.blockAds','bool'");
    expect(html).toContain("FL('routingRules.blockMalware','bool'");
    expect(html).toContain("'routing.blockAds.label':'Block ad domains'");
    expect(html).toContain("'routing.blockAds.label':'مسدودسازی دامنه‌های تبلیغاتی'");
    expect(html).toContain("'routing.blockMalware.label':'Block malware domains'");
    expect(html).toContain("'routing.blockMalware.label':'مسدودسازی دامنه‌های مخرب'");
    expect(html).toContain("'routing.blockQuic.label'");
  });

  it("has a dedicated Save label for edit modals in both languages", () => {
    expect(html).toContain("'common.save':'Save'");
    expect(html).toContain("'common.save':'ذخیره'");
    expect(html).not.toContain(".replace(/…/");
  });

  it("drops dead ids, rules and dictionary keys", () => {
    expect(html).not.toContain("#warp-live");
    expect(html).not.toContain(".gem{");
    for (const key of [
      "home.stats.updated",
      "home.stats.ip",
      "home.stats.isp",
      "common.optional",
      "common.on",
      "common.off",
      "common.enabled",
      "common.disabled",
      "common.openChecker",
      "err.minmax",
      "protocols.enable",
      "toast.pathRegenerated",
      "app.tagline",
      "login.title",
      "login.password",
    ]) {
      expect(html).not.toContain(`'${key}':`);
    }
  });

  it("keeps the 'Panel info' label literal in parity between producer and consumer", () => {
    const produced = buildSubUrls("example.workers.dev", "p").map((e) => e.label);
    const consumed = [...html.matchAll(/u\.label!=='([^']+)'/g)].map((m) => m[1]);
    expect(produced.length).toBeGreaterThan(0);
    expect(consumed.length).toBeGreaterThan(0);
    for (const label of consumed) {
      expect(produced).toContain(label);
    }
    expect(produced).toContain("Panel info");
    expect(consumed).toContain("Panel info");
  });

  it("refreshes subscriptions and warns before a securePath change is applied", () => {
    expect(html).toContain("async function refreshSubUrls()");
    expect(html).toContain("confirm.securepath_title");
    expect(html).toContain("confirm.securepath_body");
    expect(html).toMatch(/patch\.securePath!==undefined&&!\(await confirmDialog/);
    expect(html).toMatch(/sec==='general'\|\|sec==='addresses'/);
  });

  it("navigates to the new base after a securePath change instead of refreshing under the old one", () => {
    const guard = /patch\.securePath!==undefined\)\{const nb='\/'\+String\(cur\.securePath\|\|''\)\.replace\(\/\^\\\/\+\|\\\/\+\$\/g,''\);location\.replace\(nb\+'\/panel'\);return\}/;
    expect(html).toMatch(guard);
    const guardIdx = html.search(guard);
    expect(guardIdx).toBeGreaterThan(html.indexOf("t('toast.settingsSaved')"));
    expect(guardIdx).toBeLessThan(html.indexOf("sec==='general'||sec==='addresses')await"));
  });

  it("keeps language toggle labels present in both dictionaries", () => {
    expect(html.match(/'lang\.en':'English'/g)?.length).toBe(2);
    expect(html.match(/'lang\.fa':'فارسی'/g)?.length).toBe(2);
  });

  it("folds the kill chip updates into syncKillUI only", () => {
    expect(html).not.toContain("updateInstantKillChip");
    expect(html).toContain("data-kill-chip");
    expect(html.match(/function syncKillUI/g)?.length).toBe(1);
  });

  it("applies the fragment preset disabled state on initial paint", () => {
    expect(html).toContain("function applyFragmentPresetUi(mode)");
    expect(html).toMatch(/applyFragmentPresetUi\(String\(getPath\(S\.set,'fragment\.mode'\)\|\|'off'\)\)/);
  });

  it("shows a retryable error state instead of an empty users table on failure", () => {
    expect(html).toContain("usersLoadFailed");
    expect(html).toContain("data-action=\"users-reload\"");
    expect(html).toContain("'users.load_failed'");
    expect(html).toContain("'common.retry'");
  });

  it("keeps accent swatches visible on mobile and offers QR PNG download", () => {
    expect(html).not.toContain(".swatches{display:none}");
    expect(html).toContain(".swatches{display:flex;flex-wrap:wrap");
    expect(html).toContain('id="qr-download"');
    expect(html).toContain("toDataURL('image/png')");
  });

  it("localizes previously hardcoded aria labels", () => {
    expect(html).not.toContain('aria-label="QR"');
    expect(html).not.toContain('aria-label="Close"><svg');
    expect(html).not.toContain('aria-label="Edit"');
    expect(html).not.toContain('aria-label="Delete"');
    expect(html).not.toContain('aria-label="Cyan"');
    expect(html).toContain("t('accent.'+(b.dataset.accent||'cyan'))");
  });
});

describe("panel ui p18", () => {
  const html = ASSETS.panel;

  const SECURITY_KEYS = [
    "security.title",
    "security.current",
    "security.new",
    "security.confirm",
    "security.hint",
    "security.change",
    "security.changed",
    "security.wrong_current",
    "security.mismatch",
    "security.rule",
  ];

  it("renders a Security card in the settings general section", () => {
    expect(html).toContain("{title:'security.title',security:true,fields:[]}");
    expect(html).toContain('id="sec-cur"');
    expect(html).toContain('id="sec-new"');
    expect(html).toContain('id="sec-confirm"');
    expect(html).toMatch(/id="sec-cur"[^>]*autocomplete="current-password"/);
    expect(html.match(/autocomplete="new-password"/g)?.length).toBe(2);
    for (const id of ["sec-cur", "sec-new", "sec-confirm"]) {
      expect(html).toContain(`data-target="${id}"`);
      expect(html).toContain(`id="fw-${id === "sec-confirm" ? "sec-cf" : id}"`);
    }
    expect(html).toContain('data-action="change-password"');
  });

  it("registers every security dict key in both languages", () => {
    for (const key of SECURITY_KEYS) {
      const defs = html.match(new RegExp(`'${key}':`, "g")) ?? [];
      expect(defs.length).toBe(2);
    }
    expect(html).toContain("'security.changed':'Passphrase changed — other devices signed out'");
    expect(html).toContain("'security.mismatch':'Passphrases do not match'");
    expect(html).toContain("'security.title':'امنیت'");
    expect(html).toContain("'security.mismatch':'دو گذرواژه یکسان نیستند'");
  });

  it("wires change-password through the api helper with inline error handling", () => {
    expect(html).toContain("'change-password'(el)");
    expect(html).toContain("api/auth/password");
    expect(html).toMatch(
      /api\('api\/auth\/password',\{method:'POST',body:\{currentPassword:cur\.value,newPassword:nw\.value\},keep401:true\}\)/,
    );
    expect(html).toMatch(/r\.status===401&&!o\.keep401/);
    expect(html).toMatch(/nw\.value\.length<8/);
    expect(html).toMatch(/nw\.value!==cf\.value/);
    expect(html).toContain("t('security.rule')");
    expect(html).toContain("t('security.mismatch')");
    expect(html).toContain("t('security.wrong_current')");
    expect(html).toContain("err.fields.newPassword");
    expect(html).toContain("t('security.changed')");
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
    expect(html).not.toContain("hasPassword");
    expect(html).toContain("ALREADY_SET");
    expect(html).toContain("X-Q-Panel");
    expect(html).toContain("newPassword");
    expect(html).toContain("Retry-After");
  });

  it("bounces authed visitors via the api/settings ok-envelope before rendering either card", () => {
    expect(html).toContain("fetch(BASE+'api/settings'");
    expect(html).toMatch(/if\(d\.ok&&j&&j\.ok&&j\.data\)\{\s*goPanel\(\);\s*return\s*\}/);
    expect(html).toMatch(/catch\(e\)\{\}\s*renderLogin\(\)\}\)\(\)/);
    expect(html).not.toContain("hasPassword");
  });

  it("redirects into the panel on success", () => {
    expect(html).toContain("location.replace(BASE+'panel')");
  });

  it("localizes the toast close label in both dictionaries", () => {
    expect(html).toContain("'common.close':'Close'");
    expect(html).toContain("'common.close':'بستن'");
    expect(html).toContain("aria-label=\"'+t('common.close')+'\"");
    expect(html).not.toContain('aria-label="Close"');
  });
});

describe("panel ui p20 light theme", () => {
  it("has data-theme light overrides keeping accent-rgb unchanged and light-dark color-scheme", () => {
    for (const html of [ASSETS.panel, ASSETS.login]) {
      expect(html).toContain('content="light dark"');
      expect(html).toContain('html[data-theme="light"]');
      expect(html).toContain("--bg:#f8fafc");
      expect(html).toContain("--text:#0f172a");
      const lightBlocks = html.match(/html\[data-theme="light"\][^{]*\{[^}]+\}/g) ?? [];
      for (const block of lightBlocks) expect(block).not.toContain("--accent-rgb:");
    }
  });

  it("implements the shared theme controller with qp_theme storage and matchMedia", () => {
    for (const html of [ASSETS.panel, ASSETS.login]) {
      expect(html).toContain("qp_theme");
      expect(html).toContain("THEME_KEY");
      expect(html).toContain("getTheme()");
      expect(html).toContain("applyTheme");
      expect(html).toContain("dataset.theme");
      expect(html).toContain("style.colorScheme");
      expect(html).toContain("matchMedia('(prefers-color-scheme: light)'");
      expect(html).toContain("prefers-color-scheme: light");
    }
  });

  it("exposes a theme toggle button near the language segment with correct selectors", () => {
    expect(ASSETS.panel).toContain('id="theme-toggle"');
    expect(ASSETS.panel).toContain('data-action="theme-toggle"');
    expect(ASSETS.login).toContain('id="theme-toggle"');
    expect(ASSETS.panel).toContain("#i-sun");
    expect(ASSETS.panel).toContain("#i-moon");
    expect(ASSETS.login).toContain("#i-sun");
    expect(ASSETS.login).toContain("#i-moon");
  });

  it("registers theme dictionary keys symmetrically and keeps toggle aria-label via dict", () => {
    for (const html of [ASSETS.panel, ASSETS.login]) {
      expect(html).toContain("'common.theme':");
      expect(html).toContain("'common.theme_toggle':");
      expect(html).toContain("'common.theme_light':");
      expect(html).toContain("'common.theme_dark':");
      expect(html.match(/'common\.theme':/g)?.length).toBe(2);
      expect(html.match(/'common\.theme_toggle':/g)?.length).toBe(2);
    }
    expect(ASSETS.panel).toContain("common.theme_toggle");
    expect(ASSETS.panel).toContain("common.theme_light");
    expect(ASSETS.panel).toContain("common.theme_dark");
    expect(ASSETS.panel).toContain("'common.theme_toggle':'Toggle theme'");
    expect(ASSETS.panel).toContain("'common.theme_toggle':'تغییر تم'");
    expect(ASSETS.login).toContain("'common.theme_toggle':'Toggle theme'");
    expect(ASSETS.login).toContain("'common.theme_toggle':'تغییر تم'");
  });

  it("stays inline with no external resources and cycles theme on click", () => {
    for (const html of [ASSETS.panel, ASSETS.login]) {
      expect(html.toLowerCase()).not.toContain("<script src=");
      expect(html).not.toContain('href="http');
      expect(html).not.toContain("@import");
      expect(html).toContain("localStorage.getItem");
      expect(html).toContain("localStorage.setItem");
    }
    expect(ASSETS.panel).toContain("'theme-toggle'");
    expect(ASSETS.login).toContain("toggleTheme");
  });
});

describe("camo html", () => {
  const html = ASSETS.camo;

  it("is an innocuous static page with exactly one year-setter script and zero project references", () => {
    expect(html).toContain("<!doctype html>");
    expect((html.match(/<script/g) ?? []).length).toBe(1);
    const inline = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1] ?? "";
    expect(inline).toMatch(/getElementById\('y'\)\.textContent\s*=\s*new\s+Date\(\)\.getFullYear\(\)/);
    expect(html.toLowerCase()).not.toContain("proxy");
    expect(html.toLowerCase()).not.toContain("vpn");
    expect(html.toLowerCase()).not.toContain("q-proxy");
    expect(html.toLowerCase()).not.toContain("http://");
    expect(html.toLowerCase()).not.toContain("https://");
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });
});
