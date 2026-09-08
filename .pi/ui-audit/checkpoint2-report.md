# Checkpoint 2 — Phase 2 Verification Report

**Date:** 2026-09-08 · **Scope:** Tasks 6–11 (Subscriptions hub, WARP grouping, Users surface, Settings 10→6, ShareSheet) verified coherently
**Mode:** READ-ONLY sweep — no src/ or test/ files touched; no commits. Evidence: `.pi/ui-audit/shots/checkpoint2/` (64 screenshots) + `checkpoint2-*.json` summaries.
**Harness:** Python Playwright (sync), fresh-boot per matrix cell (cookie + localStorage seeded before panel boot), sessionStorage-busted reloads for persistence checks, dev server http://127.0.0.1:8799 (wrangler-dev-8799).

---

## Verdict

**CHECKPOINT 2: PASS — 0 regressions against Phase-2 task claims.**
1 new non-blocking finding (mobile overflow on settings tunnel/egress — pre-existing, not introduced by Phase 2), 2 nits. All matrix cells PASS; server state verified restored after the sweep.

| Metric | Result |
|---|---|
| Matrix cells verified | 118 checks across A + B + C |
| Screenshots | 64 (`cp2-<view>-<lang>-<theme>`, `cp2-m-*`, `cp2-fl*`, `cp2-focus-ring`) |
| Console errors (authenticated, all sweeps) | **0** |
| Unit + workers suite | **1404/1404** (94 files) |
| Typecheck | clean |
| Build | `dist/q-proxy.js` = `dist/_worker.js` = 627,675 B; UI-asset budget test (340 KB) green |
| Tree | clean (only untracked `.pi/` throwaways) |

---

## A. Views × themes × languages — PASS

10 views (home, subs, users, warp-list, warp-detail, settings-general/protocols/tunnel/egress/advanced) × {en, fa} × {dark, light} = **40 fresh-boot captures**, each boot-sanity-asserted (theme actually applied, `dir` actually applied, expected section visible, subs rows rendered):

- `cp2-<view>-<lang>-<theme>.png` — all 40 present.
- EN dark/light and FA dark/light verified visually (subs, home-light, warp-detail-fa-dark, users-fa-light, settings-tunnel-fa-light reviewed in full): RTL mirrors correctly, URLs stay LTR (`dir="ltr"` on code), copy/QR buttons mirror, FA digits in capacity chip («۱ از ۵۰ کاربر»), light theme passes contrast (Task 3 tokens hold), grouped WARP families + count chips render in both languages.
- Zero horizontal overflow on all views except the finding below (§ Mobile).

## B. Cross-task interaction flows — PASS (12/12 matrix items)

