# AGENTS.md — Q Proxy

Context for AI agents working in this repo. Read this first, then [CONTEXT.md](CONTEXT.md) for the subsystem map and conventions cheat-sheet. Frozen contracts live in `docs/ARCHITECTURE.md` — do not rename exported types without an architecture revision. Why those contracts exist lives in `docs/decisions/` (ADRs 001–005+).

## What This Is

Self-hosted Cloudflare Worker or Pages Function under one admin: terminates VLESS, VMess, Trojan and Shadowsocks over WebSocket and serves UA-negotiated subscriptions, plus scoped per-user subscription links (`src/users/`), WARP/WireGuard config serving (`src/warp/`) and an optional Telegram bot. Zero runtime npm dependencies. One KV namespace + one D1 database. Single-file build `dist/q-proxy.js` (Workers) and `dist/_worker.js` (Pages Advanced Mode) for dashboard paste or `wrangler deploy` / `wrangler pages deploy`. Bilingual EN/FA panel assembled at build time from `src/ui/panel/` parts. A standalone deploy manager (`deploy.py`, Python stdlib only) provisions Workers/Pages targets interactively or via flags. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for all deployment paths. Current release: **v1.5.0**.

## Tech Stack

- TypeScript 7.0.2 (native), strict, ES2023 target
- Cloudflare Workers runtime (`cloudflare:sockets` for TCP egress), compatibility date `2026-08-01`
- KV (`QPROXY_KV`) + D1 (`QPROXY_DB`) bindings; write-hot state lives in D1 (users, totals, usage, activity, counters, audit), settings/WARP/auth state in KV
- esbuild 0.28 bundler — single file output, `.html` loaded as text (panel minified at bundle time), rejects bare imports except `cloudflare:*`
- vitest 4 with two projects: `unit` (node) + `workers` (`@cloudflare/vitest-pool-workers`, miniflare, includes D1)
- wrangler 4.125 for dev/deploy; `deploy.py` (Python 3, stdlib only) as an alternative panel/infra manager

## Commands

```
npm install          # devDependencies only
npm run typecheck    # tsc --noEmit — must pass before commit
npm test             # vitest run (both projects)
npx vitest run --project unit     # pure logic, no workerd
npx vitest run --project workers  # full fetch through src/worker.ts (+ D1)
npm run dev          # wrangler dev → http://127.0.0.1:8787 (local miniflare KV; use `--remote` for prod KV)
npm run build        # → dist/q-proxy.js + dist/_worker.js (panel minified at bundle time)
npm run test:ui      # scripts/ui-walk.mjs — 12-step Playwright regression walk vs wrangler dev
npm run deploy       # deploy via scripts/deploy-direct.mjs (CF REST API; creates KV if missing)
npm run deploy:pages # build + wrangler pages deploy dist --project-name=q-proxy
python deploy.py     # interactive panel manager: New/Update/Delete/List/Token menus
python deploy.py deploy --target workers --name X --password Y   # flag-driven (agents)
python deploy.py urls --name X   # reprint a panel's login/panel/sub links from KV
node scripts/version.mjs        # print version (from git tag)
node scripts/release.mjs <version> [--dry] [--push]  # typecheck+tests+build+tag
```

CI: `.github/workflows/ci.yml` runs `npm ci` + `npm run typecheck` + `npm test` on every push/PR (node 22).

No eslint by design: `typescript-eslint` peer-depends on `typescript <6.1.0` while this repo runs TypeScript 7.0.2 native; strict `tsc --noEmit` (incl. `noUnusedLocals`/`noUnusedParameters`) is the lint gate, and the esbuild single-file build rejects bare imports. Revisit when typescript-eslint supports TS 7.

If a local `wrangler dev` wedges (workerd accepts connections but never responds): kill the stray workerd process on the port, then relaunch on another port (`npx wrangler dev --port 8788`). **Gotcha:** `wrangler dev` serves `dist/q-proxy.js` (per `wrangler.toml main=`) — `npm run dev` rebuilds first, but a bare `npx wrangler dev` shows only what was last built; if a change "doesn't take effect", rebuild before debugging the code.

Deploy auth: Cloudflare **Global API Key** env vars — `$env:CLOUDFLARE_API_KEY` (Global Key, cfk_-style) + `$env:CLOUDFLARE_EMAIL` + `$env:CLOUDFLARE_ACCOUNT_ID`. Using `CLOUDFLARE_API_TOKEN` with a Global Key fails `[code: 9109]`. Scoped bearer tokens (`cfut_...`) work with `Authorization: Bearer` for Workers/KV/D1/Pages if minted with those permission groups (`python deploy.py mk-token --key <cfk> --email <email> --account <id>`). Private deploy targets live in `wrangler.local.toml` (gitignored, same shape as `wrangler.toml`). Full matrix (Workers, Pages, Deploy Button, KV setup) is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Code Conventions

