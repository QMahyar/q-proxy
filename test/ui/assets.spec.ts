import { describe, expect, it } from "vitest";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { readFileSync } from "node:fs";
import { ASSETS } from "../../src/ui/assets";
import { buildSubUrls } from "../../src/handlers/api/status";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { execFileSync } from "node:child_process";
// @ts-expect-error untyped build script export (plain .mjs)
import { minifyHtmlAsset } from "../../scripts/build-single-file.mjs";

const TOTAL_BUDGET_BYTES = 340 * 1024;
const PANEL_DELIVERY_BUDGET_BYTES = 280 * 1024;

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

describe("panel delivery minification", () => {
  const delivered = minifyHtmlAsset(ASSETS.panel) as string;

  it("is strictly smaller than the assembled source", () => {
    expect(Buffer.byteLength(delivered, "utf8")).toBeLessThan(Buffer.byteLength(ASSETS.panel, "utf8"));
  });

  it("keeps the delivered panel under the budget", () => {
    expect(Buffer.byteLength(delivered, "utf8")).toBeLessThan(PANEL_DELIVERY_BUDGET_BYTES);
  });

  it("is deterministic (same input = same output bytes)", () => {
    expect(minifyHtmlAsset(ASSETS.panel)).toBe(delivered);
  });

  it("preserves dict entries, structural ids and the security header surface in delivered bytes", () => {
    expect(delivered).toContain('"nav.subs":"Subs"');
    expect(delivered).toContain('"nav.subs":"اشتراک‌ها"');
    expect(delivered).toContain('id="view-subs"');
    expect(delivered).toContain('id="share-canvas"');
    expect(delivered).toContain("X-Q-Panel");
    expect(delivered).not.toContain("<!--panel:");
  });

  it("delivers script block bodies that stay safely embeddable", () => {
    const blocks: string[] = [];
    let from = 0;
    for (;;) {
      const open = delivered.indexOf("<script>", from);
      if (open < 0) break;
      const close = delivered.indexOf("</script>", open);
      blocks.push(delivered.slice(open + 8, close));
      from = close + 9;
    }
    expect(blocks.length).toBeGreaterThan(0);
    for (const body of blocks) expect(body.toLowerCase()).not.toContain("</scr" + "ipt>");
    expect((delivered.match(/<script>/g) ?? []).length).toBe((ASSETS.panel.match(/<script>/g) ?? []).length);
  });

  it("keeps the committed login and camo artifacts outside the minify step (not assembled by the build)", () => {
    expect(minifyHtmlAsset(ASSETS.login)).not.toBe(ASSETS.login);
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

  it("hash-routes the views with aria tab semantics", () => {
    expect(html).toContain('id="view-home"');
    expect(html).toContain('id="view-subs"');
    expect(html).toContain('id="view-settings"');
    expect(html).toContain('id="view-users"');
    expect(html).toContain('id="view-warp"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain("role='tabpanel'");
    expect(html).toContain("'sp-'+s.key");
    expect(html).toContain("#/settings/");
  });

  it("adds the Subscriptions hub as a top-level tab", () => {
    expect(html).toContain('id="tab-subs"');
    expect(html).toContain('href="#/subs"');
    expect(html).toContain("seg[0]==='subs')return{view:'subs'}");
    expect(html).toContain("'nav.subs':'Subs'");
    expect(html).toContain("'nav.subs':'اشتراک‌ها'");
    expect(html).toContain("'tabs.subs.title':'Subscriptions'");
    expect(html).toContain("'tabs.subs.title':'اشتراک‌ها'");
    expect(html).toContain("showSubsView()");
  });

  it("promotes users and warp to top-level tabs with back-compat redirects", () => {
    expect(html).toContain('id="tab-users"');
    expect(html).toContain('id="tab-warp"');
    expect(html).toContain('href="#/users"');
    expect(html).toContain('href="#/warp"');
    expect(html).toContain("'nav.users':'Users'");
    expect(html).toContain("'nav.users':'کاربران'");
    expect(html).toContain("seg[1]==='users')return{view:'users',redirect:true}");
    expect(html).toContain("seg[1]==='warp')return seg[2]?");
    expect(html).toContain("'#/users':'#/warp'");
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
    expect(html).toContain("share-canvas");
  });

  it("covers settings controls grouped into sections", () => {
    for (const section of ["general", "protocols", "addresses", "egress", "tunnel", "advanced"]) {
      expect(html).toContain(`'${section}'`);
      expect(html).toContain(`key:'${section}'`);
    }
    for (const removed of ["fragment'", "chain'", "sources'"]) {
      expect(html).not.toContain(`key:'${removed}`);
    }
    expect(html).toContain("SETTINGS_SEC_ALIAS={fragment:'tunnel',chain:'tunnel',sources:'egress'}");
    for (const bind of [
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
      "sourceUrls",
      "routingRules.bypassLan",
      "routingRules.customBlock",
    ]) {
      expect(html).toContain(`'${bind}'`);
    }
  });

  it("merges settings to six subtabs with a SECTIONS ↔ tabs.settings 1:1 drift guard", () => {
    const keys = [...html.matchAll(/key:'([a-z]+)',cards:\[/g)].map((m) => m[1]);
    expect(keys).toEqual(["general", "protocols", "addresses", "egress", "tunnel", "advanced"]);
    const dictKeys = [...new Set([...html.matchAll(/'tabs\.settings\.([a-z]+)':'/g)].map((m) => m[1]))].sort();
    expect(dictKeys).toEqual([...new Set(keys)].sort());
    for (const k of keys) {
      expect(html.match(new RegExp(`'tabs\\.settings\\.${k}':'`, "g"))?.length).toBe(2);
    }
  });

  it("absorbs the sources subtab into egress with an honest not-yet-consumed note", () => {
    expect(html).toContain("FL('sourceUrls','list','egress.remoteSubs.label'");
    expect(html.match(/'egress\.remoteSubs\.hint':'/g)?.length).toBe(2);
    expect(html.match(/'egress\.remoteSubs\.title':'/g)?.length).toBe(2);
  });

  it("renders routing rules as their own card inside the advanced subtab", () => {
    expect(html).toContain("{title:'routing.title',fields:[");
    expect(html).toContain("FL('routingRules.bypassLan','bool'");
  });

  it("collapses advanced TLS fields into a details element that still binds", () => {
    expect(html).toContain("{title:'protocols.advTls.title',advTls:true,fields:[");
    expect(html).toContain('<details class="adv-tls warp-acc"><summary>');
    expect(html).toContain("FL('echServerName'");
    expect(html).toContain("FL('alpn'");
  });

  it("removes the general kill-switch and language rows (home card and topbar own them)", () => {
    expect(html).not.toContain("FL('killSwitch'");
    expect(html).not.toContain("FL('language'");
    expect(html).not.toContain("case 'instantbool'");
    expect(html).not.toContain("case 'lang'");
    expect(html).toContain("'general.killSwitch.label':'Kill switch'");
    expect(html.match(/'general\.killSwitch\.label':'/g)?.length).toBe(2);
  });

  it("reads textarea list binds as split lines so list fields dirty and save", () => {
    expect(html).toMatch(/el\.tagName==='TEXTAREA'\)return el\.value\.split\('\\n'\)\.map\(s=>s\.trim\(\)\)\.filter\(Boolean\)/);
    expect(html).not.toContain("lines(el.value)");
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

  it("renders subscriptions from api/suburls with copy fields and the share sheet", () => {
    expect(html).toContain("copy-field");
    expect(html).toContain('id="m-share"');
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

  it("identifies the info-page entry by the view=html URL and labels it from the dict", () => {
    const produced = buildSubUrls("example.workers.dev", "p");
    const infoEntry = produced.find((e) => /[?&]view=html/.test(e.url));
    expect(infoEntry).toBeDefined();
    expect(html).toContain("function isInfoEntry(");
    expect(html).toContain("/[?&]view=html/");
    expect(html).toMatch(/home\.chips\.formats',\{n:\(S\.subs\|\|\[\]\)\.filter\(u=>!isInfoEntry\(u\)\)\.length\}\)/);
    expect(html).toContain("'subs.info.title':'Panel info page'");
    expect(html).toContain("'subs.info.title':'صفحهٔ اطلاعات پنل'");
  });

  it("renders a read-only panel address card and never a securePath editor", () => {
    expect(html).toContain("panelAddressCardHtml");
    expect(html).toContain("'address.panelTitle':'Panel address'");
    expect(html).toContain("'address.panelTitle':'نشانی پنل'");
    expect(html).toContain("'address.panelHint'");
    expect(html).not.toContain("FL('securePath'");
    expect(html).not.toContain("confirm.securepath_title");
    expect(html).not.toContain("confirm.securepath_body");
    expect(html).not.toContain("'general.securePath.label':");
    expect(html).not.toContain("'general.securePath.short':");
    expect(html).not.toContain("'general.securePath.help':");
    expect(html).not.toContain("SCALAR_RULES.securePath");
    expect(html).not.toContain("location.replace(nb+'/panel')");
  });

  it("refreshes subscriptions after a general or addresses save", () => {
    expect(html).toContain("async function refreshSubUrls()");
    expect(html).toMatch(/sec==='general'\|\|sec==='addresses'/);
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

  it("renders a token hint with rotate affordance instead of the dead URL branch", () => {
    expect(html).not.toContain("u.token?userSubUrl");
    expect(html).not.toContain("const url=u.token?");
    expect(html).toContain("esc(u.tokenHint||'')");
    expect(html).toContain("'users.token.hint_title'");
    expect(html).toContain("'users.token.hint_title':'فقط چند نویسهٔ نخست");
    expect(html).toContain("'users.token.regen':'Regenerate token'");
    expect(html).toContain("'users.col.token':'Subscription token'");
    expect(html).toContain("'users.col.token':'توکن اشتراک'");
  });

  it("labels the per-user quota as a subscription fetch limit with a UTC reset note", () => {
    expect(html).toContain("'users.limit':'Daily subscription fetch limit'");
    expect(html).toContain("'users.limit':'سقف روزانهٔ دریافت اشتراک'");
    expect(html.match(/'users\.limit_reset':/g)?.length).toBe(2);
    expect(html).toContain("resets at 00:00 UTC");
    expect(html).toContain("t('users.limit_reset')");
  });

  it("replaces the bare zero-user row with an empty card, capacity note and CTA", () => {
    expect(html).toContain("'users.empty_msg'");
    expect(html).toContain("Up to 50 users.");
    expect(html).toContain("'users.empty_cta':'Create first user'");
    expect(html).toContain("'users.empty_cta':'ساخت نخستین کاربر'");
    expect(html).toContain("تا ۵۰ کاربر");
    expect(html).toContain('id="users-thead"');
    expect(html).toContain("if(th)th.hidden=empty");
    expect(html).toContain("function usersEmptyHtml()");
  });

  it("replaces the QR and rotation modals with one ShareSheet component", () => {
    expect(html).toContain('id="m-share"');
    expect(html).toContain('id="share-url"');
    expect(html).toContain('id="share-copy"');
    expect(html).toContain('id="share-canvas"');
    expect(html).toContain('id="share-download"');
    expect(html).toContain('id="share-warning"');
    expect(html).toContain('id="share-native"');
    expect(html).toContain("function openShareSheet(");
    expect(html).not.toContain('id="m-qr"');
    expect(html).not.toContain('id="m-rot"');
    expect(html).not.toContain("showRotation");
    expect(html).not.toContain("copyText(url)");
    expect(html).toContain("note:'once'");
    expect(html.match(/'share\.copy':'/g)?.length).toBe(2);
    expect(html.match(/'share\.warning':'/g)?.length).toBe(2);
    expect(html.match(/'share\.title_user_created':'/g)?.length).toBe(2);
    expect(html.match(/'share\.title_rotated':'/g)?.length).toBe(2);
  });

  it("keeps accent swatches visible on mobile and offers QR PNG download", () => {
    expect(html).not.toContain(".swatches{display:none}");
    expect(html).toContain(".swatches{display:flex;flex-wrap:wrap");
    expect(html).toContain('id="share-png"');
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

  it("bounces authed visitors via the api/auth/status probe before rendering either card", () => {
    expect(html).toContain("fetch(BASE+'api/auth/status'");
    expect(html).toMatch(/if\(d\.ok&&j&&j\.ok&&j\.data&&j\.data\.hasSession\)\{\s*goPanel\(\);\s*return\s*\}/);
    expect(html).toMatch(/catch\(e\)\{\}\s*renderLogin\(\)\}\)\(\)/);
    expect(html).not.toContain("fetch(BASE+'api/settings'");
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

describe("panel ui p16 states", () => {
  const html = ASSETS.panel;

  it("ships the shared states.js builders in the bundle", () => {
    expect(html).toContain("function emptyCard(");
    expect(html).toContain("function loadingBox(");
    expect(html).toContain("function errorCard(");
    expect(html).toContain("loading-box\"");
    expect(html).toContain("empty-card--error");
    expect(html).toContain("skel-bar");
  });

  it("adopts the empty-card builder on users, subs, warp and home", () => {
    expect(html).toContain("function usersEmptyHtml(){");
    expect(html).toMatch(/function usersEmptyHtml\(\)\{\s*return emptyCard\(/);
    expect(html).toContain("function subsEmptyHtml(){return emptyCard(");
    expect(html).toContain("ac.insertAdjacentHTML('beforeend',emptyCard(");
    expect(html.match(/sh\+=emptyCard\(/g)?.length).toBe(1);
    expect(html).not.toContain("'<div class=\"empty-card\"><div class=\"empty-icon\"><svg aria-hidden=\"true\"><use href=\"#i-qr\"/>");
  });

  it("pairs every errorCard usage with a retry action", () => {
    const uses = [...html.matchAll(/errorCard\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThanOrEqual(6);
    for (const u of uses) expect(u).toContain("retryAction:");
    for (const attr of [
      'data-action="users-reload"',
      'data-action="pool-fetch"',
      'data-retry="subs-users"',
      'data-retry="home-pool"',
      'data-retry="home-users"',
      'data-retry="my-ip"',
    ]) {
      expect(html).toContain(attr);
    }
  });

  it("routes every loading surface through loadingBox and keeps the warp retry handler", () => {
    expect(html.match(/loadingBox\(/g)?.length).toBeGreaterThanOrEqual(8);
    expect(html).not.toContain("+'<span class=\"spin\" style=\"display:inline-block;vertical-align:middle\"></span>'");
    expect(html).toContain("if(!S.warp&&!warpLoadError){const panel=$('warp-body')");
    expect(html).toContain("data-warp-retry");
    expect(html).toContain("'[data-retry]'");
  });

  it("adds skeleton, loading-box and error-state styles with reduced-motion shimmer off", () => {
    expect(html).toContain(".loading-box{");
    expect(html).toContain(".skel-bar{");
    expect(html).toContain(".empty-card--error{");
    expect(html).toContain(".empty-icon--error{");
    expect(html).toContain("@keyframes shimmer");
    expect(html).toMatch(/@media\(prefers-reduced-motion:reduce\)\{\*[^@]*\.skeleton\{animation:none\}\s*\}/);
  });
});

describe("panel build assembly", () => {
  const assemble = () =>
    execFileSync(process.execPath, ["scripts/build-single-file.mjs", "--assemble-only"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });

  const distContent = (): string => {
    execFileSync(process.execPath, ["scripts/build-single-file.mjs"], {
      cwd: process.cwd(),
      stdio: "pipe",
      maxBuffer: 1024 * 1024,
    });
    return readFileSync("dist/q-proxy.js", "utf8");
  };

  it("leaves no inject markers in the shipped panel", () => {
    expect(ASSETS.panel).not.toContain("<!--panel:");
  });

  it("assembles deterministically from src/ui/panel sources", () => {
    expect(assemble()).toBe(assemble());
  });

  it("keeps the committed panel.html in sync with its sources", () => {
    expect(assemble()).toBe(ASSETS.panel);
  });

  it("produces byte-identical dist across full builds (bundle incl. minified panel embed)", () => {
    expect(distContent()).toBe(distContent());
  }, 60_000);

  it("guards the copy action against synchronous clipboard throws", () => {
    expect(ASSETS.panel).toContain("try{p=copyText(");
    expect(ASSETS.panel).toMatch(/catch\(err\)\{p=Promise\.resolve\(false\)\}/);
  });
});

describe("panel ui p15 a11y", () => {
  const html = ASSETS.panel;

  it("ships the a11y module with radiogroup controller, announce and nextId", () => {
    expect(html).toContain("function wireRadiogroups(");
    expect(html).toContain("function radiogroupKeydown(");
    expect(html).toContain("function syncRadiogroup(");
    expect(html).toContain("function nextId(");
    expect(html).toContain("function announce(");
    expect(html).toContain("document.documentElement.dir==='rtl'");
    expect(html).toContain("MutationObserver");
  });

  it("renders one global polite live region for dynamic announcements", () => {
    expect(html).toContain('id="a11y-live"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toMatch(/id="a11y-live" class="visually-hidden"/);
    expect(html).toContain("announce(err.textContent)");
  });

  it("wires swatches and language segment as keyboard-operable radiogroups", () => {
    expect(html).toContain('data-radiogroup="pressed"');
    const groups = html.match(/role="radiogroup"/g) ?? [];
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('class="seg" role="radiogroup" aria-label="Language" id="langseg"');
    expect(html).toMatch(/\[role="radio"\],\[aria-checked\]/);
  });

  it("associates every address-card and remote-node field label with a generated id", () => {
    expect(html).toMatch(/const fid=nextId\('addr'\+i\+'-'\+k\)/);
    expect(html).toMatch(/const fid=nextId\('rmt'\+i\+'-'\+k\)/);
    expect(html).not.toMatch(/<label>'+esc\(t\('remote\.nodes\.(kind|flow|fp|password|obfs|obfsPassword)'\)\)+'<\/label><(?:select|input)(?![^>]*id=)/);
    expect(html).toMatch(/data-addr-enabled-input aria-label="/);
  });

  it("keeps the ECH preview direction auto so Persian renders correctly", () => {
    expect(html).toContain('data-ech-preview dir="auto"');
    expect(html).not.toContain('data-ech-preview dir="ltr"');
  });

  it("gives modal validation errors role=alert and labels the override inputs", () => {
    expect(html).toContain('id="wi-error" role="alert"');
    expect(html).toContain('id="wp-error" role="alert"');
    expect(html).toContain('id="mu-error" role="alert"');
    expect(html).toMatch(/<label for="mu-ov-address" id="mu-ov-address-label">/);
    expect(html).toMatch(/<label for="mu-ov-port" id="mu-ov-port-label">/);
    expect(html).toMatch(/<label for="mu-ov-label2" id="mu-ov-label-label">/);
  });

  it("registers a11y.js in the panel assembly order", () => {
    const buildScript = readFileSync("scripts/build-single-file.mjs", "utf8");
    expect(buildScript).toContain('"a11y.js"');
    const order = buildScript.match(/PANEL_JS_ORDER = \[([^\]]+)\]/)?.[1] ?? "";
    expect(order.indexOf('"a11y.js"')).toBeGreaterThan(-1);
    expect(order.indexOf('"a11y.js"')).toBeLessThan(order.indexOf('"settings.js"'));
    expect(ASSETS.panel).toContain("function announce(");
  });
});
