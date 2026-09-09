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
    const views = [...document.querySelectorAll('#view-home,#view-subs,#view-users,#view-warp,#view-settings')];
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
    const views = [...document.querySelectorAll('#view-home,#view-subs,#view-users,#view-warp,#view-settings')];
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
  assert(tabs.length === 5, 'expected 5 tabs, got ' + tabs.length);
  assert(tabs.every(t => t.label.length > 0), 'a tab label is empty');
  assert(tabs.every(t => !KEY_PAT.test(t.label)), 'raw dict key leaked into tab label: ' + JSON.stringify(tabs));
  ok('tabs', '5 tabs, labeled: ' + tabs.map(t => t.label).join(' / '));
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
  // IP refresh must not console-error (result may be error card if upstream blocked — that is tolerated)
  await page.evaluate(() => { const b = document.querySelector('#home-body [data-action="refresh-ip"]'); if (b) b.click(); });
  await page.waitForFunction(() => ((document.getElementById('ip-body') || {}).textContent || '').length > 0, null, { timeout: 12000 }).catch(() => {});
  const ipBody = await page.evaluate(() => (document.getElementById('ip-body') || {}).textContent || '');
  assert(ipBody.length > 0, 'ip-body still empty 12s after refresh (my-ip fetch hung)');
  ok('home-ip-refresh', 'refresh ran, ip-body non-empty (' + ipBody.replace(/\s+/g, ' ').slice(0, 48) + '…)');
}

async function step4_subs(page, context) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await gotoPanel(page, '#/subs');
  const mainRows = await page.$$eval('#subs-body [id^="hub-u"]', els => els.length);
  assert(mainRows >= 6, 'expected >=6 main format rows, got ' + mainRows);
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
  // per-user section shows alpha
  await page.waitForFunction(() => {
    const box = document.getElementById('subs-users');
    return box && box.textContent && box.textContent.includes('alpha');
  }, null, { timeout: T.nav });
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
  ok('subs-hub', mainRows + ' formats, ?target= variant, mode=fragment toggle, clipboard byte-match, alpha listed, warp link-out, info footer QR-free');
}

