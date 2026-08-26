# F7 — Telegram bot (in-depth) — LAST
Type: task (AFK) · Phase: Features · Order: 7 (explicitly last per user)

## Question
Complete bot: token+chatId settings, webhook route, commands (/status /sub /killswitch /usage), rate limiting, secret hygiene (never log token), EN/FA replies. Graduates from fog during research.

## Answer

DONE — implemented in one session per the locked spec. Summary:

1. **Settings:** `telegram:{enabled,botToken,chatId}` added to `Settings`/`DEFAULT_SETTINGS` (`src/types/settings.ts`, new `TelegramSettings` interface). Validation in `src/settings/validate.ts` via `validateNested`: token shape `^\d+:[A-Za-z0-9_-]{35}$` enforced only when enabled and non-empty; chatId numeric or `@name`, ≤64 chars; empty values allowed. `telegram.botToken` is write-only: deleted explicitly in `publicSettingsView` and `handleExportSettings` (SENSITIVE_SETTING_PATHS stays top-level; `PublicSettings` type narrows telegram to `Omit<TelegramSettings,"botToken">`). botToken remains settable through save/import.
2. **Webhook:** `POST /{sp}/telegram/webhook/{secret}` — secret = first 16 hex of HMAC-SHA256(sessionSecret,"tg-webhook") via crypto.subtle, constant-time compared (`constantTimeEqual`), exported as `telegramWebhookSecret()` for tests. Dispatched without requireAuth in `core/router.ts`; settings loaded by the router as usual. Disabled / secret mismatch / chat mismatch / bad JSON → `200 {ok:true,data:{}}` silently (nothing leaks). Commands: `/status` (version + killSwitch + today/total from readUsage), `/sub` (buildSubUrls × resolveHostname), `/kill on|off` (saveSettings killSwitch flip), `/usage`, anything else → help. Replies EN/FA from an inline const map keyed by `settings.language`. sendMessage = fire-and-forget fetch to api.telegram.org with AbortSignal.timeout(5000) + .catch; token never logged, never echoed.
3. **Admin endpoints:** `POST /{sp}/telegram/setup|remove` (session+CSRF via authedCsrf) call setWebhook/deleteWebhook; response `{ok,description}` with token-shaped substrings scrubbed (`bot\d+:…` and raw `\d+:…` forms → masked).
4. **UI:** Advanced section card after DoH (`advanced.tg.title`) with enabled bool, secret token field (copy only, no generator), chatId field, plus a `tgActions:true` card branch rendering Set/Remove webhook buttons wired to ACTIONS `tg-setup`/`tg-remove` with toasts. 11 EN + 11 FA dict keys (`advanced.tg.*`, `tg.setup_ok/setup_fail/remove_ok/remove_fail`).
5. **Tests:** `test/handlers/telegram.spec.ts` (16 unit tests: secret derivation, gate/disabled/chat-mismatch silence, all commands incl. killSwitch flip asserted against fake KV, help on unknown, FA language, token-leak-on-fetch-failure, setup/remove/sanitize/empty-token); `test/settings/validate.spec.ts` (+8 telegram cases); `test/workers/router.spec.ts` (+1 workers block: wrong-secret silent, wrong-chat silent, correct secret flips killSwitch in KV, disabled silent, unauth setup → 401, GET webhook → 405 METHOD, malformed secret → camouflage).

Verify: `npm run typecheck` clean · `npm test` 561/561 (baseline 536 + 25) · `npm run build` OK (dist 369 KB; assets budget unchanged at 190 KB, combined HTML ~172 KB).

Deviations: none functional. Notes: (a) chatId also matches `message.chat.username` when configured as `@name`; (b) admin endpoints live under `/{sp}/telegram/*` (top-level, per spec) rather than `/{sp}/api/telegram/*`; (c) route-table addition recorded in ARCHITECTURE.md Rev 2026-08-25 + §3 rows 22c/22d.
