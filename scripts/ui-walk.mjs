import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require2 = createRequire('C:/Users/qmahyar/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.js');
const { chromium } = require2('playwright');

// ================= config =================
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8799';
const SP_FILE = join(ROOT, '.pi/ui-audit/local-sp.txt');
const PW_FILE = join(ROOT, '.pi/ui-audit/local-pw.txt');
const SP = existsSync(SP_FILE) ? readFileSync(SP_FILE, 'utf8').trim() : '';
const PW = existsSync(PW_FILE) ? readFileSync(PW_FILE, 'utf8').trim() : 'LocalTest99';
const NOW = new Date().toISOString().replace(/[:.]/g, '-');
const SHOTS = join(ROOT, '.pi/ui-audit/shots/walk', NOW);
const REPORT = join(ROOT, '.pi/ui-audit/ui-walk-report.json');
mkdirSync(SHOTS, { recursive: true });

const T = { nav: 15000, settle: 250, navTo: 550, api: 3000 };
const results = [];
const consoleErrors = [];
let failedShots = 0;

function ok(name, detail) {
  results.push({ name, pass: true, detail: detail || '' });
  console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : ''));
}
function fail(name, error, detail) {
  results.push({ name, pass: false, error: String(error || '').slice(0, 300), detail: detail || '' });
  console.log('FAIL  ' + name + '  [' + String(error || '').slice(0, 200) + ']');
}
async function shot(page, name) {
  try { await page.screenshot({ path: join(SHOTS, name + '.png') }); failedShots++; }
  catch (e) { console.log('  (screenshot failed: ' + name + ')'); }
}
async function shotOnFail(page, name) {
  try { await page.screenshot({ path: join(SHOTS, name + '.png') }); } catch (e) { /* ignore */ }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gotoPanel(page, hash) {
  if (hash !== undefined) await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForFunction(() => {
    const views = [...document.querySelectorAll('#view-home,#view-subs,#view-warp,#view-settings')];
    return views.some(v => !v.hidden);
  }, null, { timeout: T.nav });
  await page.waitForTimeout(T.settle);
}
async function gotoSub(page, sec) {
  await page.evaluate(h => { location.hash = h; }, '#/settings/' + sec);
  await page.waitForSelector('#sp-' + sec + ':not([hidden])', { timeout: T.nav });
  await page.waitForTimeout(T.settle);
}
async function waitForPanel(page) {
  await page.waitForFunction(() => {
    const views = [...document.querySelectorAll('#view-home,#view-subs,#view-warp,#view-settings')];
    return views.some(v => !v.hidden);
  }, null, { timeout: T.nav });
  await page.waitForTimeout(400);
}
async function dismissWizard(page) {
  const wiz = await page.$('#m-wizard:not([hidden])');
  if (wiz) { await page.click('#wiz-skip'); await page.waitForTimeout(250); }
}
async function discardViaUi(page) {
  const bar = page.locator('#applybar');
  if (!(await bar.isVisible().catch(() => false))) return false;
  await page.click('#discard-btn');
  await page.waitForSelector('#m-confirm:not([hidden])', { timeout: 5000 });
  await page.click('#cf-ok');
  await page.waitForTimeout(250);
  return true;
}
const KEY_PAT = /^[a-z]+\.[a-z][a-zA-Z.]*$/;

async function navAfterSave(page) {
  // clear the panel's 30s sessionStorage bootstrap cache so the fresh navigation
  // re-fetches settings; otherwise saved values are invisible for up to 30s
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem('qpc:api/bootstrap');
      sessionStorage.removeItem('qpe:api/bootstrap');
    } catch (e) {}
  });
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(BASE + '/' + SP + '/panel', { waitUntil: 'load', timeout: 25000 });
      await waitForPanel(page);
      await dismissWizard(page);
      return;
    } catch (e) {
      await sleep(1200); // miniflare write lane can briefly abort navigation right after a save
    }
  }
  throw new Error('could not re-navigate to panel after save (3 attempts)');
}

// ================= the walk =================
async function step1_login(page) {
  await page.goto(BASE + '/' + SP + '/login', { waitUntil: 'networkidle' });
  // bad password first
  await page.fill('#pw', 'definitely-wrong-' + Date.now());
  await page.click('#go');
  await page.waitForSelector('#e-pw:not(:empty)', { timeout: T.nav });
  const err = await page.textContent('#e-pw');
  assert(err && err.trim().length > 2, 'bad-password error message not shown');
  // good password
  await page.fill('#pw', PW);
  await page.click('#go');
  await page.waitForURL('**/panel', { timeout: T.nav });
  await waitForPanel(page);
  await dismissWizard(page);
  ok('login', 'bad pw rejected with error; good pw lands on panel');
}

async function step2_tabs(page) {
  const tabs = await page.$$eval('#nav .tab', els => els.map(e => ({ id: e.id, label: (e.textContent || '').trim() })));
  assert(tabs.length === 4, 'expected 4 tabs, got ' + tabs.length);
  assert(tabs.every(t => t.label.length > 0), 'a tab label is empty');
  assert(tabs.every(t => !KEY_PAT.test(t.label)), 'raw dict key leaked into tab label: ' + JSON.stringify(tabs));
  ok('tabs', '4 tabs, labeled: ' + tabs.map(t => t.label).join(' / '));
}