- Named exports everywhere; default export only in `src/worker.ts`
- No comments in implementation code — rationale lives in `docs/ARCHITECTURE.md` and `docs/decisions/` (ADRs)
- Parsers never throw: return `{ok:true,value}` / `{ok:false,reason}` (`ParseResult`) or `PushOutcome` states
- Errors: throw `AppError` subclasses from `src/core/errors.ts`; handlers convert to WS close codes (1008 reject, 1011 infra) or JSON envelope
- Result convention for settings validation: `{ok:true,value:Settings}|{ok:false,fields}`
- Tests mirror `src/` paths under `test/`; workers tests only under `test/workers/`
- Settings writes always go through `validateSettings` then `saveSettings`
- Sensitive fields (`passwordHash`, `passwordSalt`, `sessionSecret`, write-only `telegram.botToken`) never appear in API responses, logs, or HTML

## UI Architecture (src/ui/panel/ — read src/ui/panel/README.md first)

The panel is **not** a single HTML file anymore. Build-time sources live in `src/ui/panel/` (22 parts); `scripts/build-single-file.mjs` splices them into `src/ui/panel.html` (git-kept generated output — **edit the parts, never the generated file**). Assembly is plain concatenation sharing ONE IIFE scope: parts reference each other's top-level functions directly, no imports — **hoisting order in `PANEL_JS_ORDER` matters**, and function names must never be renamed.

| Part | Owns |
|---|---|
| `dict.js` | EN/FA dictionaries (620→547 keys, parity enforced), language/theme controllers; heap drops the inactive language when `qp_lang` cookie is pinned |
| `format-labels.js` | Client format registry + `FORMAT_ORDER`, drift-guarded 1:1 against server `SUB_FORMATS`/`EXTENSIONS` |
| `lib.js` | dom/api/toast/modal/confirm helpers; `copyText` returns real booleans |
| `a11y.js` | radiogroup keyboard controller (RTL-aware), `announce()` live region, `nextId()` |
| `qr.js`, `states.js` | QR encoder; `emptyCard`/`loadingBox`/`errorCard` builders (every loader: loading→content→errorCard(retry)) |
| `home.js` | state, hash router (5 views + back-compat redirects), home view |
| `subs.js` | Subscriptions hub (`#/subs`) — every URL the worker serves |
| `warp.js` | WARP views (7 format families, amnezia toggle, preset honesty) |
| `users.js` | user table (expiry countdown, quota, scope chips, search, capacity) |
| `users-modal.js`, `share.js` | create/edit modal; unified ShareSheet |
| `chrome.js`, `sections*.js`, `fields-*.js`, `cards.js`, `totp.js`, `section-io.js`, `settings.js` | chart/banner/shortcuts/undo-redo; settings split across 8 modules (registry, render, validate, cards, totp, modal, IO, 4-line glue) |
| `actions.js` | action dispatch table + boot; closes the IIFE |

UI drift guards (all in `test/ui/`, run with unit project): `dict-usage.spec.ts` (computed unused-key guard — every dict key must be referenced or it fails CI), `dict-split.spec.ts` (heap split), `contrast.spec.ts` (WCAG ≥4.5:1 both themes), `format-labels.spec.ts` (server↔client format registries + WARP groups), `assets.spec.ts` (assembly, sizes, resurrection guards for ~34 deleted symbols). If a refactor orphans a dict key or resurrects dead code, these tests catch it — fix forward, don't weaken.

Visual regression: `npm run test:ui` (needs `wrangler dev` on :8799 + creds in `.pi/ui-audit/local-*.txt`, gitignored). 12 steps, zero-console-error contract, JSON verdict. UI strings are EN+FA only via `dict.js` (`t()`); server validation messages are English prose (known gap, documented).

## Architecture Map