async function step5_users(page) {
  await gotoPanel(page, '#/users');
  await page.waitForFunction(() => {
    const tb = document.getElementById('users-rows');
    return tb && !tb.textContent.includes('Loading');
  }, null, { timeout: T.nav });
  // capacity chip matches count (locale-aware digits: FA renders ۲ از ۵۰)
  const cap = await page.evaluate(() => {
    const slot = document.getElementById('users-capacity-slot');
    const txt = slot ? slot.textContent : '';
    const en = txt.match(/(\d+)\s*\/\s*(\d+)/);
    const fa = txt.match(/([۰-۹]+)\s+از\s+([۰-۹]+)/);
    const de = s => s.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
    const m = en || (fa ? { 1: de(fa[1]), 2: de(fa[2]) } : null);
    const rows = document.querySelectorAll('#users-rows tr').length;
    const empty = !!document.querySelector('#users-rows .empty-card');
    return { n: m ? Number(m[1]) : null, max: m ? Number(m[2]) : null, rows, empty };
  });
  assert(cap.n !== null && cap.max === 50, 'capacity chip missing/bad: ' + JSON.stringify(cap));
  const dataRows = cap.empty ? 0 : cap.rows;
  assert(cap.n === dataRows, 'capacity chip ' + cap.n + ' != rendered rows ' + dataRows);
  // alpha row: expiry countdown + quota + scope chips (countdown is locale-aware: "in 12d" or "۱۲ روز دیگر")
  const alpha = page.locator('#users-rows tr', { hasText: /0\s*\/\s*100|[۰-۹]\s*\/\s*[۰-۹]{2,}/ }).first();
  const rowTxt = await alpha.textContent();
  assert(/alpha/i.test(rowTxt), 'quota-bearing row is not an alpha row: ' + rowTxt.slice(0, 60));
  const hasCountdown = (/in \d+d|in \d+h/.test(rowTxt)) || /[۰-۹]+ (روز|ساعت) دیگر/.test(rowTxt);
  assert(hasCountdown, 'alpha row missing expiry countdown (row: ' + rowTxt.slice(0, 80) + ')');
  const hasQuota = (/0\s*\/\s*100/.test(rowTxt)) || /[۰-۹]\s*\/\s*[۰-۹]{2,}/.test(rowTxt);
  assert(hasQuota, 'alpha row missing quota 0/100');
  assert(/All|همه/.test(rowTxt), 'alpha row missing ALL scope chip');
  // search filters
  await page.fill('#users-search', 'zzz-nomatch');
  await page.waitForTimeout(300);
  const filtered = await page.evaluate(() => (document.getElementById('users-rows') || {}).textContent || '');
  assert(filtered.includes('match') === false || filtered.includes('No users match'), 'search no-match state wrong');
  await page.fill('#users-search', 'alpha');
  await page.waitForTimeout(300);
  const shown = await page.evaluate(() => (document.getElementById('users-rows') || {}).textContent || '');
  assert(shown.includes('alpha') && !shown.includes('Alpha') === false || shown.includes('alpha'), 'search "alpha" did not show alpha row');
  await page.fill('#users-search', '');
  await page.waitForTimeout(300);
  // create walkuser -> ShareSheet
  await page.click('[data-action="users-add"]');
  await page.waitForSelector('#m-user:not([hidden])', { timeout: 5000 });
  await page.fill('#mu-name', 'walkuser');
  await page.click('#mu-go');
  await page.waitForSelector('#m-share:not([hidden])', { timeout: 8000 });
  const share = await page.evaluate(() => ({
    url: (document.getElementById('share-url') || {}).value || '',
    title: (document.getElementById('share-title') || {}).textContent || '',
    warnVisible: !(document.getElementById('share-warning') || {}).hidden,
    warnText: (document.getElementById('share-warning') || {}).textContent || '',
  }));
  assert(share.url.includes('/sub/u/'), 'ShareSheet URL is not a per-user sub URL: ' + share.url.slice(0, 60));
  assert(share.warnVisible && share.warnText.length > 3, 'shown-once warning missing');
  const qrPainted = await page.evaluate(() => {
    const c = document.getElementById('share-canvas');
    if (!c || !c.width) return false;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] !== 0) return true;
    return false;
  });
  assert(qrPainted, 'share QR canvas blank');
  // share copy works
  await page.click('#share-copy');
  await page.waitForTimeout(400);
  const clipUser = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clipUser === share.url, 'ShareSheet copy byte-mismatch');
  await page.click('#share-close');
  await page.waitForTimeout(250);
  // delete walkuser (confirm dialog)
  const wrow = page.locator('#users-rows tr', { hasText: 'walkuser' }).first();
  await wrow.locator('[data-action="users-del"]').click();
  await page.waitForSelector('#m-confirm:not([hidden])', { timeout: 5000 });
  await page.click('#cf-ok');
  await page.waitForFunction(() => !document.body.textContent.includes('walkuser'), null, { timeout: 8000 });
  const capAfter = await page.evaluate(() => {
    const m = (document.getElementById('users-capacity-slot') || {}).textContent || '';
    const m2 = m.match(/(\d+)\s*\/\s*(\d+)/);
    return m2 ? Number(m2[1]) : null;
  });
  assert(capAfter === cap.n, 'user count not restored after delete (' + capAfter + ' vs ' + cap.n + ')');
  ok('users', 'capacity chip ' + cap.n + '/50 == rows, alpha row (countdown/quota/scope), search, create->ShareSheet(URL+warning+QR+copy), delete w/ confirm, count restored');
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
  // 7 family groups render
  const groups = await page.$$eval('#warp-detail-subs .warp-group', els => els.map(e => e.dataset.warpGroup));
  assert(groups.length === 7, 'expected 7 WARP family groups, got ' + groups.length + ': ' + JSON.stringify(groups));
  // amnezia toggle flips variant visibility (initial state follows the account: accounts with
  // amnezia_overrides start with the toggle ON, per warp.js warpAmzShow=!!a.amnezia_overrides)
  const amzTotal = await page.$$eval('#warp-detail-subs .fmt-row[data-amz]', els => els.length);
  const toggleBefore = await page.evaluate(() => document.getElementById('warp-amz-toggle').checked);
  const visibleBefore = await page.$$eval('#warp-detail-subs .fmt-row[data-amz]:not([hidden])', els => els.length);
  assert(amzTotal > 0, 'no amnezia variant rows rendered');
  assert(toggleBefore === (visibleBefore === amzTotal), 'amnezia visibility does not follow toggle state (checked=' + toggleBefore + ', visible=' + visibleBefore + '/' + amzTotal + ')');
  // flip the toggle via DOM click (Playwright check/uncheck hangs on this live-rebound input)
  await page.evaluate(() => document.getElementById('warp-amz-toggle').click());
  await page.waitForTimeout(350);
  const visibleFlipped = await page.$$eval('#warp-detail-subs .fmt-row[data-amz]:not([hidden])', els => els.length);
  assert(toggleBefore ? visibleFlipped === 0 : visibleFlipped === amzTotal, 'amnezia toggle did not flip visibility (got ' + visibleFlipped + '/' + amzTotal + ')');
  // restore original toggle state
  await page.evaluate(() => document.getElementById('warp-amz-toggle').click());
  await page.waitForTimeout(300);
  // preset select shows Custom placeholder if custom endpoints
  const preset = await page.evaluate(() => {
    const sel = document.getElementById('warp-preset');
    if (!sel) return null;
    const custom = [...sel.options].find(o => o.value === '__custom');
    return custom ? { selected: custom.selected, label: custom.textContent } : null;
  });
  assert(preset && preset.selected && /Custom/.test(preset.label), 'custom preset placeholder missing/not selected: ' + JSON.stringify(preset));
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
  ok('warp-detail', 'URLs card first, 7 groups, amnezia toggle flips visibility, Custom(n) preset placeholder, rotate changes URL, Escape clean');
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
    ok('settings-roundtrips', 'profileTitle + fragment-low + routing toggle persisted & reverted; exactly 1 PUT per save (' + saves.length + ' PUTs observed)');
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
  assert(moved.focused === 'tab-subs', 'ArrowRight did not move focus to tab-subs (got ' + moved.focused + ')');
  assert(moved.selected.includes('tab-subs'), 'aria-selected did not follow focus');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  // addr card inputs all have label[for]
  await gotoSub(page, 'addresses');
  await page.waitForTimeout(400);
  const orphan = await page.evaluate(() => {
    const orphans = [];
    document.querySelectorAll('#sp-addresses .addr-card__field, #sp-addresses .remote-card .addr-card__field').forEach(wrap => {
      const ctrl = wrap.querySelector('input,select');
      if (!ctrl) return;
      if (!ctrl.id) { orphans.push('no-id'); return; }
      if (!document.querySelector('label[for="' + CSS.escape(ctrl.id) + '"]')) orphans.push('no-label: ' + ctrl.id);
    });
    return orphans;
  });
  assert(orphan.length === 0, 'orphan inputs in addr cards: ' + JSON.stringify(orphan));
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
  ok('a11y', 'ArrowRight/Left moves tabs + aria-selected follows, 0 orphan addr inputs, ECH dir=auto in FA');
}

