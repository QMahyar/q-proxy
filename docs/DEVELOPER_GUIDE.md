# Q Proxy — Developer Guide v1.0.0

> User-facing deploy and panel docs: [USER_GUIDE.md](USER_GUIDE.md). Decisions: [../RATIONALE.md](../RATIONALE.md). Frozen contracts: [docs/ARCHITECTURE.md](../../../../../E:/Code/Q\ Proxy/docs/ARCHITECTURE.md) (copy verbatim).

## 1. Stack & Principles

| Concern | Choice | Evidence |
|---------|--------|----------|
| Runtime | Cloudflare Workers | `wrangler.toml:3` `compatibility_date = "2026-08-01"`; `cloudflare:sockets` TCP egress |
| Language | TypeScript strict (`ES2023`) | `tsconfig.json` (strict, `workers-types`) |
| Build | esbuild single-file `dist/q-proxy.js` | `scripts/build-single-file.mjs:10` — `format: esm`, `platform: browser`, `loader .html → text`, `define __APP_VERSION__` |
| Deps | Zero runtime deps | `package.json:13` devDeps only; build asserts no bare imports except `cloudflare:` (`build-single-file.mjs:26`) |
| Storage | KV only (`QPROXY_KV`) | `wrangler.toml:6`, `src/types/env.ts:2` — no D1/DO |
| Tests | vitest 2 projects | `vitest.config.ts:18` — `unit` (node) + `workers` (`@cloudflare/vitest-pool-workers`) |

Ground rules (`ARCHITECTURE.md §0`): compat `2026-08-01` forces `binaryType = "arraybuffer"` on every server socket; parsers never throw (`Result` convention); named exports only; no comments in impl — rationale lives here.

## 2. Getting Started

```bash
npm install          # devDeps: typescript, esbuild, vitest, wrangler, @cloudflare/workers-types
npm run typecheck    # tsc --noEmit — must pass per DoD
npm test             # vitest run — both projects, see §3
npm run dev          # wrangler dev → http://127.0.0.1:8787 (miniflare, KV in-memory)
npm run build        # esbuild → dist/q-proxy.js (dashboard-pasteable)
npm run deploy       # build + wrangler deploy
```

`vitest.config.ts:8` `html-as-text` plugin inlines `*.html` as strings so `src/ui/assets.ts:1` works in both projects.

## 3. Testing

### 3.1 Runner

`vitest.config.ts:17`:

```ts
projects: [
  { name: 'unit',    environment: 'node', include: ['test/**/*.spec.ts'], exclude: ['test/workers/**'] },
  { name: 'workers', include: ['test/workers/**/*.spec.ts'],
    miniflare: { compatibilityDate: '2026-08-01', kvNamespaces: ['QPROXY_KV'] } }
]
```

| Command | What runs |
|---------|-----------|
| `npm test` | Both projects (`vitest run`) |
| `npx vitest run --project=unit` | Pure logic — no workerd needed (`src/core/**` may not import `cloudflare:*`) |
| `npx vitest run --project=workers` | Real `fetch` through `src/worker.ts` with `fetchMock` for DoH/remote-subs |

Layout rule: specs mirror `src/` — `src/protocols/vless.ts` ⇔ `test/protocols/vless.spec.ts`, `src/handlers/api/settings.ts` ⇔ `test/workers/handlers/api/settings.spec.ts`.

### 3.2 Coverage Map

