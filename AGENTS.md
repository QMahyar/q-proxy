# AGENTS.md — Q Proxy

Context for AI agents working in this repo. Read this before any change. Frozen contracts live in `docs/ARCHITECTURE.md` — do not rename exported types without an architecture revision.

## What This Is

Single-user Cloudflare Worker that terminates VLESS, VMess, Trojan and Shadowsocks over WebSocket and serves UA-negotiated subscriptions. Zero runtime npm dependencies. One KV namespace. Single-file build `dist/q-proxy.js` for dashboard paste or `wrangler deploy`. Bilingual EN/FA panel embedded as HTML strings.

## Tech Stack

- TypeScript 7.0.2 (native), strict, ES2023 target
- Cloudflare Workers runtime (`cloudflare:sockets` for TCP egress), compatibility date `2026-08-01`
- esbuild 0.28 bundler — single file output, `.html` loaded as text, rejects bare imports except `cloudflare:*`
- vitest 4 with two projects: `unit` (node) + `workers` (`@cloudflare/vitest-pool-workers`, miniflare)
- wrangler 4.125 for dev/deploy

## Commands

```
npm install          # devDependencies only
npm run typecheck    # tsc --noEmit — must pass before commit
npm test             # vitest run (both projects)
npx vitest run --project unit     # pure logic, no workerd
npx vitest run --project workers  # full fetch through src/worker.ts
npm run dev          # wrangler dev → http://127.0.0.1:8787
npm run build        # → dist/q-proxy.js (~228 KB)
npm run deploy       # build + wrangler deploy
node scripts/version.mjs        # print version (from git tag)
node scripts/release.mjs <version> [--dry]  # tag + changelog check + build
```

Deploy credentials: Global API Key pattern from `E:\vault\Platforms\cloudflare\platform.md` — `$env:CLOUDFLARE_API_KEY` (cfk_ prefix) + `$env:CLOUDFLARE_EMAIL` + `$env:CLOUDFLARE_ACCOUNT_ID`. Using `CLOUDFLARE_API_TOKEN` with a cfk_ key fails `[code: 9109]`.

## Code Conventions

- Named exports everywhere; default export only in `src/worker.ts`
- No comments in implementation code — rationale lives in docs
- Parsers never throw: return `{ok:true,value}` / `{ok:false,reason}` (`ParseResult`) or `PushOutcome` states
- Errors: throw `AppError` subclasses from `src/core/errors.ts`; handlers convert to WS close codes (1008 reject, 1011 infra) or JSON envelope
- Result convention for settings validation: `{ok:true,value:Settings}|{ok:false,fields}`
- Tests mirror `src/` paths under `test/`; workers tests only under `test/workers/`
- Settings writes always go through `validateSettings` then `saveSettings`
- Sensitive fields (`passwordHash`, `passwordSalt`, `sessionSecret`) never appear in API responses, logs, or HTML

## Architecture Map

```
src/worker.ts            fetch export, error boundary, counters hook
src/core/routes.ts       pure path matchers: identifyTunnel, resolveSecureRoute
src/core/router.ts       routeRequest — ordered dispatch, kill-switch before upgrade
src/protocols/common.ts  ProtocolInbound seam: push/responseHeader/takeInitialPayload/bodyCodec
src/protocols/*.ts       vless, vmess(+vmess-crypto), trojan(+UDP codec), shadowsocks(SIP004 LE nonce)
src/tunnel/egress.ts     makeFailoverStrategy [chain→direct→proxyIp×8|nat64], createEgressOpener(dialImpl?)
src/tunnel/relay.ts      WS↔TCP pump, zero-byte retry hook, header written once
src/nodes/generate.ts    ProxyNode[] builder — port↔security pairing invariant, fragment⇒TLS∧¬CDN, SS earlyData=0
src/nodes/emitters/*     base64-list, clash-yaml, singbox-json, surge-conf, loon-conf (+registry)
src/subscription/        negotiate (?target= > UA > base64), headers, merge (remote subs)
src/auth/                password (PBKDF2 100k + legacy 15k), session (HMAC q_session), guard (CSRF X-Q-Panel)
src/settings/            store (15s isolate cache + loadSettingsFresh), seed, migrate, validate (52 fields)
src/handlers/            tunnel, subscribe, doh, myip(requireAuth), robots, camouflage, api/*
src/ui/assets.ts         panel.html, login.html, camo.html as strings
```

## Invariants (do not break)

1. Port family must match security: tls ⇒ {443,2053,2083,2087,2096,8443}, none ⇒ {80,8080,8880,2052,2082,2086,2095}
2. Fragment nodes are TLS-only and exclude CDN addresses; SS nodes have earlyData=0
3. SS AEAD nonce is little-endian increment (SIP004) — test helper in `test/protocols/shadowsocks.spec.ts:38` must stay LE too
4. First packet is consumed once: `initialPayload ?? rest` in `src/handlers/tunnel.ts` — never concatenate both
5. Trojan UDP datagrams are framed ATYP+addr+port+len+payload — codec strips/re-applies
6. Kill-switch gate runs before WebSocket upgrade (`src/core/router.ts`)
7. `mergeInto` skips `__proto__`/`constructor`/`prototype` keys and uses `Object.hasOwn`
8. Setup endpoint re-reads KV via `loadSettingsFresh` before write (TOCTOU)
9. Emitters are pure functions `(nodes, opts) => string` — no fetch, no KV, no `cloudflare:*`

## Boundaries

- Never add a runtime dependency to `package.json`
- Never commit secrets: `.dev.vars`, vault paths, passwords, KV dumps
- Never log password/hash/sessionSecret/UUIDs/securePath values
- Do not edit `docs/ARCHITECTURE.md` frozen sections without recording the change in the Rev header at line 3
- Do not widen the route table without updating both `docs/ARCHITECTURE.md` §3 and `test/workers/router.spec.ts`
- Ask before changing wire formats (share URIs, emitter output) — golden tests will break on purpose

## Patterns

Adding a setting field:
1. Add to `Settings` interface + `DEFAULT_SETTINGS` in `src/types/settings.ts`
2. Validate in `src/settings/validate.ts` (use existing helpers: boolField/intField/strField/strArrayField)
3. Bind in `src/ui/panel.html` (field registry + dictionaries en/fa)
4. Test in `test/settings/validate.spec.ts`

Adding an emitter:
1. Extend `SubFormat` in `src/core/ua.ts` + sniff tokens
2. Create `src/nodes/emitters/<name>.ts` exporting `(nodes, opts) => string`
3. Register in `src/nodes/emitters/registry.ts`, add to `FORMATS` in `src/handlers/subscribe.ts`
4. Golden test in `test/nodes/emitters/<name>.spec.ts` + UA case in `test/core/ua.spec.ts`

Protocol changes: validate against Xray-core fixtures first (`docs/research/04-protocol-formats.md`), keep parsers throwing never.

## Known Gaps (v1.0.1)

- Change-password endpoint absent — logout is client-side cookie clear only; sessions revoke only via secret rotation (not exposed)
- Early-data oversize drops silently instead of closing 1009
- Login throttle is per-isolate memory (best-effort)
- Counters are estimates (`download = requestsTotal × 1 MiB`)

## Live Deployment

Worker `q-proxy` on Horror account `ff2508cf6f5086d052488a181a1d6a45`, URL `https://q-proxy.qhorror13194.workers.dev`, securePath `11cb1a51aa9ce39cf25a77c4`, KV `a8183f8f7f734e51b2fd7cc80634d14f`. Vault record: `E:\vault\Platforms\cloudflare\qproxy.md`.