async function step3_home(page) {
  await gotoPanel(page, '#/home');
  // status card renders version
  const ver = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#home-body .card')];
    for (const c of cards) {
      if (c.textContent.includes(document.querySelector && 'v')) { /* noop */ }
    }
    const mono = [...document.querySelectorAll('#home-body .mono')].map(m => m.textContent.trim());
    return mono.find(t => /^v\d/.test(t)) || null;
  });
  assert(ver && /^v\d+\.\d+/.test(ver), 'home status card missing version (got ' + JSON.stringify(ver) + ')');
  // kill-switch flip: UI + data-kill sync
  const ks = page.locator('#home-body [data-kill]').first();
  const before = await ks.isChecked();
  const chipBefore = await page.textContent('#kill-chip');
  await ks.click({ force: true });
  // kill switch ON shows a confirm dialog (T4) — confirm it; OFF flips without dialog
  const confirmShown = await page.waitForSelector('#m-confirm:not([hidden])', { timeout: 2500 }).then(() => true).catch(() => false);
  if (confirmShown) await page.click('#cf-ok');
  await page.waitForTimeout(1500); // 300ms debounce + POST + re-render
  const after = await ks.isChecked();
  const chipAfter = await page.textContent('#kill-chip');
  assert(after === !before, 'kill switch checkbox did not flip');
  assert(chipAfter !== chipBefore, 'kill chip text did not change (' + chipBefore + ' -> ' + chipAfter + ')');
  ok('home-killswitch', 'flipped ' + before + ' -> ' + after + ' via confirm dialog (chip "' + chipBefore + '" -> "' + chipAfter + '")');
  // flip back (dialog only appears when pausing traffic)
  await ks.click({ force: true });
  const confirmShown2 = await page.waitForSelector('#m-confirm:not([hidden])', { timeout: 2500 }).then(() => true).catch(() => false);
  if (confirmShown2) await page.click('#cf-ok');
  await page.waitForTimeout(1500);
  const restored = await page.locator('#home-body [data-kill]').first().isChecked();
  assert(restored === before, 'kill switch did not restore (checked=' + restored + ', expected ' + before + ')');
  ok('home-killswitch-restore', 'back to ' + restored);
  // my-ip card gone: ip-body absent, no refresh-ip action, no my-ip link
  const myIpGone = await page.evaluate(() => ({
    ipBody: !!document.getElementById('ip-body'),
    refreshIp: !!document.querySelector('#home-body [data-action="refresh-ip"]'),
    myIpLink: document.body.innerHTML.includes('my-ip'),
  }));
  assert(!myIpGone.ipBody && !myIpGone.refreshIp && !myIpGone.myIpLink, 'my-ip surface survived: ' + JSON.stringify(myIpGone));
  ok('home-no-myip', 'ip-body/refresh-ip/my-ip link absent');
  // version-check button gone, version text survives
  const noVerCheck = await page.evaluate(() => !!document.querySelector('#home-body [data-action="check-update"]'));
  assert(!noVerCheck, 'version-check button survived');
  ok('home-no-versioncheck', 'check-update absent, version text kept');
  // relay pool refresh still works (surviving home card)
  await page.evaluate(() => { const b = document.querySelector('#home-body [data-action="home-pool-refresh"]'); if (b) b.click(); });
  await page.waitForFunction(() => ((document.getElementById('home-pool') || {}).textContent || '').length > 0, null, { timeout: 12000 }).catch(() => {});
  const poolBody = await page.evaluate(() => (document.getElementById('home-pool') || {}).textContent || '');
  assert(poolBody.length > 0, 'home-pool still empty 12s after refresh');
  ok('home-pool-refresh', 'refresh ran, home-pool non-empty (' + poolBody.replace(/\s+/g, ' ').slice(0, 48) + '…)');
  // pool settles into rows, an error card with retry, or an empty card with retry — never a blank
  const poolState = await page.evaluate(() => {
    const b = document.getElementById('home-pool');
    if (!b) return 'missing';
    if (b.querySelector('.pool-row')) return 'rows';
    if (b.querySelector('.empty-card--error')) return b.querySelector('[data-retry="home-pool"]') ? 'error-retry' : 'error-noretry';
    if (b.querySelector('.empty-card')) return b.querySelector('[data-retry="home-pool"]') ? 'empty-retry' : 'empty-noretry';
    return 'other';
  });
  assert(poolState === 'rows' || poolState === 'error-retry' || poolState === 'empty-retry', 'home-pool has no rows and no retryable state (got ' + poolState + ')');
  ok('home-pool-state', 'settled into ' + poolState);
}

