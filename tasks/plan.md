# Implementation Plan: UI Audit Remediation — Q Proxy v1.5

## Overview

Implement every finding from the 33-agent deep UI audit (`docs/ui-audit.md`, 239 findings → deduplicated into 24 work tasks) end to end. Goal: professional-grade panel parity — best of BPB (client import UX), nahan (user-facing sub info), and pro dashboards (Tailscale/CF patterns), while keeping our security/i18n/engineering lead. Every task is verified by: unit tests, `tsc`, build, and **visual Playwright checks against the local dev server** (wrangler dev on port 8799, credentials in `.pi/ui-audit/local-*.txt`, gitignored).

## Architecture Decisions

- **Target IA (from audit §5): 5 top-level tabs** — Home / Subscriptions (new hub) / Users (promoted) / WARP (promoted) / Settings (10→6 subtabs: General, Protocols, Addresses, Egress, Tunnel, Advanced). Hash-route only; NO worker route changes; `test/workers/router.spec.ts` untouched.
- **No expert mode.** Collapsibles within subtabs instead (audit decision 2).
- **Kill-switch = Home card only. Language = topbar only** (zombie General controls removed).
- **securePath control: delete the UI control** (server strips it; `resolveSecureRoute` honor-path stays server-side for manual KV edits). Flagged product decision — revisit only with a dedicated honored write path.
- **ShareSheet**: one modal component (URL + copy + QR + download + shown-once warning) replaces `#m-qr` auto-copy, `#m-rot`, and per-row copy/QR fragments.
- **Format labels single-source**: export `FORMAT_LABELS` from a shared module consumed by hub, info page, WARP detail + drift test vs `src/warp/formats/registry.ts` and `src/subscription/` formats.
- **err.* contract: option (b)** — delete the vestigial client bridge; server error strings stay English prose (documented limitation, FA later if ever).
- Golden emitter/share-URI tests may move **on purpose** where the audit says so (Profile-Update-Interval derivation); wire formats and node URIs never change.
- No runtime deps. Panel parts stay named-export ES modules assembled at build. All UI strings via dict.js.

## Workstreams (mapped to audit dims)

- **WS-A IA & Navigation** (dims 2, 5): tabs, redirects, settings merges, Ctrl+K truth
- **WS-B Users domain** (dims 4): token column, zero state, read surface, ShareSheet, quota relabel
- **WS-C Subscriptions hub** (dims 10, 2): `#/subs` page, format rows, info-page footer link, staleness fix
- **WS-D WARP domain** (dims 9): top tab, detail reorder, format grouping, preset honesty, error/retry
- **WS-E Visual & A11y** (dims 6, 8, 13): light-theme tokens, empty states, radiogroup keyboard, live regions, labels
- **WS-F Copy & i18n** (dims 1, 11, 8): dead-key purge + guard, hardcoded strings → dict, FA fixes, quota relabel
- **WS-G Interaction safety** (dims 15, 12): confirms for import/discard/preset-switch, double-submit, undo/redo fixes, wizard funnel
- **WS-H Perf & code org** (dims 17, 2): minify + ETag, dict split, dirty-tracking, settings.js split, dead branch/code purge

Dependency rule: WS-A (nav skeleton) first — everything hangs off it. Then B/C/D parallel on the new skeleton. E/F/G parallel after. H's dead-code purge last (needs merges done to know what's dead).

## Task List

### Phase 1: Skeleton & shipstoppers (WS-A + criticals)

- [ ] **Task 1 (WS-A): Promote Users + WARP to top-level tabs with back-compat redirects**
  - shell.html: add `.tab` links `#/users`, `#/warp` (labels `nav.users`, `nav.warp` — key already exists); parseRoute gains `subs|users|warp` views; `#/settings/users` → `#/users`, `#/settings/warp[/:id]` → `#/warp[/:id]` via history.replaceState; SECTIONS trimmed to 6 (users/warp out); subtab bar hides for entity views; showSection branches for users/warp; per-view boot loaders wired.
  - Acceptance: 5 tabs render; old hashes land on new views; no console errors; dict keys EN+FA.
  - Verify: `npx vitest run --project unit test/ui` + Playwright: click each tab, screenshot; visit `#/settings/users` redirects.
  - Files: `src/ui/panel/shell.html, home.js, settings.js, users.js, warp.js, dict.js`; `test/ui/*`
  - Size: M

- [ ] **Task 2 (WS-B): Users token column + zero state + quota relabel (shipstopper)**
  - users.js: delete dead `u.token` branch; render `tokenHint` + per-row actions (copy hint / rotate via ShareSheet once Task 12 lands, interim: open rotate modal); `.empty-card` zero state w/ 'Create first user' CTA; relabel 'Daily request limit' → 'Daily subscription fetch limit' (+FA) with reset note; hide table chrome at n=0.
  - Verify: unit tests + Playwright: empty state screenshot; create user → row shows hint not toast text.
  - Files: `src/ui/panel/users.js, dict.js`
  - Size: S