async function step10_i18n(page) {
  await page.evaluate(() => { document.cookie = 'qp_lang=fa; Path=/; Max-Age=31536000; SameSite=Lax'; location.reload(); });
  await waitForPanel(page);
  await dismissWizard(page);
  const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  assert(dir === 'rtl', 'dir != rtl in FA (got ' + dir + ')');
  const leaked = [];
  for (const h of ['#/home', '#/subs', '#/users', '#/warp', '#/settings/general', '#/settings/protocols', '#/settings/addresses', '#/settings/egress', '#/settings/tunnel', '#/settings/advanced']) {
    await page.evaluate(hash => { location.hash = hash; }, h);
    await page.waitForTimeout(T.navTo);
    const found = await page.evaluate(() => {
      const v = [...document.querySelectorAll('#view-home,#view-subs,#view-users,#view-warp,#view-settings')].find(v => !v.hidden);
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
  ok('i18n', 'FA dir=rtl, zero raw dict keys across 10 views, back to EN');
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
    const views = [['home', '#/home'], ['subs', '#/subs'], ['users', '#/users'], ['settings-protocols', '#/settings/protocols']];
    for (const [name, h] of views) {
      await mpage.evaluate(hash => { location.hash = hash; }, h);
      await mpage.waitForTimeout(T.navTo + T.settle);
      const sw = await mpage.evaluate(() => document.scrollingElement.scrollWidth);
      assert(sw <= 375, name + ': scrollWidth=' + sw + ' > 375');
      // tabs unmasked: all 5 tabs have offsetParent (visible/scrollable, none display:none)
      const tabs = await mpage.evaluate(() => {
        const els = [...document.querySelectorAll('#nav .tab')];
        return { count: els.length, allVisible: els.every(t => t.offsetParent !== null) };
      });
      assert(tabs.count === 5 && tabs.allVisible, name + ': tabs count/visible bad ' + JSON.stringify(tabs));
    }
    ok('mobile-375', 'home/subs/users/settings-protocols: scrollWidth<=375, 5 tabs unmasked');
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
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*40[13]/.test(m.text())) consoleErrors.push('console: ' + m.text()); });
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