async function step4_subs(page, context) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await gotoPanel(page, '#/subs');
  const mainRows = await page.$$eval('#subs-body [id^="hub-u"]', els => els.length);
  assert(mainRows === 4, 'expected 4 main format rows (base64+singbox+clash+xray), got ' + mainRows);
  const clashRow = await page.evaluate(() => [...document.querySelectorAll('#subs-body .row .field__label')].map(e => e.textContent).find(t => /clash/i.test(t || '')));
  assert(clashRow, 'no Clash row in the subs hub');
  const xrayRow = await page.evaluate(() => [...document.querySelectorAll('#subs-body .row .field__label')].map(e => e.textContent).find(t => /xray/i.test(t || '')));
  assert(xrayRow, 'no Xray row in the subs hub');
  // expander opens with ?target= variant
  const det = page.locator('#subs-body details.subs-acc').first();
  await det.locator('summary').click();
  await page.waitForTimeout(200);
  const variant = await page.evaluate(() => {
    const v = document.querySelector('#subs-body [id^="hub-v"]');
    return v ? v.textContent : null;
  });
  assert(variant && variant.includes('target='), 'variant URL missing ?target= (got ' + JSON.stringify(variant) + ')');
  // mode chip rewrites URL with mode=fragment
  const urlBefore = await page.evaluate(() => document.querySelector('#subs-body [id^="hub-u"]').textContent);
  await page.click('#subs-body .seg [data-mode="fragment"]');
  await page.waitForTimeout(250);
  const urlAfter = await page.evaluate(() => document.querySelector('#subs-body [id^="hub-u"]').textContent);
  assert(urlAfter.includes('mode=fragment'), 'mode=fragment not appended (got ' + urlAfter.slice(-60) + ')');
  await page.click('#subs-body .seg [data-mode="normal"]');
  await page.waitForTimeout(250);
  const urlBack = await page.evaluate(() => document.querySelector('#subs-body [id^="hub-u"]').textContent);
  assert(!urlBack.includes('mode=fragment'), 'mode=fragment not removed after switching back');
  // copy byte-check
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  await page.click('#subs-body .copy-field [data-action="copy"]');
  await page.waitForTimeout(500);
  const clipAfter = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clipAfter === urlBack && clipAfter.length > 10, 'clipboard mismatch: ' + JSON.stringify((clipAfter || '').slice(0, 40)));
  // per-user section gone (single-admin slim-down)
  const noSubsUsers = await page.evaluate(() => !document.getElementById('subs-users'));
  assert(noSubsUsers, 'per-user subs section survived');
  // my-ip utility row gone, DoH row survives
  const utilsGone = await page.evaluate(() => ({
    myip: !!document.getElementById('hub-myip'),
    doh: !!document.getElementById('hub-doh'),
  }));
  assert(!utilsGone.myip && utilsGone.doh, 'subs utils my-ip/DoH wrong: ' + JSON.stringify(utilsGone));
  // WARP link-out works
  await page.click('#subs-body a[href="#/warp"]');
  await page.waitForTimeout(T.navTo + T.settle);
  const warpVisible = await page.evaluate(() => !document.getElementById('view-warp').hidden);
  assert(warpVisible, 'WARP link-out did not open #/warp');
  // info-page footer has copy button but NO QR button
  await gotoPanel(page, '#/subs');
  const infoQr = await page.evaluate(() => {
    const info = document.getElementById('hub-info');
    if (!info) return null;
    const row = info.closest('.copy-field') || info.closest('.row');
    return row ? row.querySelectorAll('[data-action="qr"]').length : -1;
  });
  assert(infoQr === 0, 'info footer row has QR button(s): ' + infoQr);
  // fastest-node guidance names the auto-selecting profiles
  const pingBody = await page.evaluate(() => (document.getElementById('subs-ping') || {}).textContent || '');
  assert(pingBody.includes('PROXY') && pingBody.length > 40, 'subs-ping guidance missing (got ' + JSON.stringify(pingBody.slice(0, 40)) + ')');
  ok('subs-ping', 'guidance block names the PROXY auto-select profiles');
  // foreign import: paste two sources -> per-source preview tags, nothing stored
  const importText = 'vless://d342d11e-d424-4583-b36e-524ab1f0afa4@203.0.113.60:443?security=tls&type=ws#w1\n\nvless://d342d11e-d424-4583-b36e-524ab1f0afa4@203.0.113.61:8443?security=tls&type=ws#w2';
  await page.fill('#sub-import-text', importText);
  const ceBefore = await page.evaluate(async (sp) => {
    const r = await fetch(location.origin + '/' + sp + '/api/settings', { headers: { 'X-Q-Panel': '1' } });
    return (await r.json()).data.customEndpoints;
  }, SP);
  await page.click('[data-action="subs-import-preview"]');
  await page.waitForFunction(() => {
    const b = document.getElementById('sub-import-preview');
    return b && (b.querySelectorAll('.warp-group').length >= 2 || b.querySelector('.empty-card--error'));
  }, null, { timeout: 15000 });
  const importTags = await page.evaluate(() => [...document.querySelectorAll('#sub-import-preview .warp-group')].map(g => g.textContent.slice(0, 60)));
  assert(importTags.length === 2, 'expected 2 import source groups, got ' + importTags.length);
  assert(importTags[0].includes('203.0.113.60:443') && importTags[1].includes('203.0.113.61:8443'), 'preview endpoints wrong: ' + JSON.stringify(importTags));
  const ceAfterPreview = await page.evaluate(async (sp) => {
    const r = await fetch(location.origin + '/' + sp + '/api/settings', { headers: { 'X-Q-Panel': '1' } });
    return (await r.json()).data.customEndpoints;
  }, SP);
  assert(JSON.stringify(ceAfterPreview) === JSON.stringify(ceBefore), 'preview stored endpoints');
  // confirm -> saved, served in subs, then reverted (state-safe)
  await page.click('[data-action="subs-import-confirm"]');
  await page.waitForFunction(async (sp) => {
    const r = await fetch(location.origin + '/' + sp + '/api/settings', { headers: { 'X-Q-Panel': '1' } });
    const ce = (await r.json()).data.customEndpoints || [];
    return ce.some(e => String(e).includes('203.0.113.60'));
  }, SP, { timeout: 15000 });
  const subHasImport = await page.evaluate(async (sp) => {
    const r = await fetch(location.origin + '/' + sp + '/sub?target=base64');
    const b64 = await r.text();
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }, SP).catch(() => null);
  assert(subHasImport && subHasImport.includes('203.0.113.60:443'), 'merged sub missing imported endpoint');
  const revNow = await page.evaluate(async (sp) => {
    const r = await fetch(location.origin + '/' + sp + '/api/settings', { headers: { 'X-Q-Panel': '1' } });
    return (await r.json()).data.rev;
  }, SP);
  await page.evaluate(async (sp, args) => {
    await fetch(location.origin + '/' + sp + '/api/settings/save', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Q-Panel': '1' }, body: JSON.stringify({ customEndpoints: args.before, baseRev: args.rev }) });
  }, SP, { before: ceBefore, rev: revNow });
  ok('subs-import', '2-source preview with per-source tags, nothing stored until confirm, merged endpoint served, reverted');
  ok('subs-hub', mainRows + ' formats (base64+singbox+clash+xray), ?target= variant, mode=fragment toggle, clipboard byte-match, no per-user section, warp link-out, info footer QR-free');
}

async function step5_users(page) {
  // Deleted users view redirects home (single-admin slim-down); no users tab, view, or modal survives.
  await page.evaluate(h => { location.hash = h; }, '#/users');
  await page.waitForTimeout(T.navTo + T.settle);
  const redir = await page.evaluate(() => ({
    hash: location.hash,
    homeVisible: !document.getElementById('view-home').hidden,
    noUsersView: !document.getElementById('view-users'),
    noUsersTab: !document.getElementById('tab-users'),
    noUserModal: !document.getElementById('m-user'),
  }));
  assert(redir.hash === '#/home' && redir.homeVisible, 'deleted #/users did not land on home: ' + JSON.stringify(redir));
  assert(redir.noUsersView && redir.noUsersTab && redir.noUserModal, 'users surface survived: ' + JSON.stringify(redir));
  await page.evaluate(h => { location.hash = h; }, '#/settings/users');
  await page.waitForTimeout(T.navTo + T.settle);
  const redir2 = await page.evaluate(() => ({ hash: location.hash, homeVisible: !document.getElementById('view-home').hidden }));
  assert(redir2.hash === '#/home' && redir2.homeVisible, 'deleted #/settings/users did not land on home: ' + JSON.stringify(redir2));
  ok('users-removed', '#/users -> #/home, #/settings/users -> #/home, no tab/view/modal');
}