- [ ] **Task 3 (WS-E): Light-theme WCAG token fix**
  - app.css: remap light `--success/--warning/--danger` (≥4.5:1 on light bg), split `--text-faint/--text-ghost`, `.empty-title` → `var(--text)`; dark unchanged.
  - Verify: contrast script in test (compute ratios from tokens) + Playwright screenshots light/dark empty users.
  - Files: `src/ui/panel/app.css`; `test/ui/*`
  - Size: S

- [ ] **Task 4 (WS-G): Destructive-action confirmations**
  - confirmDialog wraps: settings import (actions.js:46), WARP preset delete (actions.js:117), Discard bar (actions.js:44 — confirm only when dirty sections exist); bulk-user dialog names the operation.
  - Verify: Playwright: trigger each, cancel + confirm paths screenshot.
  - Files: `src/ui/panel/actions.js, dict.js`
  - Size: S

- [ ] **Task 5 (WS-F): securePath dead control removal**
  - settings.js: remove control + confirm flow + redirect; General shows read-only 'Panel address' line (base URL + current path, copy button); delete `confirm.*` securePath keys server keeps.
  - Verify: unit + Playwright General screenshot; saving settings no longer mentions securePath.
  - Files: `src/ui/panel/settings.js, dict.js`
  - Size: S

- [ ] **Checkpoint 1:** typecheck + unit + build green; Playwright pass 1 (tabs, users empty/filled, light/dark contrast, confirms) screenshotted into `.pi/ui-audit/shots/phase1/`.

### Phase 2: Entity surfaces (WS-B/C/D parallel)

- [ ] **Task 6 (WS-C): Subscriptions hub `#/subs`**
  - New view: per-format main links (expanders w/ params doc), per-user links section, WARP formats link-out, 'Panel info' as labeled footer link (kills home.js:90 magic-string filter); Home sub rows → 3-row teaser + 'View all'; refreshSubUrls after protocols-only save (staleness fix); format labels from shared FORMAT_LABELS.
  - Verify: unit + drift test + Playwright hub screenshots EN/FA; stale-sub regression test.
  - Files: `src/ui/panel/{home,settings,dict,actions}.js`, new `src/ui/panel/subs.js`, `src/subscription/render.ts` or shared labels module, shell.html, `test/ui/*`
  - Size: L

- [ ] **Task 7 (WS-D): WARP top-level page + detail reorder + error/retry**
  - Port warp section to `#/warp` view (accounts grid, presets, amnezia); detail: Subscription URLs first, device token collapsed; failed loads → error card + Retry (no silent blanks).
  - Verify: unit + Playwright: warp list/detail/error (offline sim) screenshots.
  - Files: `src/ui/panel/{warp,home,actions,dict}.js`
  - Size: M

- [ ] **Task 8 (WS-D): WARP format grouping + preset honesty**
  - Group 17 formats by client family w/ hints + content-type tags; Amnezia variants toggle; endpoint preset select shows 'Custom (n)' placeholder on custom accounts + confirmDialog before switching away (silent-data-loss path); labels via dict `warp.fmt.*`.
  - Verify: unit + drift test (registry.ts ↔ groups) + Playwright detail screenshots.
  - Files: `src/ui/panel/{warp,dict}.js`, shared labels module
  - Size: M

- [ ] **Task 9 (WS-B): Users read surface + capacity**
  - Columns: expiry countdown, quota `todayHits/dailyReqLimit`, protocol scope chips, override badge; merge Enabled+disabled chip; `7/50 users` capacity chip; client search/filter; relabel quota (done T2) consistent here; wire `/activity` OR delete byte plumbing (default: delete writers-of-nothing).
  - Verify: unit + Playwright: populated table screenshots EN/FA.
  - Files: `src/ui/panel/{users,home,dict,actions}.js`
  - Size: M

- [ ] **Task 10 (WS-A): Settings IA merge 10→6**
  - Sources→Egress (delete `sourceUrls` UI; keep server field deletion for T19), Fragment+Chain→Tunnel, Routing-rules card in Advanced (wire `routing.title`), Panel-access card in General (allowedIps + read-only address line), General: remove kill-switch + lang + debug juggling; Advanced TLS collapsible in Protocols (ECH trio, alpn, sniCase, fingerprint via showIf).
  - Verify: unit + drift tests + Playwright: 6 subtabs screenshots; every old subtab hash still routes.
  - Files: `src/ui/panel/{settings,home,dict,actions}.js`, shell.html
  - Size: L