1. **User create → ShareSheet → rotate** — `cp2-fl1-sharesheet.png`, `cp2-fl1-rotate-sharesheet.png`
   - Create `cp2probe` → ShareSheet: full URL `…/sub/<uuid>` (per-user sub link — correct shape), shown-once warning visible, QR canvas non-blank, Copy byte-verified (`navigator.clipboard.readText() === url`), Download fires (`.png` suggested filename), Close hides modal.
   - Rotate `alpha` (confirm → OK) → ShareSheet with **changed** URL; row token hint changed after close. *(alpha's token is now rotated — recorded, non-destructive.)*
2. **Subs hub** — `cp2-fl2-subs-expanded.png`, `cp2-fl2-subs-fragment.png`, `cp2-fl2-home-teaser.png`
   - All 6 format rows (base64/clash/singbox/surge/loon/quantumult, each with `?target=`), Clash expander opens, base64 row exposes `?target=base64` variant, **fragment mode chip rewrites all URLs with `mode=fragment`** (and back), hub copy byte-verifies, Home shows the 3-row teaser + "All formats & variants" link.
3. **WARP detail** — `cp2-fl3-warp-detail.png`, `cp2-fl3-amnezia-toggled.png`, `cp2-fl3-preset-confirm.png`
   - URLs-first (subscription block precedes settings card in DOM order), **7 client-family groups covering all 17 formats exactly once** (chips sum 17), Amnezia toggle hides exactly the 5 `-amnezia` variants (17→12) and restores, Task7 Probe card reads "2 custom endpoints" (dict-exact) + AMZ tag, custom-endpoints textarea intact, preset-switch → confirm → **CANCEL keeps custom endpoints** byte-identical.
4. **Settings round-trips** (change → Apply → toast → cache-busted reload → persists → restore → Apply) — `cp2-fl4-applybar.png`, `cp2-fl4-address-card.png`, `cp2-fl4-tunnel.png`
   - Fragment preset (medium → persist → **factory default off restored**, ranges disabled under preset), `profileTitle`, **address add → label → rename → persist → delete → state restored** (also proves Task 10's readBind list fix on the addrList path), proxyIP list line, `routingRules.blockQuic` — all persist and all restored.
5. **Destructive confirms all CANCELLED, nothing destroyed** — `cp2-fl5-import-confirm.png`, `cp2-fl5-discard-confirm.png`, `cp2-fl5-bulk-confirm.png`
   - Import: file chooser → dialog **names the file** ("…from \"cp2-import-fixture.json\"") → CANCEL.
   - Discard: dirty field → dialog → CANCEL keeps edits → second Discard reverts (cleanup).
   - Bulk: 2 users selected → "Disable 2 selected users?" (verb + count) → CANCEL → both still enabled.
6. **Search + capacity** — `cp2-fl6-search.png`: `alp` filters to alpha only; capacity chip `2/50 users` matches rows; **FA-digit spot check** `۲ از ۵۰ کاربر` (Task 9 FA rendering confirmed live).
7. **Legacy hashes** — all five land: `#/settings/users→#/users`, `#/settings/warp→#/warp`, `#/settings/fragment→#/settings/tunnel`, `#/settings/chain→#/settings/tunnel`, `#/settings/sources→#/settings/egress` (hash rewritten **and** target view visible).
8. **Mobile 375px** — `cp2-m-home/subs/users/warp-detail/settings-protocols/settings-tunnel/subs-fa.png`
   - No horizontal overflow on home/subs/users/warp-detail/protocols (scrollWidth = 375), topbar shows all 5 tabs (none masked away, min tab height 34px), FA RTL at 375px clean.
   - ⚠️ **FINDING (1): settings tunnel + egress expand the layout viewport to 562px** (Chrome shrink-to-fit) — see REGRESSIONS/FINDINGS below.
9. **Keyboard** — `cp2-fl9-keyboard.png`, `cp2-focus-ring.png`: roving arrow keys on the nav (`tab-home → tab-subs`), Enter activates, **Escape closes ShareSheet and restores focus to the trigger** (`[data-action=qr]` re-focused), focus ring visibly rendered.
10. **Console** — **0 errors and 0 warnings across every authenticated sweep** (40 view boots + all flow runs + mobile). Login page itself loads clean (the old 401 probe noise is gone — auth-status working). One 401 appears only when an unauthenticated visitor hits `/panel` directly (boot's `api/bootstrap` probe before the redirect to `/login`) — see NIT 3.

## C. Code-level cross-checks — PASS

- **dict.js parity**: 616 EN keys ↔ 616 FA keys, **0 singletons**. Every wave namespace verified bilingual: `subs.*` 21/21, `fmt.*` 12/12, `share.*` 8/8, `users.*` 62/62, `warp.fmt.*` **17/17** (drift-guarded against the server registry), `warp.groups.*` 9/9, `confirm.*` 18/18, `address.*` 2/2, `tabs.settings.tunnel` 1/1.
- **Suite**: `npx vitest run` → **1404/1404** (94 files) — includes the contrast drift guard, format-label drift guard, ShareSheet 20-assertion drift test, fields READONLY_UI_PATHS guard.
- **Build**: 627,675 bytes both outputs; no budget test failure (UI assets well under the 340 KB test budget).
- **Tree**: `git status` clean; HEAD = `eddeba7` (Task 11 tick). Nothing uncommitted.

## REGRESSIONS / FINDINGS

**0 regressions against Phase-2 task claims.** Every claim re-verified live: Task 6 (hub, teaser, staleness fix, attachment split), Task 7 (urls-first, error/retry wiring present, `warp.fmt.*` adoption), Task 8 (7 groups, amnezia toggle, preset honesty, cache purge), Task 9 (8-column table, countdown/quota/scope/capacity/search, FA digits), Task 10 (6 subtabs, tunnel/egress merge, textarea-list save path — now proven end-to-end on two list field types), Task 11 (unified ShareSheet across create/rotate/subs-QR with honest clipboard + focus restore).

**FINDING 1 (new, non-blocking, pre-existing) — Mobile: settings tunnel/egress pages expand the layout viewport to 562px.**
At 375px, `scrollWidth/innerWidth = 562` on `#/settings/tunnel` and `#/settings/egress` only (other views 375). Root cause traced to `.help-pop` (`src/ui/panel/app.css:102`): `visibility:hidden; opacity:0` keeps the 260px-wide absolutely-positioned tooltip **occupying layout**; when its `.help-wrap` trigger sits right of ~x=115px (long labels in Tunnel/Egress), the pop's box overflows the document and mobile Chrome shrink-to-fit zooms out. Protocols' triggers sit further left, so it doesn't trigger there. Suggested fix (one rule): hide with `display:none` until shown (`.help-wrap:hover .help-pop, .help-wrap:focus-within .help-pop { display:block }` — costs the fade transition), or flip the pop toward the inline-end when near the edge. Not a Phase-2 regression — surfaced now only because this checkpoint added the scrollWidth assertion.

**NIT 1 — Stale settings render after save + quick reload.** After a successful Apply, a plain `page.reload()` within the bootstrap cache TTL renders **pre-save** values (verified: server truth was correct via `api/settings`; UI showed old chip until sessionStorage `qpc:/qpe:api/bootstrap` keys expired or were cleared). `applySection` (`src/ui/panel/settings.js:472-486`) clears those keys only for general/addresses saves (via `refreshSubUrls`). Suggest clearing them on every section save — cheap, removes a real "my change didn't stick" papercut. (Eventual consistency is documented architecture; the UI can hide it further.)

**NIT 2 — `fpreset` chip click on the already-active preset is a silent no-op** (aria already checked → collectSection == snapshot → not dirty). Correct behavior, worth knowing when scripting.

**NIT 3 — Unauthed `/panel` logs one 401 console error** (boot probe of `api/bootstrap` before the login redirect). Session-expiry path only; the login page itself is clean.

**Harness notes (not app issues, for the next verifier):** (a) `page.goto` with only a hash change does not reload the document — theme/lang matrix cells need a real navigation or `sessionStorage.clear()` + reload; (b) row-level users checkbox locator must be `input[data-user-select]` — plain `input[type=checkbox]` also matches the per-row enable switch; (c) styled switches (`.switch input`) can't be physically clicked by Playwright (track overlays) — click the label or dispatch JS click, as real users effectively do via the label.

## State restoration (verified via API after the sweep)

`fragment` factory default (off, 100/200/1/1, split 2/4) · `profileTitle` "Q Proxy" · `proxyIps` [] · `blockQuic` false · `addresses` [] · users = [alpha, enabled] only (cp2probe/cp2b created + deleted) · Task7 Probe intact (custom endpoints, AMZ overrides) · `passwordIsBootstrap` false. Known state change: **alpha's subscription token was rotated** (by the matrix's rotate flow — its old sub links are invalid by design; the current one works).

---

*Run artifacts: `checkpoint2-views.json`, `checkpoint2-flows.json` (+v3/v4/v5), `checkpoint2-mobile.json`; sweep scripts `cp2-views.py`, `cp2-flows.py`, `cp2-flows-v3.py`, `cp2-flows-v4.py`, `cp2-flows-v5.py`, `cp2-mobile.py` under `.pi/ui-audit/`.*