async function step6_warp(page) {
  await gotoPanel(page, '#/warp');
  await page.waitForFunction(() => !!document.querySelector('#warp-body a.acct-card'), null, { timeout: T.nav });
  await page.click('#warp-body a.acct-card');
  await page.waitForSelector('#warp-detail-subs .fmt-row', { timeout: T.nav });
  // Subscription URLs card FIRST
  const firstCard = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#warp-body > section.card, #warp-body section.card')];
    for (const c of cards) {
      if (c.querySelector('#warp-detail-subs')) return true;
    }
    return false;
  });
  const firstCardIdx = await page.evaluate(() => {
    const body = document.getElementById('warp-body');
    const cards = [...body.querySelectorAll(':scope > section.card')];
    const sub = cards.findIndex(c => c.querySelector('#warp-detail-subs'));
    const acct = cards.findIndex(c => !!c.querySelector('#warp-name'));
    return { sub, acct };
  });
  assert(firstCard && (firstCardIdx.sub === 0), 'Subscription URLs card is not first in detail (sub=' + firstCardIdx.sub + ', acct=' + firstCardIdx.acct + ')');
  // 4 family groups render, one download row each
  const groups = await page.$$eval('#warp-detail-subs .warp-group', els => els.map(e => e.dataset.warpGroup));
  assert(groups.length === 4, 'expected 4 WARP family groups, got ' + groups.length + ': ' + JSON.stringify(groups));
  for (const fam of ['wireguard', 'throne', 'singbox', 'v2rayn']) assert(groups.includes(fam), 'missing WARP family group: ' + fam);
  const fmtRows = await page.$$eval('#warp-detail-subs .fmt-row', els => els.length);
  assert(fmtRows === 4, 'expected 4 WARP download rows, got ' + fmtRows);
  // global Amnezia toggle moves values, nothing else (toggle lives on the WARP section).
  // Saves are async fire-and-forget server-side (PUT 200 races the edge purge),
  // so every step below POLLS to a stable state instead of sleeping fixed timeouts.
  const singboxUrl = await page.evaluate(() => [...document.querySelectorAll('#warp-detail-subs .copy-field code')].map(c => c.textContent).find(u => u.endsWith('/singbox')));
  assert(singboxUrl, 'no singbox sub URL on detail');
  await gotoPanel(page, '#/warp');
  // Custom endpoints carry a live count chip next to the label
  const customCount = await page.evaluate(() => {
    const ta = document.getElementById('warp-eps-custom');
    const chip = ta && ta.closest('.field') ? ta.closest('.field').querySelector('.stat-chip') : null;
    return chip ? chip.textContent : null;
  });
  assert(customCount && /\d+/.test(customCount), 'custom endpoints count chip missing (got ' + JSON.stringify(customCount) + ')');
  ok('warp-custom-count', 'custom label shows count (' + customCount.trim() + ')');
  await page.waitForSelector('#warp-amnezia-toggle', { timeout: T.nav });
  const savedToggle = async (want) => {
    await page.waitForFunction(async (w) => {
      try {
        const r = await fetch('api/warp/settings/amnezia', { headers: { 'X-Q-Panel': '1' } });
        const j = await r.json();
        return !!((j && j.data && j.data.amneziaEnabled)) === w;
      } catch { return false; }
    }, want, { timeout: 20000, polling: 1000 });
  };
  const setToggle = async (on) => {
    // flip via DOM click (Playwright check/uncheck hangs on this live-rebound input)
    await page.evaluate((want) => {
      const tg = document.getElementById('warp-amnezia-toggle');
      if (!!tg.checked !== want) tg.click();
    }, on);
    await page.click('[data-action="warp-amnezia-save"]');
    await savedToggle(on);
  };
  const expectSingbox = async (tag, wantAmz) => {
    await page.waitForFunction(async ([u, t, want]) => {
      // cache-bust: each poll must miss the browser HTTP cache (60s public);
      // the edge key strips search, so the server still sees the same URL
      const r = await fetch(u + (u.includes('?') ? '&' : '?') + 'probe=' + t + '-' + Date.now());
      const txt = await r.text();
      return want ? txt.includes('"amnezia_wg"') : !txt.includes('amnezia_wg');
    }, [singboxUrl, tag, wantAmz], { timeout: 25000, polling: 1500 });
  };
  await setToggle(false);
  await expectSingbox('off', false);
  await setToggle(true);
  await expectSingbox('on', true);
  await setToggle(false);
  await expectSingbox('restored', false);
  // back to detail for the rotate flow below (state-safe: toggle restored off)
  await gotoPanel(page, '#/warp');
  await page.click('#warp-body a.acct-card');
  await page.waitForSelector('#warp-detail-subs .fmt-row', { timeout: T.nav });
  // rotate token: URL changes after confirm (documented behavior: WARP regen shows
  // toast + re-render rather than ShareSheet — regen response carries only the token;
  // per-format URL construction lives in warp.js, logged as Task-11 follow-up)
  const fmtUrlBefore = await page.evaluate(() => document.querySelector('#warp-detail-subs .copy-field code').textContent);
  await page.click('#warp-token-details summary');
  await page.waitForTimeout(200);
  await page.click('[data-action="warp-regen"]');
  await page.waitForSelector('#m-confirm:not([hidden])', { timeout: 5000 });
  await page.click('#cf-ok');
  await page.waitForFunction(prev => {
    const c = document.querySelector('#warp-detail-subs .copy-field code');
    return c && c.textContent !== prev;
  }, fmtUrlBefore, { timeout: 10000 });
  const fmtUrlAfter = await page.evaluate(() => document.querySelector('#warp-detail-subs .copy-field code').textContent);
  assert(fmtUrlAfter.includes('/sub/wg/'), 'rotated WARP URL not a wg sub: ' + fmtUrlAfter.slice(-40));
  // Escape closes any open modal and focus lands somewhere
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const shareClosed = await page.evaluate(() => document.getElementById('m-share').hidden);
  assert(shareClosed, 'Escape: ShareSheet ended up open');
  const focusOk = await page.evaluate(() => document.activeElement !== null);
  assert(focusOk, 'no activeElement after Escape');
  // global endpoints card: tick default preset + custom line -> save -> detail subs carry it
  await gotoPanel(page, '#/warp');
  await page.waitForSelector('#warp-endpoints input[data-warp-preset="default"]', { timeout: T.nav });
  await page.locator('#warp-endpoints input[data-warp-preset="default"]').click({ force: true });
  await page.fill('#warp-eps-custom', '162.159.192.1:2408');
  await page.waitForTimeout(300);
  await page.click('[data-action="warp-endpoints-save"]');
  await page.waitForTimeout(1500);
  await page.click('#warp-body a.acct-card');
  await page.waitForSelector('#warp-detail-subs .fmt-row', { timeout: T.nav });
  // copy-fields hold sub URLs, not endpoints: fetch the throne text sub and check content
  const hasEndpoint = await page.evaluate(async () => {
    const urls = [...document.querySelectorAll('#warp-detail-subs .copy-field code')].map(c => c.textContent);
    const throne = urls.find(u => u.endsWith('/throne'));
    if (!throne) return false;
    const r = await fetch(throne);
    return (await r.text()).includes('162.159.192.1:2408');
  });
  assert(hasEndpoint, 'detail subs missing global custom endpoint');
  // clear back to preset-only (state-safe for reruns)
  await gotoPanel(page, '#/warp');
  await page.waitForSelector('#warp-eps-custom', { timeout: T.nav });
  await page.fill('#warp-eps-custom', '');
  await page.waitForTimeout(300);
  await page.click('[data-action="warp-endpoints-save"]');
  await page.waitForTimeout(1500);
  ok('warp-detail', 'URLs card first, 4 groups, global Amnezia toggle moves values, global endpoints reach detail subs, rotate changes URL, Escape clean');
}