| Group | Project | Example |
|-------|---------|---------|
| Crypto (MD5, SHA-224, AES-CFB, HKDF, EVP_BytesToKey) | unit | RFC vectors in `test/crypto/*` |
| Protocol parsers (chunk-split `push()`, 16 KiB/10 s caps, reject paths) | unit | Synthetic frames per `docs/research/04-protocol-formats.md §3.2` |
| Share URIs + emitters (golden snapshots, gotchas #2,#7,#8,#12) | unit | `test/nodes/emitters/*.spec.ts` |
| Settings migrate/validate/seed, UA, proxyIP/NAT64, failover planner | unit | Mocked `fetch` for DoH/TXT |
| Router/auth/KV/sub/tunnel smoke (injectable `dialImpl`) | workers | `test/workers/core/router.spec.ts`, `test/workers/handlers/*` |

### 3.3 Testing Protocol Changes

Protocol work is highest-risk — validate against **Xray-core vectors**, not just unit synthetics:

1. Add/update unit spec with frame bytes from Xray `proxy/vless`, `proxy/vmess`, `proxy/trojan`, `proxy/shadowsocks` test fixtures (AEAD-only VMess, SIP002 SS).
2. Assert `reject` → WS `1008` (never leaks reason), `need-more` on split chunks, `ready.parsed` + correct `rest` and `responseHeader()`.
3. Add a `workers` smoke that upgrades via `WebSocketPair` with injectable `dialImpl` (sockets unavailable in pool — `src/tunnel/egress.ts:114` contract).
4. Run `npm run typecheck && npm test`; golden emitter snapshots must not drift without review.

## 4. Architecture

### 4.1 Request Lifecycle

```mermaid
flowchart TD
    A[Client Request] --> B{GET /robots.txt?}
    B -- yes --> R1[handlers/robots.ts<br/>Disallow: /]
    B -- no --> C{identifyTunnel?<br/>src/core/routes.ts:11}
    C -- "/{vl|vm|tr|ss}/ + suffix [A-Za-z0-9]{8,32}" --> D{WS Upgrade?}
    D -- no --> CAM[handlers/camouflage.ts<br/>fake 1101 HTML 500]
    D -- yes --> K{killSwitch?<br/>src/core/router.ts:202}
    K -- on --> S503[503 Service Unavailable]
    K -- off --> T[handlers/tunnel.ts<br/>tunnel/websocket.ts<br/>early-data b64url decode ≤2048]
    T --> P[protocols/createXInbound<br/>push → ready / reject→1008]
    P --> SP{speedtest host?}
    SP -- "speed|cp.cloudflare.com" --> SYN[synthetic 204]
    SP -- no --> E[egress.ts:makeFailoverStrategy]
    C -- no --> E2{resolveSecureRoute<br/>src/core/routes.ts:42}
    E2 -- "/{sp}/sub" --> SUB[handlers/subscribe.ts]
    E2 -- "/{sp}/doh" --> DOH[handlers/doh.ts]
    E2 -- "/{sp}/my-ip" --> MYIP[handlers/myip.ts<br/>requireAuth]
    E2 -- "/{sp}/api/*" --> API[dispatchApi<br/>auth guard + CSRF]
    E2 -- "/{sp}/panel|/login|root" --> PAGE[panel-page.ts<br/>ASSETS]
    E2 -- null --> CAM
    E2 -- auth alias 4-seg --> API
    SUB --> GEN[nodes/generate.ts → ProxyNode[]]
    GEN --> EMI[emitters/registry.ts<br/>EMITTERS format]
```

Route table precedence is top-down, first match wins — 28 entries defined in `ARCHITECTURE.md §3`, implemented in `src/core/router.ts:187` (`routeRequest`), with tunnel dispatch via `identifyTunnel` and secure dispatch via `resolveSecureRoute` + `resolveAuthAlias` (`router.ts:170`).

Auth: `q_session` HMAC cookie (`src/auth/session.ts`) + `X-Q-Panel: 1` CSRF on mutating APIs (`src/auth/guard.ts:assertCsrf`). Non-panel failures return camouflage, never 404.

### 4.2 Egress Failover Strategy

```mermaid
flowchart LR
    TGT[DialTarget<br/>host + port<br/>from ParsedRequest] --> B{isBlockedDirectHost?<br/>isLocalOrPrivateTarget<br/>isCloudflareIp}
    B -- blocked --> N1[omit direct]
    B -- ok --> D[direct candidate<br/>host:port]
    TGT --> C{chainProxy.enabled?}
    C -- yes, valid URI --> CH[chain candidate<br/>socks5 / http / https<br/>src/tunnel/chain]
    C -- no --> X1[skip chain]
    D --> P{proxyIpMode?}
    CH --> P
    N1 --> P
    X1 --> P
    P -- "proxyip" --> PX[expandProxyIps<br/>proxyIps: ip | host | host:port | host.tpNNN | TXT<br/>resolver DoH<br/>shuffleDeterministic seed=hashSeed target.host<br/>top 8<br/>src/tunnel/proxyip.ts]
    P -- "nat64" --> N6[resolveIpv4 via remoteDns<br/>synthesizeNat64Address per prefix<br/>src/tunnel/nat64.ts]
    PX --> L[candidates: chain? → direct? → proxyip×≤8 | nat64×N<br/>FailoverStrategy<br/>src/tunnel/egress.ts:89]
    N6 --> L
    L --> O[createEgressOpener<br/>dialImpl injectable<br/>src/tunnel/egress.ts:114]
    O --> A1[open: try 0..n<br/>write firstPacket<br/>on fail → next]
    A1 --> Z{remote closed<br/>zero downlink bytes?<br/>relay.ts hook}
    Z -- yes --> R[retry: lastSuccess+1..n<br/>swap socket mid-session]
    Z -- no --> DONE[relay WS ↔ TCP<br/>half-open semantics<br/>src/tunnel/relay.ts]
    R --> DONE
```

Implementation: `makeFailoverStrategy(settings, target)` (`egress.ts:41`) builds candidates; `createEgressOpener(strategy, dialImpl?)` (`egress.ts:114`) sequential-walks with `defaultDialImpl` (`egress.ts:92`) that writes `firstPacket` eagerly. Zero-byte retry is triggered by `relay.ts`, not `egress.ts` itself (`ARCHITECTURE.md §2.8`).

### 4.3 Emitter Pipeline

```mermaid
flowchart TD
    REQ[GET /{sp}/sub<br/>pickSubFormat: target param > classifyUA > base64<br/>src/subscription/negotiate.ts:6<br/>browser → info page] --> GEN[generateNodes ctx<br/>src/nodes/generate.ts<br/>protocols×addresses×ports×variants<br/>invariants: security↔port, fragment→TLS only, SS earlyData=0<br/>cap maxNodesPerFormat]

    GEN --> MERG{format base64?}
    MERG -- yes --> REM[merge.ts: fetchRemoteSubLines<br/>5s timeout, 1 MiB cap, b64 autodetect, dedupe]
    MERG -- no --> EMI
    REM --> EMI

    EMI[EMITTERS Record SubFormat → NodeEmitter<br/>src/nodes/emitters/registry.ts:17] --> B64[base64-list<br/>join URIs → padded b64]
    EMI --> CL[clash-yaml<br/>yaml-writer real YAML<br/>servername vs sni<br/>ws-opts max-early-data]
    EMI --> SB[singbox-json<br/>tun+mixed+DNS detour+urltest]
    EMI --> SU[surge-conf<br/>INI, no SS]
    EMI --> LO[loon-conf<br/>Proxy lines, no SS]

    B64 --> H[subscriptionHeaders<br/>Profile-Title<br/>Subscription-Userinfo upload=0 download≈requestsTotal×1MiB<br/>Profile-Update-Interval<br/>Content-Disposition attachment]
    CL --> H
    SB --> H
    SU --> H
    LO --> H
    H --> RESP[Response<br/>text/yaml | application/json | text/plain | text/html]
```

Per-format contracts in `ARCHITECTURE.md §2.5`; URI grammars in `src/nodes/share-uri.ts` (`buildVlessShareUri`/`buildVMessShareUri`/`buildTrojanShareUri`/`buildSSShareUri`); naming via `src/nodes/naming.ts`.

## 5. KV Schema

Namespace binding `QPROXY_KV` (`wrangler.toml:6`, `src/types/env.ts`).

| Key | Shape | Writer | TTL / Cache |
|-----|-------|--------|-------------|
| `qproxy:settings` | `{version:number, updatedAt:number, data:Settings}` | `src/settings/store.ts:saveSettings` | Isolate cache 15 s (`loadSettings`); `saveSettings` invalidates |
| `qproxy:meta` | `{createdAt:number, installedVersion:string}` | `src/settings/store.ts:ensureInitialized` (once) | — |
| `qproxy:counters` | `{day:"YYYY-MM-DD", requestsToday:number, requestsTotal:number, updatedAt:number}` | `src/core/counters.ts:recordConnection` | Buffered per-isolate; flush >60 s or every 32 conns; day rollover resets `requestsToday` |

No sessions, no logs, no per-node registry in KV — sessions are stateless HMAC cookies (`q_session` payload `{exp}` + `hex(hmac(payload, sessionSecret))`, 7-day, `ARCHITECTURE.md §3` envelope). Sensitive paths `SENSITIVE_SETTING_PATHS = ["passwordHash","passwordSalt","sessionSecret"]` (`src/types/settings.ts:154`) never leave `GET /{sp}/api/settings`.

### Migrations

`src/settings/migrate.ts:migrateSettings(raw)` — pure, no IO:

1. Non-object or missing `version` → `structuredClone(DEFAULT_SETTINGS)` + seed identity.
2. `version === SETTINGS_VERSION` → deep-merge stored `data` over clone of `DEFAULT_SETTINGS` (fills new keys).
3. `version < SETTINGS_VERSION` → apply `MIGRATIONS[v]` sequentially then rule 2.
4. `version > SETTINGS_VERSION` (downgrade) → rule 2, log warning.

Bump `SETTINGS_VERSION` and add one migration entry per settings shape change.

## 6. Adding a New Emitter

Example: adding a `quantumult` format (follows `ARCHITECTURE.md §2.5` + §9 ownership — requires arch approval for new file).

1. **Types:** extend `SubFormat` in `src/core/ua.ts:1` — `export type SubFormat = ... | "quantumult"`; add tokens to `classifyUA` if needed.
2. **Emitter:** create `src/nodes/emitters/quantumult-conf.ts` exporting `emitQuantumultConf(nodes, opts: EmitOptions): string` — obey `ARCHITECTURE.md §2.5` shape `(nodes: readonly ProxyNode[], opts: EmitOptions) => string`, use `opts.isFragment` to filter variant nodes, brackets for IPv6.
3. **Registry:** register in `src/nodes/emitters/registry.ts:17` — `quantumult: emitQuantumultConf`.
4. **Negotiation:** update `src/subscription/negotiate.ts:4` `FORMATS` and `src/core/ua.ts` sniff table; `?target=quantumult` must win per `negotiate.ts:8`.
5. **Tests:** add `test/nodes/emitters/quantumult-conf.spec.ts` with golden snapshot vs format grammar; add UA corpus case in `test/core/ua.spec.ts`; add `workers` sub test asserting correct `Content-Type` and `Content-Disposition: attachment`.
6. **Verify:** `npm run typecheck && npm test` — both projects green; no new runtime dep.

Keep the emitter pure — no KV, no `fetch`, no `cloudflare:*` imports (so it stays in the `unit` project).

## 7. Project Conventions

- **Error handling:** throw `AppError` subclasses (`src/core/errors.ts:34`) — `worker.ts` single boundary renders JSON envelope for `/api/*` else sanitized HTML (`expose` + `debugLogging` gate). Tunnel plane: `reject → ws.close(1008)`; infra → `1011`.
- **Early data:** `src/tunnel/websocket.ts` extracts `Sec-WebSocket-Protocol` b64url (≤ `earlyDataMaxBytes`), ignores it for SS; handshake buffer capped 16 KiB / 10 s.
- **Logging:** `src/core/log.ts` debug-gated, request-id structured; never logs deny-list material (passwords, hashes, UUIDs, session secrets, securePath free-text).
- **Camouflage:** `src/handlers/camouflage.ts` — identical 500 fake-1101 body for wrong path / unknown route / internal error; `GET /robots.txt` always `Disallow: /` (`src/handlers/robots.ts`, `src/core/router.ts:191`).

## 8. References

- Spec: `docs/SPEC.md` — 44 shipped features, NFRs, threat model
- Architecture: `docs/ARCHITECTURE.md` — frozen types (§2.2 `Settings`/`Fingerprint`/`FragmentSettings`), route table (§3), data flows (§4), KV (§5), build (§8)
- Research: `docs/research/01-bpb-panel.md` / `02-edgetunnel.md` / `03-nahan.md` / `04-protocol-formats.md`
- Deploy auth: Cloudflare Global API Key env vars (see `../README.md` Deploy B)

Next: read [../RATIONALE.md](../RATIONALE.md) for why these choices were made.

## 7.1 Protocol Internals (src/protocols/)

| File | Export | Semantics |
|------|--------|-----------|
| common.ts | ProtocolInbound<R>, PushOutcome, parseAddress | push(data) -> need-more / ready{parsed,rest} / reject; responseHeader() once |
| vless.ts | createVlessInbound(uuid) | Verifies 16-byte UUID; cmd 1 tcp, 2 udp (port 53 only -> DnsPacketRelay); rejects MUX cmd 3; header [ver, 0x00] |
| trojan.ts | createTrojanInbound(password) | First 56 bytes == lowercase hex SHA224(password) then CRLF; SOCKS-ish addr parse; cmd !=1 rejected |
| vmess-crypto.ts | auth-id + AEAD helpers | WebCrypto GCM, MD5 KDF chain (pure-JS md5.ts), time window +-120s |
| vmess.ts | createVmessInbound(uuid) | AEAD-only (alterId 0), legacy AES-CFB header decode, rejects non-AEAD |
| shadowsocks.ts | createSSInbound(method,password) | EVP_BytesToKey(MD5) master -> HKDF-SHA1 subkey "ss-subkey"; AEAD chunks <=0x3FFF; SOCKS5 target header; early data ignored |

Handshake bounded: 16 KiB accumulated + 10 s timeout -> WS close 1008. Reasons logged server-side only.

## 7.2 Settings Store (src/settings/)

- store.ts: loadSettings(env) with 15 s isolate cache; saveSettings deep-merges after validate; ensureInitialized seeds securePath + uuids + sessionSecret.
- seed.ts: randomHex(12) for securePath, randomUUID() for empty UUIDs, 24-char passwords (trojan charset limited per docs/ARCHITECTURE.md §2.2).
- validate.ts: full-schema validation -> fields map for 422 response.
- migrate.ts: pure stepwise migrations; see DEVELOPER_GUIDE §5.

## 7.3 Observability

- log.ts: debug-gated structured logging with request id; redaction deny-list (passwords, hashes, session secrets, UUIDs, securePath free-text) asserted in tests.
- counters.ts: readUsage / recordConnection with isolate-buffered KV flush; Subscription-Userinfo header estimate derived here.

## 9. Local Development Tips

- Copy wrangler.toml id from a real KV for dev; miniflare auto-creates in-memory KV if id is dummy.
- Test early data locally: client must send Sec-WebSocket-Protocol: base64url(firstFrame) and ed=2048 in URI. Decode capped 8 KB in tunnel/websocket.ts.
- Fragment testing: enable fragment.mode=low and request ?target=clash or singbox; verify fd-like len params appear only there.
- Use npm run typecheck before every commit — ARCHITECTURE.md §7 DoD requires both typecheck and test green.

## 10. Build Reproducibility

scripts/build-single-file.mjs:10 bundles src/worker.ts with esbuild (bundle:true, format:esm, platform:browser, target:es2023, minify, loader .html->text, define __APP_VERSION__). Post-build asserts no bare imports except cloudflare:* (line 26) and writes dist/q-proxy.js + banner. Same artifact for dashboard paste and wrangler deploy (docs/SPEC.md F-43/F-44 parity).

## 11. FAQ for Contributors

- Why no comments in impl? ARCHITECTURE.md §0.5: rationale lives in docs; impl stays auditable without annotation drift.
- Why no D1? Owner decision (docs/SPEC.md F-68); KV eventual consistency documented as throttle best-effort (F-35).
- Adding a route? Requires arch revision — update docs/ARCHITECTURE.md §3 + src/core/router.ts + tests; see §9 ownership waves.

## 12. Detailed File Ownership (ARCHITECTURE.md §9)

| Wave | Owner | Files | Delivers |
|------|-------|-------|----------|
| A | Scaffold | package.json, tsconfig, vitest.config.ts, wrangler.toml, types/*, core/routes, errors, respond, ua, counters, log, utils/* | Frozen types verbatim, compiling skeleton |
| B | Protocols | crypto/*, protocols/* | Four createXInbound per §2.7, RFC vectors |
| C | Tunnel | tunnel/*, handlers/tunnel, doh | End-to-end datapath, early-data, failover, chain |
| D | Subs | nodes/*, emitters/*, subscription/*, handlers/subscribe | generateNodes invariants, 5 emitters, negotiate/headers/merge |
| E | Glue | worker.ts, core/router.ts, settings/*, auth/*, handlers/api/*, myip, robots, camouflage | Live router 28 entries, KV store, auth, APIs |
| F | UI | ui/assets.ts, *.html | Self-contained SPA, QR, EN/FA |

Cross-imports only via frozen symbols. Adding a file outside ownership requires arch revision.

## 13. API Contract (frozen, consumed by ui/assets.ts)

Success envelope {ok:true,data:...}; failure {ok:false,error:{code,message},fields?}. Key endpoints:

- POST /{sp}/api/auth/login {password} -> {hasPassword:true} sets q_session
- POST /{sp}/api/auth/setup {newPassword} -> only while passwordHash===null
- GET /{sp}/api/settings -> PublicSettings + hasPassword (SENSITIVE paths stripped)
- PUT /{sp}/api/settings -> {saved:true} or 422 {fields:{path:msg}} requires X-Q-Panel:1 + auth
- POST /{sp}/api/settings/reset -> {saved:true}
- GET /{sp}/api/status -> {version, killSwitch, colo, language, hasPassword, usage:{requestsToday,requestsTotal}}
- POST /{sp}/api/killswitch {enabled} -> {killSwitch}
- GET /{sp}/api/suburls -> {urls:[{format,label,url}]}
- GET /{sp}/my-ip -> Accept: json -> {ip,colo,country,city,asn,cfEgressIp} else HTML

See ARCHITECTURE.md §3 table and src/core/router.ts:62 dispatchApi for method guards and OPTIONS -> 405.

## 14. Troubleshooting for Contributors

| Symptom | Cause | Fix |
|---------|-------|-----|
| Handler is not satisfied | Missing with_state / non-extractor arg / body not last | Use debug_handler; check RouteHandler signature src/types/context.ts |
| 404 vs 405 confusion | layer registered before routes | Use .route_layer vs .layer ordering per ARCHITECTURE arch |
| KV eventual consistency | Login throttle best-effort | Documented; no DO alternative per spec |
| WS early data missing | Header not base64url or >8KB | Cap earlyDataMaxBytes; verify Sec-WebSocket-Protocol extraction in tunnel/websocket.ts |
| Port mismatch in emitters | security/port pairing violated | Assert in generateNodes: security===tls iff port in tlsPorts |

## 15. Performance Notes

- Isolate cache 15 s for settings, buffered counters 60 s/32 — typical request <=1 KV read (NFR §3.7).
- Uplink coalesce + downlink batch in tunnel/relay.ts (grain 20-32 KB) — v2 will formalize coalescing (F-57).
- DoH resolver isolate cache 10 min for proxyIP TXT/A/AAAA expansion.

## 16. Request Examples (pure vs workers)

Unit (node) — proxyIP shuffle determinism:

```ts
import { hashSeed, shuffleDeterministic } from "../src/tunnel/proxyip";
const seed = hashSeed("example.com");
const out = shuffleDeterministic(["1.1.1.1","8.8.8.8"], seed);
// stable across isolates for same host
```

Workers — route smoke through src/worker.ts export:

```ts
import worker from "../src/worker";
const res = await worker.fetch(new Request("https://example.com/robots.txt"), { QPROXY_KV } as Env);
expect(res.status).toBe(200);
```

## 17. Verifying No Off-Target Writes

```bash
test ! -f "./README.md"  # sanity — docs live in the repo, not temp dirs
```


All output constrained to candidate-2 per task; no writes to E:\Code\Q Proxy.

## 18. Versioning

package.json:2 version -> __APP_VERSION__ (scripts/build-single-file.mjs:18 define). Displayed via GET /{sp}/api/status. SETTINGS_VERSION = 1 (src/types/settings.ts:1). Bump with migration entry per ARCHITECTURE.md §5.3.

## 19. Related Docs

- docs/SPEC.md §4.4 securePath semantics + §4.5 KV-window throttle + §4.6 storage split
- docs/ARCHITECTURE.md §4.1 WS end-to-end diagram (source for mermaid §4.1)
- docs/research/04-protocol-formats.md §1 URI grammars + §2 clashes

## 20. Checklist Before PR

- [ ] npm run typecheck passes (tsc --noEmit)
- [ ] npm test passes (unit + workers)
- [ ] No new runtime dependency added to package.json dependencies
- [ ] No bare import except cloudflare:* (build assertion)
- [ ] New file approved in ARCHITECTURE.md §9 ownership
- [ ] Sensitive paths not logged or returned via GET /api/settings
- [ ] Mermaid diagrams updated if routing/egress changed

## 21. Where to Read Next

- Start with src/core/router.ts:187 + src/core/routes.ts:11 + src/tunnel/egress.ts:41 — the three load-bearing modules.
- Then src/protocols/common.ts for inbound contract and src/nodes/emitters/registry.ts for subscription surface.
- Finally docs/SPEC.md §6 open questions (license, securePath sharing tradeoff, remote-sub depth, userinfo estimate, plain-port policy).