- [ ] **Task 11 (WS-B): ShareSheet component**
  - One modal: URL text + copy + QR + download + 'shown once' warning; used by user create, rotate, WARP regen; replaces `#m-qr` auto-open, `#m-rot`, per-row QR/copy fragments; `navigator.share` when available.
  - Verify: unit + Playwright: open from all three flows, screenshot; keyboard trap works.
  - Files: new `src/ui/panel/share.js`, `{users,warp,actions,dict}.js`, shell.html
  - Size: M

- [ ] **Checkpoint 2:** full unit + build; Playwright pass 2 (hub, warp, users flows EN/FA + mobile 375px) into `.pi/ui-audit/shots/phase2/`.

### Phase 3: Copy, i18n, interaction quality (WS-F/E/G parallel)

- [ ] **Task 12 (WS-F): Dead-key purge + computed unused-key guard**
  - Delete ~70 dead keys ×2 (checker.*, ports.*, proxyip.*, nav.checker, tabs.settings.ports/proxyip, warp.view.*, dead err.*, toast.*, wizard.s1_title, app.name, common.yes/no, common.theme*, onboarding.setup.expired…); KEEP-and-wire: `nav.warp` (T1), `home.status.total` (T13), `routing.title` (T10); new drift test: every dict key referenced somewhere in src/ui or deleted.
  - Verify: guard test fails if dead keys reintroduced; unit + build.
  - Files: `src/ui/panel/dict.js`, `test/ui/assets.spec.ts`
  - Size: M

- [ ] **Task 13 (WS-F): Hardcoded strings → dict + metric honesty + FA fixes**
  - `warp.fmt.*` (from T8), Amnezia labels one AMZ_FIELDS (dict-keyed), shell a11y strings (`a11y.*` via buildShell), noscript/skip-link, wire `home.status.total`, `dir=auto` ECH preview, language default: keep `fa` owner-first but document + honor cookie first-paint (no navigator sniff — owner decision documented).
  - Verify: i18n census test (no hardcoded UI strings in JS beyond allowlist) + Playwright FA screenshots.
  - Files: `src/ui/panel/{warp,settings,home,dict,head}.js`, shell.html
  - Size: M

- [ ] **Task 14 (WS-G): Wizard funnel + undo/redo + double-submit fixes**
  - Wizard step-1 CTA sets `qp_wizard_done`, Escape closes, 'Replay setup guide' entry in shortcuts/help; undo/redo: snapshot pre-edit state (not post), work inside focused inputs, buttons on apply bar; `withBusy` on ~10 unprotected mutations; section-save disables the right button; copy reports real clipboard success.
  - Verify: unit + Playwright: wizard replay, undo/redo roundtrip screenshots.
  - Files: `src/ui/panel/{actions,chrome,settings,dict}.js`
  - Size: M

- [ ] **Task 15 (WS-E): A11y hardening**
  - Radiogroup keyboard controller (arrows RTL-flipped, roving tabindex, Home/End) for accent/lang/egress-mode; label/id generation addrCard + remoteNode + override labels; modal + Apply errors: `role=alert` live region + focus-first-invalid; toast no longer the only error channel for SRs.
  - Verify: axe-style spot checks + Playwright keyboard-nav screenshots; unit.
  - Files: `src/ui/panel/{lib,chrome,settings,actions}.js`, shell.html
  - Size: M

- [ ] **Task 16 (WS-E): Empty/loading component consolidation**
  - One `.empty-card` builder (icon/title/msg/CTA) used everywhere (users/warp/subs/home); one loading component (skeleton variant) replacing ad-hoc spinners/text; all loading surfaces get error+retry pairing (with T7 pattern).
  - Verify: unit + Playwright: throttle CPU/network → skeletons visible screenshots.
  - Files: `src/ui/panel/{lib,users,warp,home,subs}.js`, app.css
  - Size: M

- [ ] **Checkpoint 3:** full unit + build; Playwright pass 3 (keyboard nav, FA, wizard, undo/redo) into `.pi/ui-audit/shots/phase3/`.

### Phase 4: Perf, purge, polish (WS-H)

- [ ] **Task 17 (WS-H): Minify + ETag**
  - esbuild minify JS+CSS in assemblePanel (target ≤150KB from 258KB); deploy-hash ETag + `no-cache` revalidation for panel/login HTML; per-language dict split (serve active lang only).
  - Verify: build size assertion test; curl ETag roundtrip; Playwright smoke.
  - Files: `scripts/build-single-file.mjs`, `src/ui/assets.ts`, `src/handlers/panel-page.ts`
  - Size: M