async function step7_settings(page) {
  const saves = [];
  const counter = r => { if (/\/api\/settings\/save/.test(r.url()) && r.method() === 'PUT') saves.push(r.url()); };
  page.on('request', counter);
  try {
    saves.length = 0;
    // profileTitle (save via the section's own Save button)
    await gotoSub(page, 'general');
    const inp = page.locator('#sp-general input[data-bind="profileTitle"]');
    const orig = await inp.inputValue();
    await inp.fill(orig + 'W');
    await page.waitForTimeout(500); // dirty-mark debounce
    await page.click('#sp-general [data-action="section-save"]');
    await page.waitForFunction(n => n === 1, saves.length, { timeout: 8000 });
    await navAfterSave(page);
    await gotoSub(page, 'general');
    let persisted = await page.locator('#sp-general input[data-bind="profileTitle"]').inputValue();
    for (let i = 0; i < 2 && persisted !== orig + 'W'; i++) {
      await page.waitForTimeout(800);
      persisted = await page.evaluate(() => { const el = document.querySelector('#sp-general input[data-bind="profileTitle"]'); return el ? el.value : null; });
    }
    assert(persisted === orig + 'W', 'profileTitle not persisted after reload (got ' + persisted + ')');
    // revert
    await page.locator('#sp-general input[data-bind="profileTitle"]').fill(orig);
    await page.waitForTimeout(500);
    await page.click('#sp-general [data-action="section-save"]');
    await page.waitForFunction(n => n === 2, saves.length, { timeout: 8000 });
    // fragment preset off -> low (persisted) -> off (reverted); state-safe: an interrupted
    // earlier attempt can leave 'low' saved, so always start by force-saving 'off'
    await gotoSub(page, 'tunnel');
    await page.click('#sp-tunnel .chip[data-preset="off"]');
    await page.waitForTimeout(350);
    await page.click('#sp-tunnel [data-action="section-save"]');
    await page.waitForTimeout(900); // settle regardless of whether a PUT was needed
    await gotoSub(page, 'tunnel');
    await page.click('#sp-tunnel .chip[data-preset="low"]');
    await page.waitForTimeout(350);
    const rangeDisabled = await page.evaluate(() => {
      const el = document.querySelector('#sp-tunnel [data-bind="fragment.lengthMin"]');
      return el ? el.disabled : null;
    });
    assert(rangeDisabled === true, 'fragment preset low did not lock range inputs');
    const savesBeforeLow = saves.length;
    await page.click('#sp-tunnel [data-action="section-save"]');
    await page.waitForTimeout(1200);
    assert(saves.length === savesBeforeLow + 1, 'fragment-low save: expected exactly 1 PUT, got ' + (saves.length - savesBeforeLow));
    await navAfterSave(page);
    await gotoSub(page, 'tunnel');
    // bounded re-check (KV read-after-write can lag one render)
    let mode = await page.evaluate(() => { const c = document.querySelector('#sp-tunnel .chip[data-preset="low"]'); return c ? c.getAttribute('aria-checked') : null; });
    for (let i = 0; i < 2 && mode !== 'true'; i++) {
      await page.waitForTimeout(800);
      mode = await page.evaluate(() => { const c = document.querySelector('#sp-tunnel .chip[data-preset="low"]'); return c ? c.getAttribute('aria-checked') : null; });
    }
    assert(mode === 'true', 'fragment preset low not persisted after reload');
    await page.click('#sp-tunnel .chip[data-preset="off"]');
    await page.waitForTimeout(300);
    const savesBeforeOff = saves.length;
    await page.click('#sp-tunnel [data-action="section-save"]');
    await page.waitForTimeout(1200);
    assert(saves.length === savesBeforeOff + 1, 'fragment-off save: expected exactly 1 PUT, got ' + (saves.length - savesBeforeOff));
    // routing rule toggle -> persisted -> revert (state-safe per-save PUT counting)
    await gotoSub(page, 'advanced');
    const bl = page.locator('#sp-advanced input[data-bind="routingRules.bypassLan"]');
    const blBefore = await bl.isChecked();
    await bl.click({ force: true });
    await page.waitForTimeout(300);
    const savesBeforeOn = saves.length;
    await page.click('#sp-advanced [data-action="section-save"]');
    await page.waitForTimeout(1200);
    assert(saves.length === savesBeforeOn + 1, 'routing-on save: expected exactly 1 PUT, got ' + (saves.length - savesBeforeOn));
    await navAfterSave(page);
    await gotoSub(page, 'advanced');
    // KV read-after-write can lag one render inside miniflare — bounded re-check (max 2 re-reads)
    let blAfter = await page.locator('#sp-advanced input[data-bind="routingRules.bypassLan"]').isChecked();
    for (let i = 0; i < 2 && blAfter !== !blBefore; i++) {
      await page.waitForTimeout(800);
      blAfter = await page.evaluate(() => {
        const el = document.querySelector('#sp-advanced input[data-bind="routingRules.bypassLan"]');
        return el ? el.checked : null;
      });
    }
    assert(blAfter === !blBefore, 'routing toggle not persisted (' + blBefore + ' -> ' + blAfter + ')');
    await page.locator('#sp-advanced input[data-bind="routingRules.bypassLan"]').click({ force: true });
    await page.waitForTimeout(300);
    const savesBeforeBack = saves.length;
    await page.click('#sp-advanced [data-action="section-save"]');
    await page.waitForTimeout(1200);
    assert(saves.length === savesBeforeBack + 1, 'routing-off save: expected exactly 1 PUT, got ' + (saves.length - savesBeforeBack));
    // endpoint presets: tick cf-443-a -> persisted -> both outputs carry 104.17.0.0 -> untick
    await gotoSub(page, 'addresses');
    const preset = page.locator('#sp-addresses input[data-preset="cf-443-a"]');
    await preset.click({ force: true });
    await page.waitForTimeout(300);
    const savesBeforePreset = saves.length;
    await page.click('#sp-addresses [data-action="section-save"]');
    await page.waitForTimeout(1200);
    assert(saves.length === savesBeforePreset + 1, 'preset save: expected exactly 1 PUT, got ' + (saves.length - savesBeforePreset));
    await navAfterSave(page);
    await gotoSub(page, 'addresses');
    assert(await page.locator('#sp-addresses input[data-preset="cf-443-a"]').isChecked(), 'preset tick not persisted');
    const subText = await page.evaluate(async (sp) => {
      const r = await fetch(location.origin + '/' + sp + '/sub?target=base64');
      const b64 = await r.text();
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }, SP).catch(() => null);
    assert(subText && subText.includes('104.17.0.0:443'), 'base64 sub missing ticked preset endpoint');
    await preset.click({ force: true });
    await page.waitForTimeout(300);
    await page.click('#sp-addresses [data-action="section-save"]');
    await page.waitForTimeout(1200);
    // custom box: invalid line blocks the save (server 422, state untouched) with a named error
    await gotoSub(page, 'addresses');
    const box = page.locator('#sp-addresses textarea[data-bind="customEndpoints"]');
    const settingsBefore = await page.evaluate(async (sp) => {
      const r = await fetch(location.origin + '/' + sp + '/api/settings', { headers: { 'X-Q-Panel': '1' } });
      return (await r.json()).data.customEndpoints;
    }, SP);
    await box.fill('203.0.113.9:443\nbogus!!\n9.9.9.9:22');
    await page.waitForTimeout(500);
    await page.click('#sp-addresses [data-action="section-save"]');
    await page.waitForTimeout(1200);
    const fieldErr = await page.evaluate(() => {
      const el = document.querySelector('#sp-addresses textarea[data-bind="customEndpoints"]');
      const fw = el ? el.closest('.field') : null;
      const err = fw ? fw.querySelector('.field__error') : null;
      return err ? err.textContent : '';
    });
    assert(fieldErr.includes('line 2') && fieldErr.includes('bogus!!'), 'per-line error missing/naming wrong (got ' + JSON.stringify(fieldErr) + ')');
    const settingsAfterBad = await page.evaluate(async (sp) => {
      const r = await fetch(location.origin + '/' + sp + '/api/settings', { headers: { 'X-Q-Panel': '1' } });
      return (await r.json()).data.customEndpoints;
    }, SP);
    assert(JSON.stringify(settingsAfterBad) === JSON.stringify(settingsBefore), 'rejected save mutated state');
    await box.fill('203.0.113.9:443');
    await page.waitForTimeout(500);
    const savesBeforeCustom = saves.length;
    await page.click('#sp-addresses [data-action="section-save"]');
    await page.waitForTimeout(1200);
    assert(saves.length === savesBeforeCustom + 1, 'custom save: expected exactly 1 PUT');
    await navAfterSave(page);
    await gotoSub(page, 'addresses');
    assert((await box.inputValue()).includes('203.0.113.9:443'), 'custom line not persisted');
    await box.fill('');
    await page.waitForTimeout(500);
    await page.click('#sp-addresses [data-action="section-save"]');
    await page.waitForTimeout(1200);
    ok('settings-roundtrips', 'profileTitle + fragment-low + routing toggle + endpoints persisted & reverted; exactly 1 PUT per save (' + saves.length + ' PUTs observed)');
    // egress pool card: fetch settles into rows, an error card with retry, or an empty card with retry
    await gotoSub(page, 'egress');
    await page.click('[data-action="pool-fetch"]');
    await page.waitForFunction(() => { const el = document.getElementById('pool-list'); return el && !el.querySelector('.loading-box'); }, null, { timeout: 20000 }).catch(() => {});
    const poolState = await page.evaluate(() => {
      const el = document.getElementById('pool-list');
      if (!el) return 'missing';
      if (el.querySelector('.pool-row')) return 'rows';
      if (el.querySelector('.empty-card--error')) return el.querySelector('[data-action="pool-fetch"]') ? 'error-retry' : 'error-noretry';
      if (el.querySelector('.empty-card')) return el.querySelector('[data-action="pool-fetch"]') ? 'empty-retry' : 'empty-noretry';
      return 'other';
    });
    assert(poolState === 'rows' || poolState === 'error-retry' || poolState === 'empty-retry', 'pool-list has no rows and no retryable state (got ' + poolState + ')');
    ok('settings-pool', 'pool card settled into ' + poolState);
  } finally {
    page.off('request', counter);
  }
}

