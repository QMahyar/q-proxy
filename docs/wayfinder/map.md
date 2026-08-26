# Wayfinder Map — Q Proxy v1.1: Efficiency + Feature Completion

Label: `wayfinder:map`

## Destination

Q Proxy panel is maximally efficient on the CF Workers free tier (100k req/day), has every competitive feature gap closed — import/export, routing rules, ECH, user center, first-run wizard, panel self-update, Telegram bot (last) — plus functional UX details, with visual identity ported from warp-generator LAST, gated on explicit user go-ahead ("yes it's the time").

## Notes

- **Execution is carried in this map** (user override of plan-only default): each feature ticket includes research → implement → test → docs.
- **VISUAL GATE (user directive):** No visual identity work from `E:\Code\warp-generator` until user is asked "is this the time?" and answers yes. When yes: re-review the warp-generator codebase FRESH (user is editing it concurrently), then implement. Ticket [V1 Visual design port](tickets/V1-visual-design-port.md).
- Repo conventions: `AGENTS.md` is law — named exports, no comments in impl, ParseResult/PushOutcome, AppError, validateSettings→saveSettings, sensitive fields never in responses, emitters pure, golden tests break on purpose for wire-format changes (ask first), route-table changes must update `docs/ARCHITECTURE.md` §3 + `test/workers/router.spec.ts`.
- Verify each step: `npm run typecheck && npm test` (unit + workers projects).
- Docs updated as we go: AGENTS.md architecture map, ARCHITECTURE.md (Rev header if frozen sections change), CHANGELOG.md.
- Efficiency is TOP priority per user; feature order is user-fixed: import/export → routing → ECH → user center → wizard → self-update → telegram.
- WARP/WireGuard is a separate project; excluded here (merge later).

## Decisions so far

- [F7 Telegram bot](tickets/F7-telegram-bot.md): `telegram:{enabled,botToken,chatId}` settings (token write-only, HMAC-gated public webhook, /status /sub /kill /usage commands EN/FA, admin setWebhook/deleteWebhook + Advanced card); 561/561.

- [F4 User center](tickets/F4-user-center.md): per-user KV directory + token'd `/{sp}/sub/u/{token}` subs with protocol filter, daily quota (429) and expiry/disable (410); admin CRUD + panel Users tab; 536/536.

- [F2 Routing rules](tickets/F2-routing-rules.md): settings schema + clash/singbox rule injection, goldens untouched, 527/527.

- [F1 Import/Export](tickets/F1-import-export.md): export/import settings JSON, secrets stripped, identity preserved.
- [F3 ECH](tickets/F3-ech.md): settings + node.ech + URI/singbox/clash emission.
- [F5 First-run wizard](tickets/F5-first-run-wizard.md): 3-step client wizard, localStorage flag.
- [F6 Self-update](tickets/F6-self-update.md): GitHub release check + panel toast.

- [W3 WARP panel UI](tickets/W3-warp-panel-ui.md): full WARP section (list/detail/settings, 17 sub URLs w/ copy+QR, presets + amnezia editors, modals, EN/FA); live-verified end-to-end incl. real device generation from the modal.

- [W2 WARP subscriptions](tickets/W2-warp-subscriptions.md): 17 formats + public /{sp}/sub/wg/{token}/{format} + edge cache/purge; 525/525 tests; all formats live-verified.

- [W1 WARP core](tickets/W1-warp-core.md): x25519 + parsers + registration client + store + /{sp}/api/warp/* routes; 505/505 tests; live-verified with a real WARP device registration.

- [E1 Bootstrap endpoint](tickets/E1-bootstrap-endpoint.md): GET /api/settings/bootstrap aggregates settings+status+subUrls with ETag/304; boot is now 1 request.
- [E2 ETag/304](tickets/E2-etag-304.md): W/"updatedAt-version" on settings+bootstrap; client revalidates via If-None-Match.
- [E3 Client cache](tickets/E3-client-cache.md): sessionStorage 30s + in-flight dedup; kill-switch 300ms debounce; my-ip on demand.
- [E4 KV optimizations](tickets/E4-kv-optimizations.md): 60s isolate TTL + KV cacheTtl:60 + write-through save + no-op write skip + usage memo 15s.
- [E5 Subscription caching](tickets/E5-subscription-caching.md): Cache API 60s keyed by format+mode; remote subs memoized per update interval.
- [E6 Router early-exit](tickets/E6-router-early-exit.md): robots.txt + OPTIONS answered before loadSettings.
- [E7 Counter waitUntil](tickets/E7-counter-waituntil.md): already threaded via bindCounterContext; usage memo added.
- [V1 Visual design port](tickets/V1-visual-design-port.md): warp-generator design system ported to panel+login (tokens, accent theming x4, ambient layers, logo tile+favicon, pill nav, sheen buttons, glass cards, toasts+skeletons+empty states+chips, sheet modals); verified live in browser, 475/475 tests.
- [E0 Efficiency plan adopted](decisions/E0-efficiency-plan.md): bootstrap coalescing, ETag/304, client cache, KV TTL/write-through/conditional-write, Cache API subs, early-exit router, waitUntil counters — full list with files.
- [Feature scope locked](decisions/feature-scope.md): 7 features in fixed order; WARP excluded; telegram last; visual last + gated.

## Not yet specified

- Telegram: live setWebhook smoke test against a deployed worker (local dev cannot receive Telegram callbacks).
- Surge/Loon routing-rule injection (deferred — clash + sing-box only).
- Per-user remote-sub merge policy (currently excluded by design).
- Change-password endpoint (pre-existing gap; sessions revoke via secret rotation only).
- U-phase polish COMPLETE (2026-08-26): help popovers, on-blur scalar validation, char counters, Worker-quota vs WARP-direct labeling, stale-doc sweep.
## Out of scope

- WARP/WireGuard subscription generation (separate project; future merge).
- Breadcrumbs (ruled out — no competitor uses them; tabs are correct).
- Web fonts (warp-generator uses system fonts only; keep zero-dep).
- Durable Objects / WebSocket panel status / bulk KV API (over-engineering for single-user panel).
