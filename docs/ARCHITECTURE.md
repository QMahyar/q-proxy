# Q Proxy — Architecture v1.0 (FROZEN CONTRACT) + Rev 2026-08-26

> Single source of truth for parallel implementers. Everything marked **FROZEN** (types, signatures, route table, KV keys, API JSON shapes, file ownership) must be copied verbatim and only changes via an explicit architecture revision.
> **Rev 2026-09-04 wave2 amendments:** §2.2 Settings schema gains `echAuto: boolean` (default false; descriptor row + panel toggle + en/fa dicts); ECH server-name resolution is `resolveEchServerName(settings, sni)` in `src/settings/validate.ts` — ECH disabled ⇒ null; non-empty manual `echServerName` always wins (shape-validated at save in both modes); else `echAuto` on ⇒ domain-shaped SNI or null plus an English warning when unresolvable (panel shows a live effective-name preview; unresolvable nodes emit without ECH). Stored settings blob gains monotonic `rev` (default 0, invalid/missing treated as 0, migrate-safe); `saveSettings` bumps it via a fresh KV read and returns it; `PUT api/settings`, `POST api/settings/reset`, `POST api/settings/import` and `POST api/killswitch` success shapes gain `rev:number` (all four write paths keep merging from `loadSettingsFresh`, locked by regression specs; ETag format unchanged; residual race: two concurrent writers can both read rev N — KV read-modify-write is approximate across isolates). SSRF surface: `isLocalOrPrivateTarget` (`src/utils/net.ts`) additionally denies cloud-metadata IPv4 literals (169.254.169.254, 169.254.169.253, 100.100.100.200), metadata IPv6 (`fd00:ec2::254`/`::253`, bigint-compared so case/expansion/bracket/zone-id variants match), metadata hostnames (case-insensitive, trailing-dot tolerant) plus a generic `.internal` suffix rule; new `isBlockedEgressHost(host)` export combines local/private + metadata + Cloudflare-IP guards. Non-contract internals (no frozen-shape change): `dispatchApi`'s 21-case switch replaced by a declarative `API_ROUTES: Record<ApiRouteName, {methods, auth: none|read|write, handler}>` table with a 5-line dispatcher (method gate, then none⇒direct / read⇒authed / write⇒authed on GET else authedCsrf; CSRF-only logout/setup pre-wrapped via csrfOnly; empty methods[] means any-method; semantics preserved exactly, incl. HEAD taking the write path); sing-box emitter gains a `SingBoxOutbound` discriminated union plus shared `nodeHasTls/nodeHasEch/nodeHasEarlyData/nodeHasFingerprint/nodeHasAlpn` helpers in registry.ts (goldens byte-identical); DNS resolver cache switches FIFO→LRU (256-entry cap and 5-minute TTL unchanged; hits refresh recency via delete + re-insert); egress gains `TOTAL_DIAL_BUDGET_MS` (15 s, overridable via `EgressOpenerOptions.totalBudgetMs`) capping open()/retry() walks at ~15 s instead of N×10 s, plus `openEgressWithSpeculativeDirect` which starts synchronously-known prefix dials (chain + direct) before tail expansion finishes and reuses them in the opener (unconsumed late sockets closed); 3 new spec-only files (warp format goldens, subscription pipeline, relay failover) with no src changes.
> **Rev 2026-09-02 review-wave amendments:** §2.x `FailoverStrategy` loses `hasNext` (dead surface; opener loops iterate `candidates` directly). The 4-segment `/api/auth/*` alias (login/logout/setup/password) is matched inside `resolveSecureRoute`'s `api` case instead of a router-local alias resolver — same URLs, same handlers, single matcher. `POST /{sp}/api/auth/setup` now requires the `X-Q-Panel: 1` CSRF header (panel already sends it). VMess rejects unknown security types (7-15) and the plain+authenticated-length combination at handshake instead of raw-relaying the body; VMess fatal uplink decode errors (oversize buffer cap, AEAD failure, out-of-range size) now close the tunnel instead of hanging silently — 1011 via the TCP relay, 1008 in the UDP phase — same for SS, Trojan-UDP and VLESS-UDP codecs. VLESS cmd=2 (UDP/53) gains a body codec implementing Xray's `LengthPacketReader` framing (`2-byte BE length + datagram`, no address echo) — previously the framed datagram was forwarded raw to DoH and broken both directions. `EMITTERS` registry now covers the four sync formats only (`Record<Exclude<SubFormat,"base64">, NodeEmitter>`); base64 rendering (share-URI filter + remote merge) lives in `subscription/render.ts`. Per-user daily quota moved to per-hash KV keys `qproxy:user-usage:{yyyy-mm-dd}:{hash}` (legacy array key still read for same-day migration). Telegram `setWebhook` now registers `secret_token` and the webhook accepts the `X-Telegram-Bot-Api-Secret-Token` header as an alternative credential. Clash emitter ECH key corrected to `query-server-name`; Loon emitter emits `tls-name=` (official grammar) instead of `sni=`. `src/utils/hmac.ts` shared `hmacSha256Hex` replaces duplicated helpers in session.ts/telegram.ts. Chain proxies get an internal 10s handshake deadline that closes the raw socket (previously a hung handshake leaked the socket). `driveSession` closes the origin socket when the client disconnects mid-dial.
> **Rev 2026-08-24 amendments (post-audit):** §2.7 `ProtocolInbound` now includes `BodyCodec`/`DownlinkEncoder` + `bodyCodec()` (was frozen without); `killSwitch` gate lives in `core/router.ts:155` not `worker.ts`; `src/nodes/naming.ts` is fixed-format renderer not `{PROTO} {ADDR}` template engine; `/{sp}/api/settings/save` alias + 4-segment `/api/auth/*` alias are reachable (table addition); `/{sp}/my-ip` now requires auth (F-40). §2.5 amended after upstream research: Surge emits vmess+trojan only — VLESS is not a supported Surge proxy type per manual.nssurge.com — and prepends `#!MANAGED-CONFIG`; Loon emits vless+vmess+trojan using official nsloon.app grammar (`transport=` not `transporter=`, `over-tls=`, positional cipher/uuid/password, `udp=true`). **Efficiency pass (same rev):** §3 row 21 `GET /{sp}/api/bootstrap` added (settings+status+subUrls aggregate, ETag/304); `GET settings`/`bootstrap` serve `ETag: W/"<updatedAt>-<version>"` + `If-None-Match`; subscription responses `Cache-Control: public, max-age=60` + edge Cache API (was `no-store`); panel/login HTML `private, max-age=60` (was `no-store`); settings isolate cache 15s→60s + KV `cacheTtl:60` + write-through save with no-op skip; `/robots.txt` served without loading settings; counter usage reads memoized 15s. **WARP core (same rev):** §3 row 22 /{sp}/api/warp/{…} added; new KV keys qproxy:warp:account:{id} / qproxy:warp:token:{token} / qproxy:warp:presets / qproxy:warp:global; hand-rolled x25519 at src/crypto/x25519.ts (RFC 7748 vectors); parsers src/warp/config.ts (.conf + wg:// URI, ParseResult); registration client src/warp/api.ts (retry/backoff, cleanup on failure); store src/warp/store.ts (two-key write + rollback, sanitizeAccount strips private_key/warp_token). **User center (F4):** §3 rows 7c and 22b added; new KV keys `qproxy:users` (single JSON array of ≤50 {id,name,token:uuid,enabled,expiresAt,dailyReqLimit,protocols:'all'|[vless|vmess|trojan|ss],createdAt}) and `qproxy:user-usage:{yyyy-mm-dd}` ([{token,count}] per-day estimate, fire-and-forget RMW); admin API `/{sp}/api/users…` (session+CSRF on non-GET, sub-path dispatch in handlers/api/users.ts mirroring warp); public per-user subscription `/{sp}/sub/u/{token}/{target?}` in handlers/users-sub.ts reusing pickSubFormat/generateNodes/EMITTERS with per-user protocol filter (remote-sub merge intentionally skipped so filters hold), 410 disabled/expired, 429 over daily quota (+Retry-Until-midnight), edge-cached 60s keyed token+format+mode; unknown/bad-uuid tokens fall through to camouflage; tokens are the sub credential shown to admins only, never logged.
> **Rev 2026-08-25 amendments (F7 Telegram bot):** §3 rows 22c/22d added — public `POST /{sp}/telegram/webhook/{secret}` (secret = first 16 hex chars of HMAC-SHA256(key=sessionSecret, message="tg-webhook"), constant-time compared; disabled bot / secret mismatch / non-bound chat all answer `200 {"ok":true,"data":{}}` silently) and session+CSRF `POST /{sp}/telegram/{setup|remove}` proxying setWebhook/deleteWebhook to api.telegram.org (`{ok,description}`, token-shaped substrings scrubbed from description). Settings schema gained `telegram:{enabled:boolean,botToken:string,chatId:string}`; token shape `^\d+:[A-Za-z0-9_-]{35}$` enforced only while enabled; chatId numeric or `@name`, ≤64 chars. `telegram.botToken` is write-only sensitive state: stripped from `GET api/settings` (publicSettingsView), `api/settings/export`, and never logged; it is NOT added to `SENSITIVE_SETTING_PATHS` (that const drives top-level deletion only — nested key deleted explicitly). Handler `src/handlers/api/telegram.ts` exports `telegramWebhookSecret(sessionSecret)` for tests/reuse; commands `/status /sub /kill on|off /usage`, help otherwise; reply language = `settings.language`; replies sent via fire-and-forget `sendMessage` with 5s timeout. Panel Advanced section gains the Telegram card (enabled toggle, secret token field without generator, chatId, Set/Remove webhook buttons).
> **Rev 2026-08-26 wave1 amendments (P09 auth core):** §3 row 14b added — session+CSRF `POST /{sp}/api/auth/password` (`{currentPassword,newPassword}`, ≥8-char validation, loadSettingsFresh→saveSettings write, success data `{changed:true}`). Sessions gain an optional `iat` claim; `verifySession(cookie,secret,minIat)` rejects tokens with `iat <= minIat` (missing iat ⇒ 0). Revocation floor lives in KV `qproxy:min-iat` with a 60s isolate memo — helpers `getSessionFloor`/`bumpSessionFloor`/`clearSessionFloorCache` exported from src/auth/session.ts; enforcement wired at the router layer via a `withSessionFloor` wrapper composed into every requireAuth path (guard.ts untouched this wave). Change-password bumps the floor before responding and issues a fresh q_session cookie. Legacy-tier (15k PBKDF2) hashes are transparently re-hashed to 100k iterations on successful login (loadSettingsFresh→saveSettings; any failure logs debug and never blocks login). `POST /{sp}/api/auth/logout` now requires the `X-Q-Panel: 1` CSRF header only (no session required); the panel SPA's shared post helper already sends it.
>
> **Rev 2026-08-26 docs-sync (P16, wave1 consolidation):** §1 tree completed to match `src/`: crypto/{chacha20,shake128,x25519}.ts, utils/* incl. bounded.ts, warp/* subsystem {api, cache, config, expand, store, zip, formats/{conf,proxies,registry,singbox}}, users/store.ts, handlers/{users-sub,warp-sub}.ts, handlers/api/{bootstrap,telegram,users,version,warp}.ts; `naming.ts` tree comment corrected to fixed-format remark renderer per the 2026-08-24 amendment. §2.2 Settings block refreshed verbatim from src/types/settings.ts: added `CF_TLS_PORTS`/`CF_PLAIN_PORTS`, `echEnabled`/`echServerName`, `RoutingRules {bypassLan,blockAds,blockMalware,blockQuic,customBypass,customBlock}`, `TelegramSettings {enabled,botToken,chatId}`; `SENSITIVE_SETTING_PATHS = [passwordHash,passwordSalt,sessionSecret]`; `PublicSettings = Omit<Settings, …> & { telegram: Omit<TelegramSettings,"botToken"> }`. §2.4 NodeBase gained `ech: string | null`. §2.5 EmitOptions extended with optional `subscriptionUrl`, `updateIntervalHours`, `rules?: EmitRules {bypassLan,bypassDomains,blockDomains,blockQuic}`. §3 rows 15b/16b/17b/20b added (GET settings/export · PUT settings/save alias · POST settings/import · GET version/check) plus row 14c (4-segment `/api/auth/*` alias set incl. password); row 6 DoH cap corrected 10 MiB → 64 KiB (POST body enforced in handler); row 8 my-ip auth fixed to session; row 13 logout noted CSRF-header-only (no session required); rows 10/11 note HTML no-store/CSP headers; session payload documented as `{exp, iat?}` with revocation floor KV `qproxy:min-iat`. §6 error block refreshed verbatim from src/core/errors.ts (AppError 5th ctor param `headers`; ValidationError carries `.fields` into the envelope; RateLimitedError sets Retry-After via headers; UpstreamError used by warp/doh handlers). §7 workers-project examples corrected to files that exist: test/workers/router.spec.ts, test/workers/auth-flow.spec.ts, test/workers/tunnel/smoke.spec.ts.
>
> **Rev 2026-08-26 scope note:** The frozen §Scope line below predates the v1.1 feature-completion pass and is superseded as follows: "No WARP" no longer holds (W1–W3 added WARP accounts, presets, Amnezia and 17 WireGuard sub formats — rows 7b/22); "no user/quota system" no longer holds (F4 user center: ≤50 scoped subscribers with protocol filter/daily quota/expiry — rows 7c/22b, KV `qproxy:users`); a Telegram bot is wired (rows 22c/22d); settings export/import, ECH emission and routing-rule injection are in. The product remains **single-admin** (the admin manages users; there is no multi-admin/multi-tenant mode). Frozen §Scope body text left verbatim by design.
>
> Inputs: `docs/research/01-bpb-panel.md`, `02-edgetunnel.md`, `03-nahan.md`, `04-protocol-formats.md` (referenced as R1–R4).
>
> Scope: VLESS + VMess + Trojan + Shadowsocks over WebSocket (+ early data) on Cloudflare Workers. No WARP. No inbound gRPC/xhttp/REALITY (R4 §3.4). Single-tenant (one admin), no user/quota system.

## 0. Ground rules

1. **Zero runtime deps.** The worker bundle imports nothing from node_modules. Allowed: relative modules, `cloudflare:sockets`, WebCrypto globals, text-imported UI assets. All tooling (esbuild, vitest, typescript, wrangler, @cloudflare/workers-types) is devDependencies only.
2. **Compatibility date `2026-08-01`.** Consequences mandated everywhere:
   - WS binary messages arrive as **Blob** (`websocket_standard_binary_type` ≥ 2026-03-17): set `binaryType = "arraybuffer"` on every server socket before any handler runs.
   - Reciprocal close is automatic at compat ≥ 2026-04-07; relay uses half-open semantics deliberately when flushing (see `tunnel/relay.ts`).
3. **TCP egress** only via `import { connect } from "cloudflare:sockets"` inside request scope. Connections to Cloudflare IPs / localhost / private ranges throw → failover planner omits `direct` for such targets.
4. **Parsers never throw** (Result convention, §2.9). Only HTTP handlers convert failures into WS close codes or `AppError`s.
5. No comments in implementation code; this doc carries all rationale.
6. Named exports everywhere; default export only in `src/worker.ts`.

## 1. Directory tree

```
E:\Code\Q Proxy\
├── package.json                      # scripts + devDeps only; zero runtime deps
├── tsconfig.json                     # strict, ES2023, types: ["@cloudflare/workers-types"]
├── vitest.config.ts                  # projects: unit(node) + workers(vitest-pool-workers)
├── wrangler.toml                     # shape frozen in §8.3
├── .gitignore                        # dist/, node_modules/, .wrangler/
├── scripts\
│   └── build-single-file.mjs         # esbuild API -> dist/q-proxy.js (dashboard-pasteable)
├── docs\                             # research + ARCHITECTURE.md
├── dist\                             # build output (gitignored)
└── src\
    ├── worker.ts                     # entry: fetch export; kill-switch gate; counters hook; single error boundary
    ├── types\
    │   ├── global.d.ts               # __APP_VERSION__ global + '*.html' string module decl
    │   ├── env.ts                    # Env interface [FROZEN §2.1]
    │   ├── settings.ts               # Settings + DEFAULT_SETTINGS + SETTINGS_VERSION [FROZEN §2.2]
    │   ├── node.ts                   # ProxyNode discriminated union [FROZEN §2.4]
    │   ├── context.ts                # RouteHandler, NodeBuilderContext, UsageSnapshot [FROZEN §2.6]
    │   ├── tunnel.ts                 # DialTarget, FailoverStrategy, EgressOpener, DnsPacketRelay [FROZEN §2.8]
    │   └── warp.ts                   # WarpAccount, WarpPreset, AmneziaSettings [FROZEN via §3 row 22 shapes]
    ├── core\
    │   ├── routes.ts                 # identifyTunnel(), resolveSecureRoute(): pure path matchers
    │   ├── router.ts                 # ordered route-table dispatch (§3)
    │   ├── errors.ts                 # AppError hierarchy + expose rules (§6)
    │   ├── respond.ts                # jsonOk/jsonError/htmlResponse helpers; prod-safe serializer
    │   ├── ua.ts                     # SubFormat type + classifyUA(ua) browser-vs-client detection
    │   ├── counters.ts               # readUsage/recordConnection impl; isolate-buffered KV flush
    │   └── log.ts                    # debug-gated structured logging with request id
    ├── settings\
    │   ├── store.ts                  # loadSettings/saveSettings/ensureInitialized/invalidateSettingsCache (15s TTL cache)
    │   ├── seed.ts                   # first-run seeding of securePath/uuids/passwords/sessionSecret
    │   ├── migrate.ts                # migrateSettings(old): Settings + MIGRATIONS table (§5.3)
    │   └── validate.ts               # validateSettings(input): full-schema validation -> fields map
    ├── auth\
    │   ├── password.ts               # PBKDF2-SHA256 hash/verify of panel password
    │   ├── session.ts                # HMAC-signed cookie issue/verify (q_session)
    │   └── guard.ts                  # requireAuth(handler); CSRF custom-header check
    ├── crypto\
    │   ├── md5.ts                    # pure-JS MD5 (WebCrypto lacks MD5; VMess KDF + SS EVP_BytesToKey)
    │   ├── sha224.ts                 # pure-JS SHA-224 (WebCrypto lacks SHA-224; trojan auth hash)
    │   ├── aes.ts                    # AES-128 block cipher + CFB mode (VMess legacy header)
    │   ├── kdf.ts                    # EVP_BytesToKey, HKDF-SHA1 ss-subkey, VMess KDF/HMAC chains
    │   ├── x25519.ts                 # hand-rolled X25519 (RFC 7748) — WARP registration keypairs, zero-dep
    │   ├── chacha20.ts               # pure-JS ChaCha20-Poly1305 open/seal (VMess AEAD cipher)
    │   └── shake128.ts               # pure-JS SHAKE128 XOF (VMess KDF subkey derivation)
    ├── protocols\
    │   ├── common.ts                 # ProtocolInbound/PushOutcome/ParseResult contract [FROZEN §2.7]
    │   ├── vless.ts                  # createVlessInbound(uuid): frame parse + [ver,0] response header
    │   ├── trojan.ts                 # createTrojanInbound(password): sha224 hex + CRLF auth, SOCKS-ish request
    │   ├── vmess-crypto.ts           # auth-id gen/check, AEAD open/seal helpers (GCM via WebCrypto)
    │   ├── vmess.ts                  # createVmessInbound(uuid): AEAD-wrapped legacy AES-CFB header decode
    │   └── shadowsocks.ts            # createSSInbound(method,password): salt/subkey/frame AEAD stream
    ├── tunnel\
    │   ├── websocket.ts              # upgrade accept; early-data extract (sec-websocket-protocol b64url); binaryType fix
    │   ├── relay.ts                  # WS<->TCP pump: uplink coalesce, downlink batch, zero-byte retry hook, close semantics
    │   ├── egress.ts                 # makeFailoverStrategy() + createEgressOpener()
    │   ├── proxyip.ts                # pool expansion: ip | host | host:port | host.tpNNN | TXT records; deterministic shuffle
    │   ├── nat64.ts                  # ipv4 -> NAT64 IPv6 synthesis from prefixes; resolveIpv4 helper
    │   ├── resolver.ts               # DoH client (A/AAAA/TXT) w/ isolate cache; DnsPacketRelay impl (UDP53)
    │   ├── speedtest.ts              # host match (speed|cp.cloudflare.com) + synthetic "HTTP/1.1 204" byte response
    │   └── chain\
    │       ├── index.ts              # parseChainUri("socks5://u:p@h:p") -> ChainDescriptor; dispatch to client
    │       ├── socks5.ts             # SOCKS5 CONNECT client (RFC1928, optional RFC1929 auth)
    │       └── http-connect.ts       # HTTP CONNECT client (Basic auth optional)
    ├── nodes\
    │   ├── generate.ts               # generateNodes(ctx): ProxyNode[] cartesian expansion + caps + port/security consistency
    │   ├── naming.ts                 # fixed-format remark renderer (protocol/port/address-class flags; Rev 2026-08-24)
    │   ├── fragments.ts              # fragment presets low/medium/high/severe/custom + smart-sweep length list
    │   ├── share-uri.ts              # buildShareUri per protocol per R4 §1 grammars [FROZEN §2.5]
    │   └── emitters\
    │       ├── registry.ts           # EMITTERS: Record<Exclude<SubFormat,"base64">, NodeEmitter> [FROZEN §2.5, Rev 2026-09-02]
    │       ├── yaml-writer.ts        # dependency-free YAML serializer subset used by clash emitter
    │       ├── clash-yaml.ts         # emitClashYaml(nodes, opts) — real YAML, mihomo-complete
    │       ├── singbox-json.ts       # emitSingBoxJson(nodes, opts) — full tun profile
    │       ├── surge-conf.ts         # emitSurgeConf(nodes, opts)
    │       └── loon-conf.ts          # emitLoonConf(nodes, opts)
    ├── subscription\
    │   ├── negotiate.ts              # pickSubFormat(req): target= param > UA sniff > base64 fallback; SUB_FORMATS single source
    │   ├── headers.ts                # subscriptionHeaders(...): Profile-Title / Subscription-Userinfo / etc.
    │   └── merge.ts                  # fetchRemoteSubLines(urls): timeout/cap/base64-autodetect/dedupe
    ├── users\
    │   └── store.ts                  # per-user directory (≤50): token subs, protocol filter, daily quota, expiry (KV qproxy:users)
    ├── warp\
    │   ├── api.ts                    # WARP registration client: retry/backoff, cleanup on failure (x25519 keypairs)
    │   ├── cache.ts                  # edge-Cache purge helpers for WARP sub URLs (per-token / all tokens)
    │   ├── config.ts                 # .conf + wg:// URI parser -> ParseResult<WarpConfig>
    │   ├── expand.ts                 # WarpEmitContext resolution: account + preset + amnezia merge
    │   ├── store.ts                  # accounts/presets/amnezia store: two-key write + rollback, sanitizeAccount
    │   ├── zip.ts                    # dependency-free ZIP writer (crc32 + stored entries) for conf bundles
    │   └── formats\
    │       ├── registry.ts           # WARP_FORMATS/WARP_EMITTERS + content-type/extension maps (17 formats)
    │       ├── conf.ts               # wireguard-conf(-amnezia) zip, throne(-amnezia), wg:// URI, v2rayn emitters
    │       ├── proxies.ts            # clash(-amnezia), surge, surfboard, loon, egern emitters
    │       └── singbox.ts            # sing-box (+legacy/+amnezia) and xray emitters
    ├── utils\
    │   ├── base64.ts                 # tolerant std/urlsafe/padded base64 + b64url encode/decode
    │   ├── bytes.ts                  # concat/hex/u16be/u32BE/utf8 encode-decode helpers
    │   ├── net.ts                    # parseHostPort/isIPv4/isIPv6/isCloudflareIp/local-private guards
    │   ├── random.ts                 # randomHex/randomString/constantTimeEqual
    │   ├── time.ts                   # unixNow/dayKeyUtc helpers
    │   └── bounded.ts                # pruneBoundedRegistry — size-capped replay registries (SS salts, VMess auth-ids)
    ├── handlers\
    │   ├── tunnel.ts                 # WS entry /{vl|vm|tr|ss}/<suffix>: gate -> inbound -> opener -> relay
    │   ├── subscribe.ts              # sub endpoint: negotiate -> generate -> merge -> emit -> headers
    │   ├── users-sub.ts              # GET /{sp}/sub/u/{token}[/{target}]: per-user scoped sub (quota/expiry/filter)
    │   ├── warp-sub.ts               # GET+HEAD /{sp}/sub/wg/{token}/{format}: WARP config serving (17 formats)
    │   ├── doh.ts                    # ANY /{sp}/doh blind reverse proxy to settings.dohUpstream (64 KiB POST cap)
    │   ├── myip.ts                   # GET /{sp}/my-ip: JSON (Accept) or HTML; CF vs general egress comparison
    │   ├── robots.ts                 # GET /robots.txt -> "User-agent: * / Disallow: /"
    │   ├── panel-page.ts             # GET /{sp}/panel + /{sp}/login: serve ASSETS html strings
    │   ├── camouflage.ts             # unmatched-path fallback per settings.camouflage.mode
    │   └── api\
    │       ├── auth.ts               # POST login / logout / setup (first-run password) / password change
    │       ├── settings.ts           # GET redacted / PUT validated save / POST reset / export / import
    │       ├── status.ts             # GET status; POST killswitch; GET suburls
    │       ├── bootstrap.ts          # GET aggregate {settings,status,subUrls} with ETag/304
    │       ├── version.ts            # GET version/check against upstream releases
    │       ├── users.ts              # ANY user-center CRUD + token regeneration (≤50)
    │       ├── warp.ts               # ANY WARP accounts/presets/amnezia sub-dispatch
    │       └── telegram.ts           # webhook receiver + setup/remove proxy + telegramWebhookSecret()
    └── ui\
        ├── assets.ts                 # FROZEN ASSETS = { panel, login, camo } string consts [§2.10]
        ├── panel.html                # self-contained SPA (inline CSS+JS): all Settings forms, QR modal, EN/FA RTL
        ├── login.html                # login + first-run set-password page (EN/FA RTL)
        └── camo.html                 # default static camouflage page

test\                                 # mirrors src/ (naming rule §7)
```

One responsibility per file. New files require architecture approval because §9 ownership lists are exhaustive.

## 2. FROZEN core types

Copy these blocks verbatim into the owning files. No renames; no added fields without a revision.

### 2.1 Env → `src/types/env.ts` (owner A)

```ts
export interface Env {
  QPROXY_KV: KVNamespace;
}
```

KV binding name is exactly `QPROXY_KV` in wrangler.toml and all code. No env vars are required to boot (contrast R1 E.1 / R2 E1); everything lives in KV.

### 2.2 Settings + defaults → `src/types/settings.ts` (owner A)

```ts
export const SETTINGS_VERSION = 1;

export const CF_TLS_PORTS = [443, 2053, 2083, 2087, 2096, 8443] as const;
export const CF_PLAIN_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095] as const;

export type Language = "en" | "fa";
export type SsMethod = "aes-128-gcm" | "aes-256-gcm";
export type Fingerprint =
  | "chrome"
  | "firefox"
  | "safari"
  | "ios"
  | "android"
  | "edge"
  | "360"
  | "qq"
  | "random"
  | "randomized";
export type PlainPortPolicy = "always" | "workers-dev" | "never";
export type CamouflageMode = "off" | "static" | "proxy";
export type FragmentMode = "off" | "low" | "medium" | "high" | "severe" | "custom";

export interface FragmentSettings {
  mode: FragmentMode;
  packets: "tlshello" | "1-1" | "1-2" | "1-3" | "1-5";
  lengthMin: number;
  lengthMax: number;
  delayMin: number;
  delayMax: number;
  maxSplitMin: number;
  maxSplitMax: number;
}

export interface ChainProxySettings {
  enabled: boolean;
  uri: string;
}

export interface CamouflageSettings {
  mode: CamouflageMode;
  url: string;
}

export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface Settings {
  version: number;
  securePath: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  sessionSecret: string;
  language: Language;
  debugLogging: boolean;
  vlessEnabled: boolean;
  vmessEnabled: boolean;
  trojanEnabled: boolean;
  ssEnabled: boolean;
  vlessUuid: string;
  vmessUuid: string;
  trojanPassword: string;
  ssPassword: string;
  ssMethod: SsMethod;
  vlessPath: string;
  vmessPath: string;
  trojanPath: string;
  ssPath: string;
  earlyDataEnabled: boolean;
  earlyDataMaxBytes: number;
  hostnameOverride: string;
  customDomains: string[];
  cleanIps: string[];
  tlsPorts: number[];
  plainPorts: number[];
  plainPortPolicy: PlainPortPolicy;
  fingerprint: Fingerprint;
  randomizeSniCase: boolean;
  alpn: string[];
  echEnabled: boolean;
  echServerName: string;
  cdn: { enabled: boolean; addresses: string[]; host: string; sni: string };
  fragment: FragmentSettings;
  proxyIpMode: "proxyip" | "nat64";
  proxyIps: string[];
  nat64Prefixes: string[];
  chainProxy: ChainProxySettings;
  enableUdp53: boolean;
  dohUpstream: string;
  remoteDns: string;
  localDns: string;
  urlTestIntervalSec: number;
  profileTitle: string;
  subUpdateIntervalHours: number;
  maxNodesPerFormat: number;
  remoteSubUrls: string[];
  killSwitch: boolean;
  speedtestIntercept: boolean;
  camouflage: CamouflageSettings;
  routingRules: RoutingRules;
  telegram: TelegramSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  securePath: "",
  passwordHash: null,
  passwordSalt: null,
  sessionSecret: "",
  language: "fa",
  debugLogging: false,
  vlessEnabled: true,
  vmessEnabled: true,
  trojanEnabled: true,
  ssEnabled: true,
  vlessUuid: "",
  vmessUuid: "",
  trojanPassword: "",
  ssPassword: "",
  ssMethod: "aes-128-gcm",
  vlessPath: "vl",
  vmessPath: "vm",
  trojanPath: "tr",
  ssPath: "ss",
  earlyDataEnabled: true,
  earlyDataMaxBytes: 2048,
  hostnameOverride: "",
  customDomains: [],
  cleanIps: [],
  tlsPorts: [443, 2053, 2083, 2087, 2096, 8443],
  plainPorts: [80, 8080, 8880, 2052, 2082, 2086, 2095],
  plainPortPolicy: "workers-dev",
  fingerprint: "chrome",
  randomizeSniCase: true,
  alpn: ["http/1.1"],
  echEnabled: false,
  echServerName: "",
  cdn: { enabled: false, addresses: [], host: "", sni: "" },
  fragment: {
    mode: "off",
    packets: "tlshello",
    lengthMin: 100,
    lengthMax: 200,
    delayMin: 1,
    delayMax: 1,
    maxSplitMin: 2,
    maxSplitMax: 4,
  },
  proxyIpMode: "proxyip",
  proxyIps: [],
  nat64Prefixes: ["[2a02:898:146:64::]", "[2602:fc59:b0:64::]", "[2602:fc59:11:64::]"],
  chainProxy: { enabled: false, uri: "" },
  enableUdp53: true,
  dohUpstream: "https://cloudflare-dns.com/dns-query",
  remoteDns: "https://8.8.8.8/dns-query",
  localDns: "localhost",
  urlTestIntervalSec: 300,
  profileTitle: "Q Proxy",
  subUpdateIntervalHours: 12,
  maxNodesPerFormat: 500,
  remoteSubUrls: [],
  killSwitch: false,
  speedtestIntercept: true,
  camouflage: { mode: "static", url: "" },
  routingRules: { bypassLan: false, blockAds: false, blockMalware: false, blockQuic: false, customBypass: [], customBlock: [] },
  telegram: { enabled: false, botToken: "", chatId: "" },
};

export const SENSITIVE_SETTING_PATHS = ["passwordHash", "passwordSalt", "sessionSecret"] as const;

export type PublicSettings = Omit<Settings, (typeof SENSITIVE_SETTING_PATHS)[number]> & {
  telegram: Omit<TelegramSettings, "botToken">;
};

export interface RoutingRules {
  bypassLan: boolean;
  blockAds: boolean;
  blockMalware: boolean;
  blockQuic: boolean;
  customBypass: string[];
  customBlock: string[];
}
```

Field notes (binding this schema to scope):

- `securePath` gates panel/sub/api/doh/my-ip. Empty string = first run; `settings/seed.ts` generates `randomHex(12)`, fills empty uuids with `crypto.randomUUID()`, passwords with 24-char random from `[A-Za-z0-9]` (trojan restricted to charset `[A-Za-z0-9!@$&*_-+;:,.]`, R1 A.2), `sessionSecret` with `randomHex(64)`.
- Port matrices are the CF proxied sets (R4 §3.1). `plainPortPolicy`: plain-port nodes advertised only on workers.dev hostnames by default (`workers-dev`), or always/never.
- Fragment presets (R1 B.3): low=100–200/1–1, medium=50–100/1–5, high=10–20/10–20, severe=1–5/1–5 — applied by the UI writing into `fragment.*`; `mode:'off'` disables the fragment sub family.
- SS runs inside WS with v2ray-plugin framing on the client side (R2 A4); `ssMethod` limited to AES-GCM ciphers implementable with WebCrypto.
- `echEnabled`/`echServerName` gate ECH config emission on TLS nodes (empty `echServerName` ⇒ ECH field emitted as `null`).
- `routingRules` are injected at emit time into clash/sing-box rule sections (bypass-LAN, block ads/malware/QUIC, custom suffix lists); they never touch node generation.
- `telegram` is runtime state for the bot (F7); `botToken` is write-only sensitive state — stripped from every public view/export, never logged.
- `SENSITIVE_SETTING_PATHS` never leaves GET `/api/settings` and is never logged.

### 2.3 Sub formats → part of `src/core/ua.ts` (owner A)

```ts
export type SubFormat = 'base64' | 'clash' | 'singbox' | 'surge' | 'loon';

export declare function classifyUA(ua: string): SubFormat | 'browser';
```

Negotiation priority (R4 §2.1): `?target=` param wins → UA contains `clash|mihomo|stash` → `sing-box|singbox|sb|hiddify|nekobox|karing|sfa` → `surge` → `loon` → other known client UAs (`v2rayng`, `shadowrocket`, `happ`, …) → `base64`; browser UAs get an HTML info page instead of configs.

### 2.4 ProxyNode union → `src/types/node.ts` (owner A)

```ts
import type { Fingerprint, SsMethod } from './settings';

export type NodeVariant = 'normal' | 'fragment';

export type NodeTag =
  | 'workers-dev' | 'custom-domain' | 'clean-ip' | 'cdn'
  | 'fragment' | 'no-tls';

export interface NodeBase {
  name: string;
  address: string;
  port: number;
  security: 'tls' | 'none';
  sni: string | null;
  host: string;
  path: string;
  earlyData: number;
  fingerprint: Fingerprint | null;
  alpn: string[];
  ech: string | null;
  variant: NodeVariant;
  tags: NodeTag[];
}

export interface VlessNode extends NodeBase { kind: 'vless'; uuid: string; }

export interface VMessNode extends NodeBase {
  kind: 'vmess';
  uuid: string;
  cipher: 'auto' | 'none' | 'zero' | 'aes-128-gcm' | 'chacha20-poly1305';
  alterId: 0;
}

export interface TrojanNode extends NodeBase { kind: 'trojan'; password: string; }

export interface SSNode extends NodeBase {
  kind: 'ss';
  method: SsMethod;
  password: string;
}

export type ProxyNode = VlessNode | VMessNode | TrojanNode | SSNode;
```

Invariants enforced by `nodes/generate.ts`:

- `security==='tls'` ⇔ `port ∈ tlsPorts`; `security==='none'` ⇔ `port ∈ plainPorts` (mismatched combos fail, R4 gotcha #7).
- Fragment variant ⇒ `security:'tls'`, CDN addresses excluded (R1 B.3).
- IPv6 stored unbracketed in `address`; emitters add brackets where a format needs them.
- SS nodes always carry `earlyData: 0` (early data disabled for SS, R2 A4).

### 2.5 Share-URI builders & emitters → owner D (`nodes/share-uri.ts`, `nodes/emitters/*`)

```ts
import type { ProxyNode } from '../types/node';

export function buildShareUri(node: ProxyNode): string;
export function buildShareUris(nodes: readonly ProxyNode[]): string[];

export function buildVlessShareUri(node: import('../types/node').VlessNode): string;
export function buildVMessShareUri(node: import('../types/node').VMessNode): string;
export function buildTrojanShareUri(node: import('../types/node').TrojanNode): string;
export function buildSSShareUri(node: import('../types/node').SSNode): string;
```

```ts
import type { ProxyNode } from '../../types/node';
import type { SubFormat } from '../../core/ua';

export interface EmitRules {
  bypassLan: boolean;
  bypassDomains: string[];
  blockDomains: string[];
  blockQuic: boolean;
}

export interface EmitOptions {
  remoteDns: string;
  urlTestIntervalSec: number;
  isFragment: boolean;
  subscriptionUrl?: string;
  updateIntervalHours?: number;
  rules?: EmitRules;
}

export type NodeEmitter = (nodes: readonly ProxyNode[], opts: EmitOptions) => string;

export const EMITTERS: Record<Exclude<SubFormat, "base64">, NodeEmitter>;

export declare function emitClashYaml(nodes: readonly ProxyNode[], opts: EmitOptions): string;
export declare function emitSingBoxJson(nodes: readonly ProxyNode[], opts: EmitOptions): string;
export declare function emitSurgeConf(nodes: readonly ProxyNode[], opts: EmitOptions): string;
export declare function emitLoonConf(nodes: readonly ProxyNode[], opts: EmitOptions): string;
```

Emitter contracts:

- **base64**: `\n`-joined share URIs → standard padded base64; tolerate both alphabets when parsing merged remote subs (R4 gotcha #9).
- **clash**: real YAML via `yaml-writer` (fixes R1 G.10); mihomo schema per R4 §2.2: `servername:` for vless/vmess but `sni:` for trojan; `client-fingerprint` (uTLS) ≠ cert `fingerprint`; ws-opts carry `max-early-data` + `early-data-header-name: Sec-WebSocket-Protocol` consistent with `?ed=N` paths (gotcha #8); SS via `plugin: v2ray-plugin` + plugin-opts; ends with catch-all rule `MATCH,PROXY`.
- **singbox**: full profile per R4 §2.3: tun+mixed inbounds, DNS detouring PROXY, hijack-dns + private-direct + final rules, urltest group when >1 node; shadowsocks outbound uses built-in `plugin:"v2ray-plugin"` and has NO tls/transport objects.
- **surge**/**loon**: `[Proxy]` lines + select/url-test groups + minimal rules; **SS nodes omitted** (no v2ray-plugin support there — documented omission). Surge: vmess+trojan only (VLESS unsupported by Surge per manual.nssurge.com), `#!MANAGED-CONFIG` header prepended when served as subscription. Loon: vmess+vless+trojan, official nsloon.app grammar.
- Fragment-variant nodes included only when `opts.isFragment`.

URI grammar rules (R4 §1): percent-encode all param values; `encryption=none` explicit for vless; VMess = base64(JSON) `"v":"2"`, `aid:"0"`, port as string; SIP002 for SS with websafe-base64 userinfo (AEAD classic ciphers) and `plugin=v2ray-plugin;mode=websocket;host=…;path=…`; IPv6 hosts bracketed; no `flow` ever (ws only).

### 2.6 Handler & builder context → `src/types/context.ts` (owner A)

```ts
import type { Env } from './env';
import type { Settings } from './settings';

export type RouteHandler = (req: Request, env: Env, s: Settings) => Promise<Response>;

export interface NodeBuilderContext {
  settings: Settings;
  hostname: string;
  request: Request;
}

export interface UsageSnapshot {
  day: string;
  requestsToday: number;
  requestsTotal: number;
}
```

`hostname` resolution (implemented once in `core/routes.ts`): `hostnameOverride ?? primaryCustomDomain ?? request-hostname`. Dynamic path pieces resolve through `core/routes.ts` helpers, which is why `RouteHandler` carries no params argument.

### 2.7 Protocol inbound seam → `src/protocols/common.ts` (owner B)

This is the B→C boundary; C drives every protocol through it.

```ts
export interface DialTargetLite {
  host: string;
  port: number;
}

export interface ParsedRequest<C extends 'tcp' | 'udp'> {
  command: C;
  target: DialTargetLite;
}

export type PushOutcome<R> =
  | { state: 'need-more' }
  | { state: 'ready'; parsed: R; rest: Uint8Array }
  | { state: 'reject'; reason: string };

export interface ProtocolInbound<R> {
  push(data: Uint8Array): Promise<PushOutcome<R>>;
  responseHeader(): Uint8Array | null;
  takeInitialPayload(): Uint8Array | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export declare function parseAddress(
  atype: number,
  buf: Uint8Array,
  offset: number,
): ParseResult<{ host: string; port: number; nextOffset: number }>;

export declare function createVlessInbound(
  expectedUuid: string,
): ProtocolInbound<ParsedRequest<'tcp'> | ParsedRequest<'udp'>>;

export declare function createTrojanInbound(
  password: string,
): ProtocolInbound<ParsedRequest<'tcp'> | ParsedRequest<'udp'>>;

export declare function createVmessInbound(
  expectedUuid: string,
): ProtocolInbound<ParsedRequest<'tcp'> | ParsedRequest<'udp'>>;

export declare function createSSInbound(
  method: 'aes-128-gcm' | 'aes-256-gcm',
  password: string,
): ProtocolInbound<ParsedRequest<'tcp'> | ParsedRequest<'udp'>>;
```

Frozen semantics:

- Tunnel layer bounds each handshake at 16 KiB accumulated buffer and 10 s timeout; violation → WS close 1008.
- `reject` → WS close 1008; reason logged server-side only, never sent.
- Trojan auth: first 56 bytes equal lowercase-hex `SHA224(password)` then `\r\n` (R1 A.2, R2 A3).
- VLESS: cmd 1=tcp, cmd 2=udp allowed ONLY for destination port 53 → routed to `DnsPacketRelay`; any other UDP rejects. Response header `[version, 0x00]`.
- VMess: AEAD-only (alterId 0 era); legacy non-AEAD headers rejected; response uses AEAD-sealed legacy response format.
- SS: EVP_BytesToKey(MD5) master key → HKDF-SHA1 subkey info `"ss-subkey"`; `[len|tag][payload|tag]` AEAD chunks ≤ 0x3FFF; target header SOCKS5-style atype/addr/port; early-data header ignored entirely for SS.

### 2.8 Tunnel interfaces → `src/types/tunnel.ts` (owner A)

```ts
export interface DialTarget {
  host: string;
  port: number;
}

export type EgressVia = 'direct' | 'chain' | 'proxyip' | 'nat64';

export interface EgressCandidate {
  via: EgressVia;
  label: string;
  host: string;
  port: number;
}

export interface FailoverStrategy {
  readonly target: DialTarget;
  readonly candidates: readonly EgressCandidate[];
}

export interface EstablishedEgress {
  socket: Socket;
  via: EgressVia;
  candidateIndex: number;
}

export interface EgressOpener {
  open(target: DialTarget, firstPacket: Uint8Array | null): Promise<EstablishedEgress>;
  retry(target: DialTarget, firstPacket: Uint8Array | null): Promise<EstablishedEgress | null>;
}

export type DnsPacketRelay = (rawDnsPacket: Uint8Array) => Promise<Uint8Array | null>;
```

(`Socket` = the `cloudflare:sockets` socket type re-exported by `@cloudflare/workers-types`.)

Implementation contract (`tunnel/egress.ts`, owner C):

- `makeFailoverStrategy(settings, target): Promise<FailoverStrategy>` — candidate order: `chain` (only when `chainProxy.enabled`) → `direct` → proxyIP pool expansion (entries may be literal IP, `host`, `host:port`, `host.tpNNN` port suffix, or domain whose TXT records carry bulk lists; deterministic shuffle seeded by target host so egress sticks per destination; top 8 kept, R2 C3) or NAT64 candidates (resolve IPv4, synthesize per prefix, R1 B.6). Targets that are Cloudflare IPs/private/localhost omit `direct`.
- `createEgressOpener(strategy, dialImpl?): EgressOpener` — attempt = `connect(host,port)` → write `firstPacket` → resolve; sequential walk on failure. `dialImpl` injectable for tests.
- Zero-byte failover lives in `relay.ts`: if the remote closed having delivered zero downlink bytes, call `opener.retry()` and swap sockets mid-session (R1 A.3 + R2 B5).
- `resolver.ts` exports `createDnsPacketRelay(dohUrl): DnsPacketRelay` — wraps raw DNS packet as DoH POST (`application/dns-message`), returns response packet or null.

### 2.9 Result convention (global)

Pure functions return `{ok:true,value}` / `{ok:false,reason}`. Only HTTP-layer handlers throw `AppError`s (§6). Nothing throws across a WebSocket boundary.

### 2.10 UI assets → `src/ui/assets.ts` (owner F)

```ts
import camoHtml from './camo.html';
import loginHtml from './login.html';
import panelHtml from './panel.html';

export const ASSETS = {
  panel: panelHtml,
  login: loginHtml,
  camo: camoHtml,
} as const;

export type AssetName = keyof typeof ASSETS;
```

Each `.html` file is fully self-contained (CSS+JS inline, QR encoder embedded, EN/FA i18n dictionary embedded, RTL toggle via `dir="rtl"`). `src/types/global.d.ts` declares:

```ts
declare module '*.html' {
  const content: string;
  export default content;
}

declare const __APP_VERSION__: string;
```

## 3. Request routing table

Precedence top-down; first match wins. `{sp}` = `settings.securePath`. Tunnel prefixes = configured `vlessPath`/`vmessPath`/`trojanPath`/`ssPath`.

| # | Method | Pattern | Handler file | Auth | Notes |
|---|--------|---------|--------------|------|-------|
| 1 | GET | `/robots.txt` | `handlers/robots.ts` | none | always served |
| 2 | GET+Upgrade | `/{vlessPath}/<suffix>` | `handlers/tunnel.ts` | protocol cred | kill switch ⇒ 503 before upgrade |
| 3 | GET+Upgrade | `/{vmessPath}/<suffix>` | `handlers/tunnel.ts` | protocol cred | |
| 4 | GET+Upgrade | `/{trojanPath}/<suffix>` | `handlers/tunnel.ts` | protocol cred | |
| 5 | GET+Upgrade | `/{ssPath}/<suffix>` | `handlers/tunnel.ts` | SS cred | early-data header ignored (SS rule) |
| 6 | ANY | `/{sp}/doh` | `handlers/doh.ts` | sp is secret | blind DoH reverse proxy; POST body capped at 64 KiB (enforced in handler) |
| 7 | GET | /{sp}/sub | handlers/subscribe.ts | sp is secret | ?target= overrides UA sniff |
| 7b | GET+HEAD | /{sp}/sub/wg/{token}/{format} | handlers/warp-sub.ts | token is the secret | WARP subscription; 17 formats via warp/formats/registry.ts; edge-cached 60s, purged on account/preset/amnezia changes (Rev 2026-08-24: W2) |
| 7c | GET+HEAD | /{sp}/sub/u/{token}/{target?} | handlers/users-sub.ts | token is the secret | Per-user subscription (F4); UA/?target/path-target negotiation, nodes filtered by user protocols; 410 when disabled/expired, 429 + Retry-After over daily quota; `?view=html` info page; edge-cached 60s keyed token+format+mode; unknown/bad-uuid token → camouflage (#23) |
| 8 | GET | `/{sp}/my-ip` | `handlers/myip.ts` | session | Accept: application/json → JSON else HTML; no-store |
| 9 | GET | `/{sp}` (exact) | router inline | none | 302 → `/{sp}/panel` |
| 10 | GET | `/{sp}/panel` | `handlers/panel-page.ts` | page public | ASSETS.panel; SPA redirects on 401; no-store + panel CSP override (`connect-src 'self' https:`) |
| 11 | GET | `/{sp}/login` | `handlers/panel-page.ts` | none | ASSETS.login; no-store (base CSP from respond.ts) |
| 12 | POST | `/{sp}/api/auth/login` | `handlers/api/auth.ts` | none | `{password}` → sets `q_session` cookie |
| 13 | POST | `/{sp}/api/auth/logout` | `handlers/api/auth.ts` | CSRF header only | clears cookie; requires `X-Q-Panel: 1` but NO session (Rev 2026-08-26 wave1) |
| 14 | POST | `/{sp}/api/auth/setup` | `handlers/api/auth.ts` | none | ONLY while `passwordHash===null`; `{newPassword}` |
| 14b | POST | /{sp}/api/auth/password | handlers/api/auth.ts | session+CSRF | change admin password `{currentPassword,newPassword≥8}`; wrong current → 401; TOCTOU-safe loadSettingsFresh→saveSettings write; bumps session revocation floor KV `qproxy:min-iat` (60s isolate memo) before responding so all earlier sessions die; issues a fresh q_session cookie (Rev 2026-08-26 wave1) |
| 14c | POST | `/{sp}/api/auth/{login\|logout\|setup\|password}` | alias via `core/routes.ts:resolveSecureRoute` api case | as rows 12–14b | 4-segment alias set resolving to the same handlers (Rev 2026-08-24; matcher folded into resolveSecureRoute Rev 2026-09-02) |
| 15 | GET | `/{sp}/api/settings` | `handlers/api/settings.ts` | session | PublicSettings view |
| 15b | GET | `/{sp}/api/settings/export` | `handlers/api/settings.ts` | session | secrets-stripped settings JSON download |
| 16 | PUT | `/{sp}/api/settings` | `handlers/api/settings.ts` | session+CSRF | deep-merge validate save |
| 16b | PUT | `/{sp}/api/settings/save` | `handlers/api/settings.ts` | session+CSRF | alias of row 16 (Rev 2026-08-24) |
| 17 | POST | `/{sp}/api/settings/reset` | `handlers/api/settings.ts` | session+CSRF | defaults, keep identity fields |
| 17b | POST | `/{sp}/api/settings/import` | `handlers/api/settings.ts` | session+CSRF | restore an exported settings blob; version-checked |
| 18 | GET | `/{sp}/api/status` | `handlers/api/status.ts` | session | version/colo/killSwitch/usage |
| 19 | POST | `/{sp}/api/killswitch` | `handlers/api/status.ts` | session+CSRF | `{enabled:boolean}` |
| 20 | GET | `/{sp}/api/suburls` | `handlers/api/status.ts` | session | sub URLs per format for QR/copy |
| 20b | GET | `/{sp}/api/version/check` | `handlers/api/version.ts` | session | check deployed version against upstream releases |
| 21 | GET | `/{sp}/api/bootstrap` | `handlers/api/bootstrap.ts` | session | aggregate: `{settings,status,subUrls}` + ETag/304 (Rev 2026-08-24: panel boot coalescing) |
| 22 | ANY | `/{sp}/api/warp/{…}` | `handlers/api/warp.ts` | session (+CSRF on non-GET) | WARP accounts/presets/amnezia; sub-path dispatch in handler: `account` GET list · `account/generate` POST · `account/import` POST · `account/{uuid}` GET/PUT/DELETE · `account/{uuid}/regenerate-token` POST · `presets` GET/POST · `presets/{id}` PUT/DELETE · `settings/amnezia` GET/PUT (Rev 2026-08-24: W1) |
| 22b | ANY | `/{sp}/api/users/{…}` | `handlers/api/users.ts` | session (+CSRF on non-GET) | User center (F4); sub-path dispatch in handler: `` (empty) GET list (`{users}`, each + `todayHits`) · POST create `{name,protocols?,dailyReqLimit?,expiresAt?}` → `{user}` · `{id}` PUT partial (same fields + `enabled`) · `{id}` DELETE → `{deleted:true}` · `{id}/regenerate-token` POST → `{token}`; ≤50 users; unknown id → 404 |
| 22c | POST | `/{sp}/telegram/webhook/{secret}` | `handlers/api/telegram.ts` | secret is the auth | Telegram bot updates (F7); secret = HMAC-SHA256(sessionSecret,"tg-webhook") first 16 hex; disabled/mismatch/unbound chat → `200 {}` silent; commands `/status /sub /kill on|off /usage`, else help; EN/FA per settings.language; replies fire-and-forget |
| 22d | POST | `/{sp}/telegram/setup` · `/{sp}/telegram/remove` | `handlers/api/telegram.ts` | session+CSRF | setWebhook/deleteWebhook proxy to api.telegram.org → `{ok,description}` sanitized (token substrings scrubbed); setup URL = `https://{host}/{sp}/telegram/webhook/{secret}` |
| 23 | ANY | everything else | `handlers/camouflage.ts` | none | off→404, static→ASSETS.camo, proxy→reverse-proxy |

Rules:

- Secure path matches as exact case-sensitive segment. Tunnel `<suffix>` must be `[A-Za-z0-9]{8,32}` — enforced (fixes R1 G.5 where suffix was cosmetic).
- Non-upgrade requests hitting tunnel paths fall through to camouflage (#21).
- No CORS headers anywhere (same-origin panel). OPTIONS on `/api/*` → 405.
- Kill switch checked once in `core/router.ts` (`routeRequest`, before any WebSocket upgrade), applies to routes 2–5 only.
- Route matching helpers live in `core/routes.ts`: `identifyTunnel(pathname, s): 'vless'|'vmess'|'trojan'|'ss'|null` and `resolveSecureRoute(url, s): SecureRoute|null`. Handlers re-call these to learn which route they serve (compensates for the fixed `RouteHandler` signature).

### Frozen API JSON contract (consumed by F, implemented by E)

Envelope: success `{"ok":true,"data":…}`; failure `{"ok":false,"error":{"code":"…","message":"…"},"fields"?}` + HTTP status.

| Endpoint | Success data shape |
|---|---|
| `POST api/auth/login` | `{hasPassword:true}` |
| `POST api/auth/setup` | `{hasPassword:true}` |
| `GET api/settings` | PublicSettings + `{hasPassword:boolean}` |
| `PUT api/settings` | `{saved:true}`; validation failure → 422 with `fields:{[dottedPath]:msg}` |
| `POST api/settings/reset` | `{saved:true}` |
| `GET api/status` | `{version:string, killSwitch:boolean, colo:string\|null, language:Language, hasPassword:boolean, usage:{requestsToday:number, requestsTotal:number}}` |
| `POST api/killswitch` | `{killSwitch:boolean}` |
| `GET api/suburls` | `{urls:[{format:SubFormat, label:string, url:string}]}` |
| `GET my-ip` (JSON mode) | `{ip, colo, country, city, asn, cfEgressIp}` |

Session cookie: `q_session=<b64url(payload)>.<hex-hmac-sha256(payload, sessionSecret)>`, payload `{"exp":epochSeconds,"iat":epochSeconds}` (`iat` present on all newly issued cookies; missing ⇒ treated as 0), 7-day expiry, attrs `HttpOnly; Secure; SameSite=Lax`. Revocation floor KV `qproxy:min-iat` — sessions with `iat < floor` are rejected at the router layer (`withSessionFloor`). Mutating APIs additionally require header `X-Q-Panel: 1` (CSRF). Login rate limit best-effort per-isolate: >5 failures/min → 429.

## 4. Data flow diagrams

### 4.1 Inbound WS traffic end-to-end

```
 client (v2rayNG/sing-box…)        CF edge :443/:80              Q Proxy Worker
    │ TCP+TLS SNI=worker.host          │                              │
    │ GET /{vl|vm|tr|ss}/<suffix>      │                              │
    │ Upgrade: websocket               │                              │
    │ Sec-WebSocket-Protocol:<b64url(frame)> ← early data (≤ ed=N)   │
    ├──────────────────────────────────►│─────────────────────────────►│ worker.ts → core/router.ts routeRequest
    │                                   │                              │  tunnel+WS upgrade? killSwitch → 503 (pre-upgrade)
    │                                   │        WebSocketPair         │  handlers/tunnel.ts (C)
    │                                   │◄────── server side ──────────┤  tunnel/websocket.ts:
    │                                   │                              │   binaryType="arraybuffer"; accept()
    │                                   │                              │   early = b64url-decode(subprotocol hdr)
    │                                   │                              │  protocols/<p>: createXInbound() (B)
    │                                   │                              │   push(early); push(chunks)…
    │                                   │                              │   → ready{command,target,rest} | reject→close(1008)
    │                                   │                              │  speedtest.ts: target ∈ {speed,cp}.cloudflare.com?
    │                                   │                              │   yes → write "HTTP/1.1 204 …" into tunnel → close
    │                                   │                              │  egress.ts (C): strategy = makeFailoverStrategy(s,target)
    │                                   │                              │   candidates [chain?]→[direct]→[proxyip×8 | nat64×N]
    │                                   │ connect(host:port)+write(rest)│
    │                                   │◄═══════ raw TCP ═════════════┤ opener.open()
    │ ◄══ WS binary ══ relay.ts pump ══ socket.readable ───────────────┤  (+ responseHeader() once)
    │ ══ WS frames ► uplink coalesce ► socket.writable ───────────────►│
    │                                   │                    remote closed, ZERO downlink bytes?
    │                                   │                      → opener.retry() next candidate, swap sockets
    │                                   │  cmd=udp (port 53 only) → resolver.DnsPacketRelay (DoH POST)
```

### 4.2 Subscription request end-to-end

```
 client app / browser
   │ GET /{sp}/sub[?target=clash]     UA: "clash-verge/v2…" etc.
   ▼
 handlers/subscribe.ts (D)
   ├ negotiate.ts pickSubFormat(req)   target= > UA sniff > base64; browser UA → HTML info page
   ├ nodes/generate.ts generateNodes({settings,hostname,request})
   │    axes: protocols(enabled) × addresses(host + cleanIps + cdn?) × ports(family⇄security consistent) × variants(normal[,fragment])
   │    → ProxyNode[] capped at settings.maxNodesPerFormat
   ├ [format==='base64'] merge.ts fetchRemoteSubLines(settings.remoteSubUrls)
   │    timeout 5s each, 1 MiB total cap, b64/plain autodetect, dedupe by URI, failures skipped silently
   ├ emitters/registry.ts EMITTERS[format](nodes,{remoteDns,urlTestIntervalSec,isFragment:false})
   ├ headers.ts subscriptionHeaders(...)
   │    Profile-Title(base64:) · Subscription-Userinfo(upload=0; download=<estimate>) · Profile-Update-Interval
   │    profile-web-page-url · Content-Disposition attachment (non-browser UAs) · Cache-Control: no-store
   ▼
 Response text/yaml | application/json | text/plain(b64) | text/html(info page)
```

Note: the browser-facing subscription info page is a small HTML string produced inside `subscription/negotiate.ts`'s sibling `headers.ts` module family (owner D), bilingual EN/FA using its own embedded dictionary — it does not import `ui/assets.ts` (keeps D independent of F).

### 4.3 Settings save flow

```
 Panel SPA (F)                             Worker (E)
   │ PUT /{sp}/api/settings                   │
   │ X-Q-Panel: 1 ; Cookie: q_session         │
   ├─────────────────────────────────────────►│ auth/guard.ts: verifyHMAC + exp + CSRF header
   │                                          │ handlers/api/settings.ts:
   │                                          │   json parse → validateSettings(input)
   │                                          │     invalid → 422 {error.code:'VALIDATION', fields}
   │                                          │   store.saveSettings(env, deepMerge(current,input))
   │                                          │     ├ stamp version=SETTINGS_VERSION, updatedAt=now
   │                                          │     ├ KV put qproxy:settings (final JSON)
   │                                          │     └ invalidate isolate cache
   │◄─────────────────────────────────────────┤ {"ok":true,"data":{"saved":true}}
   │                                          │
   │ any later read loadSettings(env):        │ cache miss → KV get → migrateSettings(raw):
   │                                          │   stepwise MIGRATIONS if version drift → merge DEFAULTS → cache(15s TTL)
```

## 5. KV schema (namespace binding `QPROXY_KV`)

### 5.1 Keys

| Key | Value shape (JSON) | Writer |
|---|---|---|
| `qproxy:settings` | `{version:number, updatedAt:number, data:Settings}` | `settings/store.ts` |
| `qproxy:counters` | `{day:'YYYY-MM-DD', requestsToday:number, requestsTotal:number, updatedAt:number}` | `core/counters.ts` |
| `qproxy:meta` | `{createdAt:number, installedVersion:string}` | `store.ensureInitialized()` once |

No sessions, no logs, no per-node registry in KV — sessions are stateless HMAC cookies (deliberate contrast to nahan's single-blob D1 store, R3 F).

### 5.2 Isolate caching

- `loadSettings(env)` caches decoded Settings module-globally, 15 s TTL; `saveSettings` puts then invalidates immediately.
- Counters buffer increments per-isolate and flush when stale (>60 s since `updatedAt`) or every 32 connections; day rollover resets `requestsToday`.
- `Subscription-Userinfo` estimate: `download = requestsTotal × 1 MiB` (documented estimate; no CF API token required).

### 5.3 Migration contract → `src/settings/migrate.ts` (owner E)

```ts
export function migrateSettings(raw: unknown): Settings;
```

Frozen behavior:

1. `raw` not an object or `version` missing/non-finite → return fresh `structuredClone(DEFAULT_SETTINGS)` (caller `ensureInitialized` seeds identity fields afterwards).
2. `version === SETTINGS_VERSION` → deep-merge stored data OVER a `DEFAULT_SETTINGS` clone (fills keys introduced by later deploys of older data? inverse: fills keys missing in old blobs), stamp version, return.
3. `version < SETTINGS_VERSION` → apply `MIGRATIONS[v]: (data:any)=>any` sequentially v→current, then rule 2. Table starts empty at v1; every future settings change bumps `SETTINGS_VERSION` and adds exactly one migration entry.
4. `version > SETTINGS_VERSION` (downgraded deploy) → treat unknown keys as opaque, apply rule 2, log warning.

Pure function, no IO — unit tests pin every historical shape.

## 6. Error handling conventions

`src/core/errors.ts` (owner A):

```ts
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly expose: boolean = true,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "bad request") {
    super(message, 400, "BAD_REQUEST");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>, message = "validation failed") {
    super(message, 422, "VALIDATION");
    this.fields = fields;
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds?: number, message = "too many attempts") {
    const headers: Record<string, string> = {};
    if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(Math.max(1, retryAfterSeconds));
    super(message, 429, "RATE_LIMITED", true, headers);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(message, 502, "UPSTREAM", false);
  }
}
```

Usage notes:

- `AppError` takes an optional 5th ctor param `headers` — merged into the response by `respond.ts:errorToResponse` (drives e.g. `Retry-After`).
- `ValidationError` carries `.fields`, which `errorToResponse` copies into the JSON envelope (`fields` key).
- `RateLimitedError(retryAfterSeconds?)` sets `Retry-After` through those headers.
- `UpstreamError` (502, never exposes message) is the convention for upstream fetch failures — used by `handlers/doh.ts` and `handlers/api/warp.ts`.

Conventions (frozen):

1. Handlers may throw; `worker.ts` owns the single catch-all boundary.
2. Rendering is path-based: `/api/*` or `Accept: application/json` → JSON envelope `{ok:false,error:{code,message},fields?}`; everything else → generic HTML error page that never embeds `error.message` unless `expose===true && settings.debugLogging===true`.
3. Internal detail (`stack`, upstream URLs, KV errors) goes to `log.error` only.
4. Tunnel plane has no HTTP errors: parse/auth rejects → `ws.close(1008)`; infra failure → `ws.close(1011)`; reasons logged locally.
5. Best-effort features (remote subs, geo enrichment, camouflage proxy) degrade silently — never fail the parent response.
6. All responses are constructed through `respond.ts` so envelope/content-type can't drift.

## 7. Testing architecture

Runner: **vitest**, two projects in `vitest.config.ts` (owner A):

```ts
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.spec.ts'],
          exclude: ['test/workers/**'],
        },
      },
      {
        test: {
          name: 'workers',
          include: ['test/workers/**/*.spec.ts'],
        },
        miniflare: {
          compatibilityDate: '2026-08-01',
          kvNamespaces: ['QPROXY_KV'],
        },
      },
    ],
  },
});
```

Layout rule (frozen): specs mirror `src/`, one spec file per module.

- `test/<mirror-path>/<name>.spec.ts` → **unit** project (pure functions, no worker runtime). Example: `src/protocols/vless.ts` ⇔ `test/protocols/vless.spec.ts`.
- `test/workers/<mirror-path>/<name>.spec.ts` → **workers** project (`@cloudflare/vitest-pool-workers`). Examples: `test/workers/router.spec.ts` (route dispatch, kill-switch gate, auth guards), `test/workers/auth-flow.spec.ts` (login/logout/setup/change-password flow via real fetch), `test/workers/tunnel/smoke.spec.ts` (WS-pair handshake to the point of egress attempt with injected `dialImpl`).

Group assignments:

| Test group | Project | What is covered |
|---|---|---|
| crypto primitives | unit | RFC vectors: MD5, SHA-224, AES-128-CFB, HKDF/EVP_BytesToKey |
| protocol parsers | unit | synthetic frames per R4 §3.2; reject cases; chunk-splitting across `push()` calls |
| share URIs + emitters | unit | golden snapshots vs R4 §1/§2 grammars; gotchas #2,#3,#7,#8,#12 asserted explicitly |
| settings migrate/validate/seed | unit | version drift matrix; sensitive-key stripping |
| UA negotiation | unit | R4 §2.1 priority table |
| proxyIP/NAT64 planning | unit | TXT/A expansion with mocked `fetch`; deterministic shuffle seeds; NAT64 synthesis |
| failover planner | unit | candidate ordering incl. CF/private-target direct omission |
| router/auth/API/KV/sub endpoints | workers | real Request→Response through `worker.ts`; `fetchMock` for outbound DoH/remote-subs/camouflage |
| tunnel upgrade smoke | workers | WS pair handshake to the point of egress attempt with injected `dialImpl` (sockets unavailable in pool — that's why `createEgressOpener` takes an injectable dial impl) |

Commands: `npm run typecheck` (tsc --noEmit), `npm test` (vitest run), both must pass per package Definition of Done.

## 8. Build pipeline

### 8.1 package.json scripts

```jsonc
{
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "node scripts/build-single-file.mjs",
    "dev": "wrangler dev",
    "deploy": "node scripts/build-single-file.mjs && wrangler deploy"
  }
}
```

devDependencies only: `typescript`, `esbuild`, `vitest`, `@cloudflare/vitest-pool-workers`, `wrangler`, `@cloudflare/workers-types`. Nothing under `dependencies` — enforced by a build-script assertion that the bundle has zero bare imports besides `cloudflare:`.

### 8.2 `scripts/build-single-file.mjs`

esbuild JS API:

```js
entryPoints: ['src/worker.ts'],
bundle: true,
format: 'esm',            // dashboard paste uses ES-module format
platform: 'browser',
target: 'es2023',
outfile: 'dist/q-proxy.js',
minify: true,
loader: { '.html': 'text' },
define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
legalComments: 'none',
banner: { js: `/* Q Proxy v${pkgVersion} */` },
```

Post-build assertions: output contains no `import … from "non-relative"` except `cloudflare:sockets`; writes `dist/q-proxy.js`. Same artifact serves wrangler deploys and manual dashboard paste.

### 8.3 wrangler.toml shape

```toml
name = "q-proxy"
main = "dist/q-proxy.js"
compatibility_date = "2026-08-01"

[[kv_namespaces]]
binding = "QPROXY_KV"
id = "REPLACE_WITH_YOUR_KV_ID"
```

No vars, no secrets, no other bindings (R4 §3.4 constraints honored; identity lives in KV after first-run seeding).

## 9. Parallelization plan

Six packages, strict file ownership (owner is the ONLY package allowed to create/edit those files). Waves: **A → (B ∥ D ∥ F) → C → E**. Cross-package imports use only symbols frozen in this document.

### Package A — Scaffold, types, utils, core infra (wave 1)

**Owns:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.toml`, `.gitignore`, `scripts/build-single-file.mjs`, `src/types/global.d.ts`, `src/types/env.ts`, `src/types/settings.ts`, `src/types/node.ts`, `src/types/context.ts`, `src/types/tunnel.ts`, `src/utils/base64.ts`, `src/utils/bytes.ts`, `src/utils/net.ts`, `src/utils/random.ts`, `src/utils/time.ts`, `src/core/routes.ts`, `src/core/errors.ts`, `src/core/respond.ts`, `src/core/ua.ts`, `src/core/counters.ts`, `src/core/log.ts`.

**Needs from others:** nothing.

**Delivers:** all §2 frozen types verbatim and compiling; utils (`base64` tolerant std/urlsafe/padded, `bytes` concat/hex/u16BE/u32BE, `net` parseHostPort/isIPv4/isIPv6/bracketIpv6, `random` randomHex/randomString/constantTimeEqual, `time` unix helpers); `classifyUA` with full R4 §2.1 table; `identifyTunnel`/`resolveSecureRoute` matchers implementing §3 precedence incl. suffix rule and hostname resolution; error classes + respond envelope; counters with buffered flush; skeleton passes `npm run typecheck && npm test` with placeholder-free empty specs removed at handoff.

**Consumed by others (symbol contract):** `Env`, `Settings`, `DEFAULT_SETTINGS`, `SENSITIVE_SETTING_PATHS`, `PublicSettings`, `ProxyNode` family, `RouteHandler`, `NodeBuilderContext`, `UsageSnapshot`, `SubFormat`, `classifyUA`, `DialTarget`, `FailoverStrategy`, `EgressOpener`, `DnsPacketRelay`, `readUsage`, `recordConnection`, `jsonOk/jsonError/htmlResponse`, `AppError` family, `identifyTunnel`, `resolveSecureRoute`.

### Package B — Protocols & crypto (wave 2)

**Owns:** `src/crypto/md5.ts`, `src/crypto/sha224.ts`, `src/crypto/aes.ts`, `src/crypto/kdf.ts`, `src/protocols/common.ts`, `src/protocols/vless.ts`, `src/protocols/trojan.ts`, `src/protocols/vmess-crypto.ts`, `src/protocols/vmess.ts`, `src/protocols/shadowsocks.ts`.

**Needs from A:** `utils/bytes`, `utils/base64`, `utils/net`, `utils/random` (constant-time compare), types only.

**Delivers:** the four `createXInbound` factories + `parseAddress` exactly per §2.7 semantics; crypto primitives validated against RFC vectors; VMess AEAD auth-id window check (±120 s), AEAD open/seal via WebCrypto GCM, legacy header decode via pure-JS AES-128-CFB; SS salt/subkey/frame codec. Highest-risk item in the project: budget ~2 days for vmess alone; if AEAD response sealing blocks, ship request-decode first behind the same interface.

**Consumed by C:** `ProtocolInbound`, `PushOutcome`, `ParsedRequest`, `createVlessInbound`, `createTrojanInbound`, `createVmessInbound`, `createSSInbound`.

### Package C — Tunnel, egress, DNS (wave 3)

**Owns:** `src/tunnel/websocket.ts`, `src/tunnel/relay.ts`, `src/tunnel/egress.ts`, `src/tunnel/proxyip.ts`, `src/tunnel/nat64.ts`, `src/tunnel/resolver.ts`, `src/tunnel/speedtest.ts`, `src/tunnel/chain/index.ts`, `src/tunnel/chain/socks5.ts`, `src/tunnel/chain/http-connect.ts`, `src/handlers/tunnel.ts`, `src/handlers/doh.ts`.

**Needs from A:** `DialTarget/FailoverStrategy/EgressOpener/DnsPacketRelay` (implements them), `RouteHandler`, `Env`, `Settings`, `identifyTunnel`, `log`, `respond` (503/405 paths), `utils/net`.
**Needs from B:** the four inbound factories (§2.7 seam).
**Delivers:** working datapath end-to-end: early-data extraction, handshake driving loop (16 KiB / 10 s caps), speedtest interception, failover opener with injectable dial, zero-byte mid-session retry, UDP53 relay, socks5/http chain clients, `/doh` reverse proxy (64 KiB cap, content-type passthrough). Kill-switch 503 handled by A's router gate, not here.

### Package D — Subscription generation & emitters (wave 2)

**Owns:** `src/nodes/generate.ts`, `src/nodes/naming.ts`, `src/nodes/fragments.ts`, `src/nodes/share-uri.ts`, `src/nodes/emitters/registry.ts`, `src/nodes/emitters/yaml-writer.ts`, `src/nodes/emitters/clash-yaml.ts`, `src/nodes/emitters/singbox-json.ts`, `src/nodes/emitters/surge-conf.ts`, `src/nodes/emitters/loon-conf.ts`, `src/subscription/negotiate.ts`, `src/subscription/headers.ts`, `src/subscription/merge.ts`, `src/subscription/render.ts`, `src/handlers/subscribe.ts`.

**Needs from A:** `ProxyNode` family, `NodeBuilderContext`, `EmitOptions` consumers, `SubFormat/classifyUA`, `Settings`, `RouteHandler`, `readUsage` (UsageSnapshot for userinfo header), `respond`, `utils/*`.
**Delivers:** `generateNodes(ctx)` honoring every invariant in §2.4 (port/security pairing, plain-port policy, fragment family, CDN masking, node cap); `buildShareUri*` per R4 §1; five emitters per §2.5 contracts with golden-file tests derived directly from research doc 04 examples; subscription headers incl. estimated `Subscription-Userinfo`; remote-sub merge with timeout/cap/dedupe; browser info page (bilingual EN/FA mini template embedded in D, independent of F).

### Package E — Auth, settings store, API, routing glue (wave 4)

**Owns:** `src/worker.ts`, `src/core/router.ts`, `src/settings/store.ts`, `src/settings/seed.ts`, `src/settings/migrate.ts`, `src/settings/validate.ts`, `src/auth/password.ts`, `src/auth/session.ts`, `src/auth/guard.ts`, `src/handlers/api/auth.ts`, `src/handlers/api/settings.ts`, `src/handlers/api/status.ts`, `src/handlers/myip.ts`, `src/handlers/robots.ts`, `src/handlers/panel-page.ts`, `src/handlers/camouflage.ts`.

**Needs from A:** everything (types, respond, errors, routes, counters, log).
**Needs from B/C/D/F (imports only):** nothing from B; `handlers/tunnel.ts#handleTunnel` and `handlers/doh.ts#handleDoh` from C; `handlers/subscribe.ts#handleSubscribe` from D; `ASSETS` from F.
**Delivers:** live router implementing §3 table exactly (incl. kill-switch gate, camouflage fallback, secure-path redirect); KV store + TTL cache + seeding; `migrateSettings` per §5.3; PBKDF2 password + HMAC session + CSRF guard; all `/api` handlers matching the frozen JSON contract; robots; my-ip (request.cf enrichment + optional external trace compare, silent degradation); panel/login page serving; single top-level error boundary.

### Package F — Panel UI (wave 2)

**Owns:** `src/ui/assets.ts`, `src/ui/panel.html`, `src/ui/login.html`, `src/ui/camo.html`.

**Needs from A:** `PublicSettings`/`SENSITIVE_SETTING_PATHS` shape knowledge only (compile-independent — UI consumes JSON at runtime).
**Delivers:** self-contained bilingual (EN/FA, RTL-aware) SPA covering EVERY `Settings` field as form controls grouped like BPB's accordions (common/VLESS-Trojan credentials+paths/ports/CDN/fragment/proxyIP+NAT64/chain/DNS/subscriptions/behavior toggles); login page with first-run forced set-password flow (detects `hasPassword:false` from GET api/settings); client-side QR modal (embedded encoder) rendering any sub URL or share URI; suburl list with copy buttons; kill-switch toggle; status widgets; camo static page. Talks ONLY to the §3 API contract — no direct HTML rendering dependencies on E.

### Dependency graph

```
A ──► B ──► C ──► E
├────► D ─────────┤   (D needs only A)
└────► F ─────────┘   (F needs only A)
```

Integration order within wave 4 (E): router first against real handler imports; then store/migrate; then auth; then api handlers; then pages. If a wave-2/3 package slips, E wires its import behind the frozen symbol signature so compile stays green using a minimal local stub deleted at integration.

### Verification gates

Each package merges only when: (1) `npm run typecheck` green repo-wide; (2) its own specs green; (3) no file outside its ownership list touched; (4) exported symbols identical to this doc.