- [ ] **Task 18 (WS-H): Dead code purge**
  - Ports renderer machinery, IP-checker sediment (branch, MAX_TARGETS, `#i-play/#i-stop`), dead Ctrl+K + shortcuts.search row, users `u.token` remnants (post-T2), no-op Apply bars (users/warp/sources), 'source-doh' action, wizard silent-skip onclick, `vtype:'url'`, unreachable empty-subs branch → capability-gated warning, visual dead tokens/`--line` fossils, `.home-grid` hover lift, shine sweep, spinring, duplicate nameTemplate placeholders, 'Panel info' importable row (post-T6), users disabled chip (post-T9), home `<details>` WARP list (post-T6).
  - Verify: unit + build + grep-guard tests (no resurrected symbols); Playwright smoke.
  - Files: `src/ui/panel/{settings,home,users,warp,lib,chrome}.js`, shell.html
  - Size: M

- [ ] **Task 19 (WS-H): Server-side field deletions + derived headers**
  - Delete `settings.localDns`, `settings.sourceUrls`, `addresses[].city` from fields.ts/validate.ts/settings types + migration note (KV migrate drops keys); `Profile-Update-Interval`/`Cache-Control` derived from `subUpdateIntervalHours` in one helper (golden tests updated on purpose); AGENTS.md 66→76 fields fix; user_activity bytes decision (delete zero-writer plumbing).
  - Verify: validate tests + golden emitter diffs reviewed + workers tests green.
  - Files: `src/settings/{fields,validate}.ts`, `src/types/settings.ts`, `src/subscription/headers.ts`, `test/*`
  - Size: M

- [ ] **Task 20 (WS-H): settings.js split + dirty-tracking**
  - Split 48KB monolith at joints: sections registry / fields-render / totp / users-modal / section-io; O(1) per-section dirty tracking (replace per-keystroke JSON diff of 10 panels); one section-scoped snapshot module (replaces S.snap/UR/S.dirty trio).
  - Verify: unit + build; Playwright full regression pass.
  - Files: `src/ui/panel/{settings → settings/*.js}`, assembly update
  - Size: L

- [ ] **Checkpoint 4:** full suite + build size report; Playwright final pass (all views EN/FA, light/dark, 375px/1280px) into `.pi/ui-audit/shots/phase4/`.

### Phase 5: Verification & release

- [ ] **Task 21: End-to-end visual regression suite**
  - Playwright script `scripts/ui-walk.mjs`: login → all 5 tabs → every subtab → user create/rotate → WARP account + detail + formats → hub → settings save → kill-switch → logout; EN+FA × light+dark × 375/1280; screenshots + console-error assert; runs against `wrangler dev`.
  - Verify: script green twice consecutively.
  - Size: M

- [ ] **Task 22: Release prep**
  - CHANGELOG entry, docs/USER_GUIDE + DEVELOPER_GUIDE updates (new IA, removed fields), screenshots into docs, version bump decision (v1.5.0), tag.
  - Verify: `npm test` + `npm run typecheck` + build; docs reviewed.
  - Size: S

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Hash-router regressions break deep links | Med | Back-compat redirects + parseRoute unit tests |
| Drift tests (fields/dict/formats) churn across tasks | Med | Each task updates its own guard; guards run in CI order |
| ShareSheet replaces three flows — regression blast radius | Med | Feature-flag-free but landing in T11 after B/C/D surfaces stabilize |
| Server field deletions (T19) touch golden tests | Low | Audit pre-approved; update goldens deliberately, note in CHANGELOG |
| Playwright flakes on dev-server timing | Med | `waitUntil:networkidle` + retry-once + fixed local creds |
| Parallel agents editing same files (dict.js!) | High | Task batches sequentialized by file ownership; dict edits per-task own keys namespace |

## Open Questions (decided by owner where noted)

- securePath: delete UI control (decided), revisit honored write path later if owner wants rotation.
- FA first-paint stays `fa` (owner-first product) — documented, not sniffed (decided).
- user_activity bytes plumbing: delete (default) unless per-user detail view wanted later.

## Execution notes for agents

- Branch: work on `master` directly in small commits per task (repo convention), or `feat/ui-v15` if parallel batching — coordinator decides per wave.
- Every task: `npm run typecheck && npm test && npm run build` before handoff + Playwright evidence.
- Credentials for dev server: `.pi/ui-audit/local-sp.txt` (securePath) + `.pi/ui-audit/local-pw.txt` (password `LocalTest99`), server `http://127.0.0.1:8799` (background task `wrangler-dev-8799`).
- dict.js is a shared file — agents must not reformat; add keys in their own `t.<task>.` namespace block, coordinator dedupes at checkpoint.
