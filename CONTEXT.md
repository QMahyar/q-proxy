# CONTEXT.md — Agent Context Map

Read order: [AGENTS.md](AGENTS.md) (rules) → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (frozen contracts) → this file (map) → task-specific docs ([docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for how-to, `docs/research/04-protocol-formats.md` for wire formats).

## Project Map

| Subsystem | Owns | Key files | Pattern to follow |
|-----------|------|-----------|-------------------|
| `src/core/` | Routing, errors, UA classification, counters, logging | `routes.ts` (pure matchers), `router.ts` (`routeRequest` ordered dispatch), `errors.ts`, `respond.ts` (`jsonOk`/`jsonError`/`readJsonObject` body guard) | Pure functions in `routes.ts`; dispatch table in `router.ts` |
| `src/protocols/` | VLESS/VMess/Trojan/SS inbound parsers over WS | `common.ts` (`ProtocolInbound` seam), `shadowsocks.ts`, `vmess-crypto.ts` | `common.ts` contract: `push()` returns need-more/ready/reject — parsers never throw |
| `src/nodes/` | ProxyNode generation + subscription emitters | `generate.ts` (invariants), `share-uri.ts`, `emitters/base64-list.ts` (smallest emitter), `yaml-writer.ts` | Emitters are pure `(nodes, opts) => string`; copy `base64-list.ts` shape |
| `src/subscription/` | Format negotiation, headers, remote-sub merging | `negotiate.ts` (`?target=` > UA > base64), `headers.ts`, `merge.ts` | `negotiate.ts` priority chain |
| `src/tunnel/` | WS↔TCP relay, egress failover, chain/proxyIP/NAT64 | `egress.ts` (`makeFailoverStrategy`, injectable `dialImpl`), `relay.ts` (pump + zero-byte retry) | Strategy built as candidate list; opener walks it sequentially |
| `src/warp/` | WARP device registration, config parsing, 17 output formats | `api.ts` (retry/backoff client), `store.ts` (two-key write + rollback), `formats/registry.ts`, `x25519` via `src/crypto/x25519.ts` | Register a format once in `formats/registry.ts` maps |
| `src/users/` | Per-user scoped sub links (≤50): token, quota, expiry | `store.ts` | Single JSON-array key `qproxy:users` + day-keyed usage |
| `src/handlers/` | HTTP endpoints gluing everything | `tunnel.ts` (first-packet invariant), `subscribe.ts`, `api/settings.ts` (validate→save), `api/bootstrap.ts` | Handlers orchestrate; logic lives in the owning subsystem |
| `src/settings/` | KV-backed settings: cache, seed, migrate, validate | `store.ts` (60 s isolate cache + `loadSettingsFresh`), `validate.ts`, `migrate.ts` | Writes always `validateSettings` then `saveSettings` |
| `src/auth/` | Password hashing, sessions, CSRF | `password.ts` (PBKDF2 ≥100k), `session.ts` (HMAC `q_session`), `guard.ts` (`X-Q-Panel: 1`) | Constant-time compares everywhere |
| `src/crypto/` | Primitives WebCrypto lacks + X25519 | `md5.ts`, `sha224.ts`, `aes.ts`, `kdf.ts`, `x25519.ts`, `chacha20.ts` | RFC test vectors prove each primitive |
| `src/ui/` | Bilingual EN/FA SPA as HTML strings | `assets.ts` exports `panel.html`/`login.html`/`camo.html` | Field registry + en/fa dictionaries inside `panel.html` |
| `src/utils/`, `src/types/` | Shared helpers and frozen types | `utils/random.ts`, `utils/net.ts`; `types/settings.ts`, `types/node.ts`, `types/tunnel.ts` | Types here are the frozen contract surface |

## Conventions Cheat-Sheet

- Named exports everywhere; default export only in `src/worker.ts`.
- No comments in implementation code — rationale lives in docs.
- Parsers return `{ok:true,value}` / `{ok:false,reason}` or `PushOutcome` states; never throw.
- Errors are `AppError` subclasses; handlers convert to WS close codes (1008 reject, 1011 infra) or the JSON envelope.
- Settings writes go through `validateSettings` → `saveSettings`, never raw KV puts.
- Sensitive fields (`passwordHash`, `passwordSalt`, `sessionSecret`, `telegram.botToken`) never appear in responses, logs, or exports.
- Emitters are pure: no fetch, no KV, no `cloudflare:*`.
- Golden tests break on purpose when wire formats change — ask before changing share URIs or emitter output.
- Route-table changes must update `docs/ARCHITECTURE.md` §3 and `test/workers/router.spec.ts`.

## Verification Loop

After every change:

```
npm run typecheck && npm test
```

- Pure-logic iteration: `npx vitest run --project=unit`.
- Full-request tests need miniflare (`workers` project) — no raw sockets there, use `dialImpl`.
- Before `wrangler dev`: run `npm run build` — dev serves `dist/q-proxy.js`, not source.

## Gotchas

- `src/ui/panel.html` is a large single-file SPA. Edit surgically. Syntax-check your `<script>` block: extract it and run `node -e "new Function(require('fs').readFileSync(0,'utf8'))"` < script.js.
- KV is eventually consistent; the isolate settings cache adds a 60 s window. Setup and kill-switch writes re-read via `loadSettingsFresh` to avoid TOCTOU.
- First packet is consumed exactly once: `initialPayload ?? rest` in `src/handlers/tunnel.ts` — never concatenate both.
- Trojan UDP datagrams are framed ATYP+addr+port+len+CRLF+payload; the downlink re-wraps each chunk with the request's source address (last seen uplink source).
- SS AEAD nonce increments little-endian (SIP004); the test helper at `test/protocols/shadowsocks.spec.ts` must stay LE too.
- Port family must match security: TLS ports {443,2053,2083,2087,2096,8443}, plain {80,8080,8880,2052,2082,2086,2095}. Fragment ⇒ TLS ∧ ¬CDN; SS earlyData = 0.
- Subscription addresses come only from the worker hostname + user-owned lists — never hard-code an IP or domain.
- Git LF/CRLF warnings on Windows are harmless.

## Where to Add Things

| Task | Touch these, in order |
|------|----------------------|
| Setting field | `src/types/settings.ts` → `src/settings/validate.ts` → field registry + en/fa dicts in `src/ui/panel.html` → `test/settings/validate.spec.ts` |
| API route | `SecureRoute`/`ApiRouteName` in `src/core/routes.ts` → `dispatchApi` in `src/core/router.ts` → handler in `src/handlers/api/` → ARCHITECTURE §3 row → `test/workers/router.spec.ts` |
| Sub emitter | `SubFormat` in `src/core/ua.ts` → `src/nodes/emitters/<name>.ts` → `registry.ts` → `SUB_FORMATS` in `src/subscription/negotiate.ts` (single source — subscribe + users-sub both consume it; see DEVELOPER_GUIDE §6) |
| WARP format | `WARP_FORMATS` + `WARP_EMITTERS` + type/extension maps in `src/warp/formats/registry.ts` |
| User-facing string | en/fa dictionaries in `src/ui/panel.html` |