async function step8_wizard(page) {
  await page.click('#shortcuts-btn');
  await page.waitForSelector('#m-keys:not([hidden])', { timeout: 5000 });
  await page.click('#keys-body [data-action="wizard-replay"]');
  await page.waitForSelector('#m-wizard:not([hidden])', { timeout: 5000 });
  const title = await page.textContent('#wiz-title');
  assert(title && title.length > 3 && !KEY_PAT.test(title), 'wizard title missing/raw key: ' + title);
  await page.evaluate(() => document.getElementById('wiz-skip').click());
  await page.waitForTimeout(300);
  const hidden = await page.evaluate(() => document.getElementById('m-wizard').hidden);
  assert(hidden, 'wizard skip did not close');
  ok('wizard-replay', '"?" -> Replay -> wizard opens ("' + title + '") -> skip closes');
}

async function step9_a11y(page) {
  await gotoPanel(page, '#/home');
  // arrow key moves tab selection
  const tabHome = page.locator('#tab-home');
  await tabHome.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const moved = await page.evaluate(() => ({
    focused: document.activeElement.id,
    selected: [...document.querySelectorAll('#nav .tab')].filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.id),
  }));
  // selection follows the arrow and the view navigates (the router moves focus to the view
  // heading per the pre-existing SPA convention, so focus is not asserted here)
  assert(moved.selected.includes('tab-subs'), 'aria-selected did not follow focus');
  assert(moved.focused === 'subs-h1' || moved.focused === 'tab-subs', 'unexpected focus after arrow nav (got ' + moved.focused + ')');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  // endpoint widgets are labelled: preset checkboxes wrapped in <label>, custom textarea has label[for]
  await gotoSub(page, 'addresses');
  await page.waitForTimeout(400);
  const orphan = await page.evaluate(() => {
    const orphans = [];
    document.querySelectorAll('#sp-addresses input[data-preset]').forEach(ctrl => {
      if (!ctrl.closest('label')) orphans.push('no-label: ' + ctrl.dataset.preset);
    });
    document.querySelectorAll('#sp-addresses textarea[data-bind]').forEach(ctrl => {
      if (!ctrl.id) { orphans.push('no-id'); return; }
      if (!document.querySelector('label[for="' + CSS.escape(ctrl.id) + '"]')) orphans.push('no-label: ' + ctrl.id);
    });
    return orphans;
  });
  assert(orphan.length === 0, 'orphan inputs in endpoint widgets: ' + JSON.stringify(orphan));
  // ECH preview dir=auto in FA
  await page.evaluate(() => { document.cookie = 'qp_lang=fa; Path=/; Max-Age=31536000; SameSite=Lax'; location.reload(); });
  await waitForPanel(page);
  await dismissWizard(page);
  await gotoSub(page, 'protocols');
  await page.evaluate(() => { const d = document.querySelector('#sp-protocols details.adv-tls'); if (d) d.open = true; });
  await page.waitForTimeout(250);
  const ech = await page.evaluate(() => {
    const p = document.querySelector('[data-ech-preview]');
    return p ? p.getAttribute('dir') : null;
  });
  assert(ech === 'auto', 'ECH preview dir != auto in FA (got ' + ech + ')');
  // back to EN
  await page.evaluate(() => { document.cookie = 'qp_lang=en; Path=/; Max-Age=31536000; SameSite=Lax'; location.reload(); });
  await waitForPanel(page);
  await dismissWizard(page);
  ok('a11y', 'ArrowRight/Left moves tabs + aria-selected follows, 0 orphan endpoint inputs, ECH dir=auto in FA');
}