```
src/worker.ts            fetch export, error boundary, counters hook
src/core/routes.ts       pure path matchers: identifyTunnel, resolveSecureRoute
src/core/router.ts       routeRequest — ordered dispatch, kill-switch before upgrade, bootstrap gate
src/protocols/common.ts  ProtocolInbound seam: push/responseHeader/takeInitialPayload/bodyCodec
src/protocols/*.ts       vless, vmess(+vmess-crypto), trojan(+UDP codec), shadowsocks(SIP004 LE nonce)
src/tunnel/egress.ts     makeFailoverStrategy [chain→direct→proxyIp×8|nat64], createEgressOpener(dialImpl?)
src/tunnel/relay.ts      WS↔TCP pump, zero-byte retry hook, header written once
src/nodes/generate.ts    ProxyNode[] builder — port↔security pairing invariant, fragment⇒TLS∧¬CDN, SS earlyData=0
src/nodes/emitters/*     clash-yaml, singbox-json, surge-conf, loon-conf (+registry; base64 renders in subscription/render.ts)
src/subscription/        negotiate (?target= > UA > base64), headers (Profile-Update-Interval derived from subUpdateIntervalHours), merge (remote subs)
src/users/store.ts       per-user directory (≤50): token subs, protocol filter, daily quota, expiry; D1-backed
src/auth/                password tiers (PBKDF2 100k current, 15k legacy auto-upgraded on login), session (HMAC q_session {exp,iat} + revocation floor qproxy:min-iat), guard (CSRF X-Q-Panel)
src/settings/            store (60s isolate cache + loadSettingsFresh), seed, migrate, fields (73 descriptors), validate
src/handlers/            tunnel, subscribe, warp-sub, users-sub, doh, myip(requireAuth), robots, camouflage, panel-page (ETag),
                         api/* (auth+status, settings+bootstrap/export/import/reset, status+suburls, killswitch,
                         warp, users, telegram setup/remove/webhook, version/check)
src/warp/                WARP core: config parsers, api client, store (accounts/presets/amnezia),
                         formats/registry (17 output formats), expand/cache/zip
src/crypto/x25519.ts     hand-rolled X25519 (RFC 7748), zero-dep keypairs
src/ui/assets.ts         panel.html (minified), login.html, camo.html as strings
```

## Invariants (do not break)

1. Port family must match security: tls ⇒ {443,2053,2083,2087,2096,8443}, none ⇒ {80,8080,8880,2052,2082,2086,2095}
2. Fragment nodes are TLS-only and exclude CDN addresses; SS nodes have earlyData=0
3. SS AEAD nonce is little-endian increment (SIP004) — test helper in `test/protocols/shadowsocks.spec.ts:38` must stay LE too
4. First packet is consumed once: `initialPayload ?? rest` in `src/handlers/tunnel.ts` — never concatenate both
5. Trojan UDP datagrams are framed ATYP+addr+port+len+CRLF+payload (downlink echoes the request source address) — codec strips/re-applies
6. Kill-switch gate runs before WebSocket upgrade (`src/core/router.ts`)
7. `mergeInto` skips `__proto__`/`constructor`/`prototype` keys and uses `Object.hasOwn`
8. Setup endpoint re-reads KV via `loadSettingsFresh` before write (TOCTOU)
9. Emitters are pure functions `(nodes, opts) => string` — no fetch, no KV, no `cloudflare:*`
10. Subscription addresses come ONLY from the worker hostname + user-owned lists (`customDomains`, `cleanIps`, `cdn.*`). No IP or domain may ever be hard-coded into generation; enforced by the address-composition tests in `test/nodes/generate.spec.ts`.
11. Panel part function names are a cross-file contract — never rename a top-level function in `src/ui/panel/*.js` without grepping all 22 parts (plain-concat scope).
12. Never edit `src/ui/panel.html` directly — it is generated; edit `src/ui/panel/` parts and rebuild.
13. Wire gzips of panel assets stay under budget (`test/ui/assets.spec.ts`); minification happens in `scripts/build-single-file.mjs` (`minifyHtmlAsset`), never in-place on sources.

## Boundaries

- Never add a runtime dependency to `package.json` (esbuild/vitest/wrangler/playwright are devDeps; `deploy.py` is stdlib-only by contract)
- Never commit secrets: `.dev.vars`, vault paths, passwords, KV dumps, `.pi/ui-audit/local-*.txt`
- Never log password/hash/sessionSecret/UUIDs/securePath values
- Do not edit `docs/ARCHITECTURE.md` frozen sections without recording the change in the Rev header at line 3
- Do not widen the route table without updating both `docs/ARCHITECTURE.md` §3 and `test/workers/router.spec.ts`
- Ask before changing wire formats (share URIs, emitter output) — golden tests will break on purpose; when the plan pre-authorizes a golden move, record old→new in the report/CHANGELOG
- UI changes: run `npm run test:ui` before declaring done; all user-visible strings via `dict.js` (EN+FA), never hardcoded

## Patterns

Adding a setting field:
1. Add to `Settings` interface + `DEFAULT_SETTINGS` in `src/types/settings.ts`
2. Add a descriptor row in `src/settings/fields.ts` (`SETTING_FIELD_DESCRIPTORS` — single source of truth; `validate.ts` consumes it)
3. Bind in the relevant `src/ui/panel/` part (FL registry row) + add strings to `dict.js` EN+FA
4. Test in `test/settings/validate.spec.ts`; drift tests (`fields.spec.ts`, `dict-usage.spec.ts`) enforce table/interface/registry/dict agreement — they fail if you forget a step