async function step10_i18n(page) {
  await page.evaluate(() => { document.cookie = 'qp_lang=fa; Path=/; Max-Age=31536000; SameSite=Lax'; location.reload(); });
  await waitForPanel(page);
  await dismissWizard(page);
  const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  assert(dir === 'rtl', 'dir != rtl in FA (got ' + dir + ')');
  const leaked = [];
  for (const h of ['#/home', '#/subs', '#/warp', '#/settings/general', '#/settings/protocols', '#/settings/addresses', '#/settings/egress', '#/settings/tunnel', '#/settings/advanced']) {
    await page.evaluate(hash => { location.hash = hash; }, h);
    await page.waitForTimeout(T.navTo);
    const found = await page.evaluate(() => {
      const v = [...document.querySelectorAll('#view-home,#view-subs,#view-warp,#view-settings')].find(v => !v.hidden);
      if (!v) return [];
      const out = [];
      v.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0 && el.textContent) {
          const s = el.textContent.trim();
          if (s.length > 3 && s.length < 60 && /^[a-z]+\.[a-z][a-zA-Z.]*$/.test(s)) out.push(s);
        }
      });
      return out;
    });
    if (found.length) leaked.push({ hash: h, found });
  }
  assert(leaked.length === 0, 'raw dict keys visible in FA: ' + JSON.stringify(leaked));
  await page.evaluate(() => { document.cookie = 'qp_lang=en; Path=/; Max-Age=31536000; SameSite=Lax'; location.reload(); });
  await waitForPanel(page);
  await dismissWizard(page);
  ok('i18n', 'FA dir=rtl, zero raw dict keys across 9 views, back to EN');
}

async function step11_mobile(context) {
  const mctx = await context.browser().newContext({ viewport: { width: 375, height: 812 } });
  const mpage = await mctx.newPage();
  mpage.on('pageerror', e => consoleErrors.push('m-pageerror: ' + e.message));
  mpage.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*40[13]/.test(m.text())) consoleErrors.push('m-console: ' + m.text()); });
  try {
    await mpage.goto(BASE + '/' + SP + '/login', { waitUntil: 'networkidle' });
    await mpage.fill('#pw', PW);
    await mpage.click('#go');
    await mpage.waitForURL('**/panel', { timeout: T.nav });
    await waitForPanel(mpage);
    await dismissWizard(mpage);
    const views = [['home', '#/home'], ['subs', '#/subs'], ['warp', '#/warp'], ['settings-protocols', '#/settings/protocols']];
    for (const [name, h] of views) {
      await mpage.evaluate(hash => { location.hash = hash; }, h);
      await mpage.waitForTimeout(T.navTo + T.settle);
      const sw = await mpage.evaluate(() => document.scrollingElement.scrollWidth);
      assert(sw <= 375, name + ': scrollWidth=' + sw + ' > 375');
      // tabs unmasked: all 4 tabs have offsetParent (visible/scrollable, none display:none)
      const tabs = await mpage.evaluate(() => {
        const els = [...document.querySelectorAll('#nav .tab')];
        return { count: els.length, allVisible: els.every(t => t.offsetParent !== null) };
      });
      assert(tabs.count === 4 && tabs.allVisible, name + ': tabs count/visible bad ' + JSON.stringify(tabs));
    }
    ok('mobile-375', 'home/subs/warp/settings-protocols: scrollWidth<=375, 4 tabs unmasked');
  } finally {
    await mctx.close();
  }
}

async function step12_undo(page) {
  await gotoSub(page, 'general');
  const inp = page.locator('#sp-general input[data-bind="profileTitle"]');
  const orig = await inp.inputValue();
  await inp.click();
  await inp.fill(orig);
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  const val1 = await inp.inputValue();
  assert(val1 === orig + 'X', 'typed value wrong: ' + val1);
  // the dirty/undo snapshot push is debounced (~120ms after the last keystroke);
  // wait for it to land before exercising section undo
  await page.waitForTimeout(350);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const val2 = await inp.inputValue();
  assert(val2 === orig, 'Ctrl+Z did not revert (' + val2 + ' vs ' + orig + ')');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(250);
  const val3 = await inp.inputValue();
  assert(val3 === val1, 'Ctrl+Shift+Z did not re-apply (' + val3 + ' vs ' + val1 + ')');
  // discard with confirm
  const barVisible = await page.locator('#applybar').isVisible();
  assert(barVisible, 'applybar not visible with dirty edit');
  await page.click('#discard-btn');
  await page.waitForSelector('#m-confirm:not([hidden])', { timeout: 5000 });
  await page.click('#cf-ok');
  await page.waitForTimeout(300);
  const val4 = await inp.inputValue();
  assert(val4 === orig, 'discard did not restore original (' + val4 + ' vs ' + orig + ')');
  const barHidden = await page.evaluate(() => document.getElementById('applybar').hidden);
  assert(barHidden, 'applybar still visible after discard');
  ok('undo', 'edit X -> Ctrl+Z revert -> Ctrl+Shift+Z redo -> discard(confirm) -> clean at "' + orig + '"');
}

// ================= main =================
const started = new Date().toISOString();
let browser = null;
try {
  assert(SP.length === 24, 'securePath missing from .pi/ui-audit/local-sp.txt');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'qp_lang', value: 'en', url: BASE }]);
  await context.addInitScript(() => { try { localStorage.setItem('qp_wizard_done', '1'); } catch (e) {} });
  const page = await context.newPage();
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  // 40x resource errors are walk-triggered probes (401/403 auth gates, 422 intentional invalid saves); anything else fails the contract
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*(40[123]|422)/.test(m.text())) consoleErrors.push('console: ' + m.text()); });
  page.on('dialog', d => d.dismiss().catch(() => {}));

  const steps = [
    ['1.login', () => step1_login(page)],
    ['2.tabs', () => step2_tabs(page)],
    ['3.home', () => step3_home(page)],
    ['4.subs', () => step4_subs(page, context)],
    ['5.users', () => step5_users(page)],
    ['6.warp', () => step6_warp(page)],
    ['7.settings', () => step7_settings(page)],
    ['8.wizard', () => step8_wizard(page)],
    ['9.a11y', () => step9_a11y(page)],
    ['10.i18n', () => step10_i18n(page)],
    ['11.mobile', () => step11_mobile(context)],
    ['12.undo', () => step12_undo(page)],
  ];
  for (const [name, fn] of steps) {
    const t0 = Date.now();
    let attempt = 0;
    while (attempt < 2) {
      attempt++;
      try {
        await fn();
        results.push({ name, pass: true, ms: Date.now() - t0 });
        console.log('STEP  ' + name + '  ' + (Date.now() - t0) + 'ms  PASS');
        break;
      } catch (e) {
        if (attempt < 2) {
          console.log('  retry ' + name + ' after: ' + String(e.message).slice(0, 100));
          await sleep(700);
          try { await page.goto(BASE + '/' + SP + '/panel', { waitUntil: 'networkidle', timeout: 20000 }); await waitForPanel(page); await dismissWizard(page); } catch (e2) {}
        } else {
          await shotOnFail(page, 'fail-' + name);
          results.push({ name, pass: false, ms: Date.now() - t0, error: String(e.message).slice(0, 300) });
          console.log('STEP  ' + name + '  ' + (Date.now() - t0) + 'ms  FAIL: ' + String(e.message).slice(0, 150));
        }
      }
    }
  }
} catch (e) {
  results.push({ name: 'harness', pass: false, error: String(e.message).slice(0, 300) });
  console.log('HARNESS FAIL: ' + e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
}
const finished = new Date().toISOString();
const stepResults = results.filter(r => r.ms !== undefined || r.name.startsWith('harness'));
const passCount = stepResults.filter(r => r.pass).length;
const verdict = passCount === stepResults.length && stepResults.length >= 12 && consoleErrors.length === 0 ? 'PASS' : 'FAIL';
const report = {
  started, finished, verdict,
  steps: stepResults,
  passCount, totalSteps: stepResults.length,
  consoleErrors,
  shotsDir: SHOTS,
  base: BASE, sp: SP,
};
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log('\n=== UI WALK: ' + passCount + '/' + stepResults.length + ' steps — verdict ' + verdict + ' — consoleErrors ' + consoleErrors.length + ' ===');
stepResults.forEach(r => { if (!r.pass) console.log('  FAIL ' + r.name + ': ' + (r.error || '').slice(0, 200)); });
process.exit(verdict === 'PASS' ? 0 : 1);