Adding an emitter:
1. Extend `SubFormat` in `src/core/ua.ts` + sniff tokens
2. Create `src/nodes/emitters/<name>.ts` exporting `(nodes, opts) => string`
3. Register in `src/nodes/emitters/registry.ts`, add to `FORMATS` in `src/subscription/negotiate.ts` (see `docs/decisions/ADR-004.md`)
4. Golden test in `test/nodes/emitters/<name>.spec.ts` + UA case in `test/core/ua.spec.ts`
5. Client mirror: `format-labels.js` + `test/ui/format-labels.spec.ts` (drift guard fails until the label exists)

Adding a UI view/tab:
1. Add the part to `src/ui/panel/` + `PANEL_JS_ORDER` in dependency-safe position (helpers before consumers)
2. Route in `home.js` `parseRoute` (+ back-compat redirect if replacing an old route)
3. All strings via new `dict.js` keys ×2 — `dict-usage.spec.ts` fails on unused keys, so delete-as-you-go
4. Extend `scripts/ui-walk.mjs` with a step; run `npm run test:ui`

Protocol changes: validate against Xray-core fixtures first (`docs/research/04-protocol-formats.md`), keep parsers throwing never.

## Verification Loop

After every change: `npm run typecheck && npm test`. UI-facing changes additionally: `npm run build && npm run test:ui`. Before release: `node scripts/release.mjs <version> --push` (runs all three + tags).

## Known Gaps

- Post-handshake WS backpressure is platform-limited — the Workers WS API exposes no send-buffer signal; relay relies on uplink coalescing + hard caps
- Trojan/VLESS UDP merge pipelined datagrams into one DoH query (uplink decode concatenates frames before relaying)
- sing-box emitter uses the legacy dns schema (forward-compat note — migration rejected for now, documented in DEVELOPER_GUIDE)
- users-sub intentionally never merges remoteSubUrls (per-user scoping: protocol filters must hold)
- Server-side validation messages are English-only even in the FA UI
- cleanIps entries pinning ports outside the CF port families are silently dropped (zero nodes emitted for that address) — documented behavior
- SSRF guards (`isLocalOrPrivateTarget` on dohUpstream/remoteDns/camouflage/remoteSubUrls/egress targets) are host-literal only: a DNS name resolving to a private address is not pre-resolved (Workers egress does not route RFC1918/link-local, and DoH pre-resolution would introduce a TOCTOU window)
- Login throttle is KV-backed (`qproxy:login-fail:<sha256-ip>:<minute>`, 120s TTL, fail-open on KV error) with an isolate-memory fast path
- Counters are estimates (`download = requestsTotal × 1 MiB`)
- SS salt-replay registry bounded to 2048 entries/isolate; VMess replay registry bounded to 1024 (`src/utils/bounded.ts`)
- `settings.language` seeds the `qp_lang` cookie on first load when the cookie is absent
- Stale-cache read-modify-write: `handleKillSwitch`/`handleSaveSettings` merge from the 60s cached settings — concurrent edits in another isolate can be reverted within the TTL window; panel navs re-fetch after saves (`ensureFreshSubs`) to mask this
- KV colo edge cache (60s, not bypassable via `cacheTtl`) means `loadSettingsFresh` setup-race re-check and the session revocation floor can lag up to ~60s; a losing concurrent setup may briefly retain a valid session
- Telegram webhook authenticates on the 16-hex URL secret OR the `X-Telegram-Bot-Api-Secret-Token` header (setWebhook now registers `secret_token`); chat identity for `@username` chatIds is still client-asserted
- `readJsonObject` caps bodies at 64 KiB while streaming (chunked bodies rejected mid-read, not fully buffered)
- Pure-JS ChaCha20-Poly1305 (BigInt Poly1305, ~2-6 ms/MB) is reachable only when a VMess client negotiates `security=4` or the admin sets SS `chacha20-ietf-poly1305`; the default config never hits it (VMess nodes emit `cipher: auto` → AES-128-GCM, SS default `aes-128-gcm`). Replacing Poly1305 with 32-bit limbs is the remaining fix if chacha traffic becomes a CPU-budget concern
- WARP token rotation responds toast+refresh, not ShareSheet (regen API returns only the token; per-format URL construction lives in warp.js) — deliberate Task-11 follow-up
- Open `.help-pop` tooltip can clip at the right viewport edge at 375px (hidden-state layout overflow fixed; the visible-state anchor is cosmetic-only)
- `user_activity` D1 tables on pre-1.5 deployments keep unused `bytes_up`/`bytes_down` columns (inert; fresh installs match `migrations/0001_init.sql`)
- `USERS_MAX` (50) is mirrored client-side in `users.js` as a constant (panel parts cannot import); drift is covered by API tests, not a shared source
