# Changelog

## Unreleased

### Added
- Onboarding v2 server: new settings fields `passwordIsBootstrap` (default `false`) and `seededAt` (default `0`) with descriptor rows and migrate-safe defaults merge; `fillIdentity` stamps `seededAt` on first seed and never refreshes it.
- Setup window: `POST /{sp}/api/auth/setup` answers `409 SETUP_WINDOW_EXPIRED` once a seeded-but-passwordless panel is older than 24 h (checked after the fresh KV re-read; blobs seeded before this change keep the setup endpoint open).
- Bootstrap gate: while the bootstrap password is in force, every authenticated API answers `403 PASSWORD_CHANGE_REQUIRED` except the allowlist — `GET api/bootstrap`, `POST api/auth/logout`, `POST api/auth/password`, and read-only `GET api/settings` (PUT still gated); a successful password change clears the flag and unlocks the panel.
- Deploy-direct password handoff: the script generates a strong bootstrap password in the `qproxy-XXXXXXXX` form, prints it exactly once, polls the freshly seeded worker until it responds, and exits 1 when the handoff fails (`--password` / `QPROXY_PASSWORD` still override).
- TOTP enable-flow hardening: recovery codes are a hard gate — the 10 codes are shown once, during setup, with copy-all plus a plain-text download (`q-proxy-recovery-codes.txt`); "Verify and enable" stays disabled until the "I saved my recovery codes" switch is on (EN/FA), with a defense-in-depth re-check in the confirm action.

### Changed
- Full-auth login success data gains `mustChangePassword: true` while `passwordIsBootstrap` is on (field absent otherwise); the TOTP-pending `{totpRequired:true}` response is unchanged.
- TOTP re-enable guidance: starting setup while an enable attempt is in progress or was previously started asks for confirmation and warns that the fresh secret invalidates the previously shown QR (idle and setup views, EN/FA); after enable the codes view is replaced by a persistent device-clock-skew note, and the login TOTP error view hints "check your device clock or use a recovery code".

## 1.3.0 - 2026-09-04

### Added
- External remote nodes (REALITY + Hysteria2, admin-owned VPS backends): `remoteNodes[]` setting, reality/hy2 share-URI grammars, clash/sing-box emission, admin-subscriptions only (`users-sub` excluded); hy2 outbounds default to self-signed-tolerant TLS (documented).
- Password peppering: PBKDF2 input is HMAC-SHA256(keyed by `sessionSecret`); legacy unpeppered hashes verify once then upgrade to peppered-100k.
- Surge emitter: VLESS + Shadowsocks lines (Surge 5 grammar); Loon emitter: Shadowsocks + `tls-profile` fingerprint + `ech=` lines; Clash TLS proxies: `skip-cert-verify: true`.
- KV-backed login throttle (`qproxy:login-fail:<sha256-ip>:<minute>`, 120s TTL, fail-open); VMess chunk-nonce wrap guard; 2MB relay downlink cap (1009).
- Subscription edge-cache keys versioned by settings etag (`_v`); remote-sub fetch parallelized (10s total budget).
- Specs: share-uri `type=ws` regression, counters/errors/fragments/protocols-common/address suites, vmess-crypto boundary, relay downlink cap, KV throttle (mock-KV, window rollover, fail-open).
- ECH auto-configuration: new `echAuto` setting (default off); when on with no manual `echServerName`, the ECH query name is derived per node from its SNI, with a live panel preview and an English warning when unresolvable (manual name always wins; unresolvable nodes emit without ECH).
- Settings writes now return a monotonic blob `rev` — `PUT api/settings`, `POST api/settings/reset`, `POST api/settings/import`, and `POST api/killswitch` include `rev` in success data.
- Egress dials are capped by a 15 s total budget (`TOTAL_DIAL_BUDGET_MS`, overridable per opener via `totalBudgetMs`), and chain/direct dials start speculatively before proxyIP/NAT64 expansion finishes (`openEgressWithSpeculativeDirect`).
- New `isBlockedEgressHost(host)` guard combining local/private, cloud-metadata, and Cloudflare-IP checks.
- Panel IP allowlist: new `allowedIps` setting (default `[]` = allow all); `requireAuth` checks the session first (401) then the client IP (`CF-Connecting-IP`) against exact IPv4/IPv6 or v4/v6 CIDR entries (403 when not listed); login/setup stay reachable so lockout is never permanent.
- Admin audit trail: `audit()` JSON lines (`scope:"audit"`) for settings save/reset/import (`{ip, keys}` — changed top-level key names only), kill-switch toggles (`{ip, enabled}`), and WARP account/preset/Amnezia writes (`{ip, id}`); values and secrets are never logged.
- Per-user activity aggregates: daily `{day, requests, bytesUp, bytesDown}` rows in `qproxy:user-activity:<day>:<hash>` plus `GET /api/users/:id/activity?days=` (default 7, clamped 1–31, zeros for missing days).
- Per-user connection rate-limit seam: token-bucket module (30 conns/min refill, burst 10, 120 s KV TTL, fail-open) with an opt-in relay admission gate (`RelayOptions.gate`; deny closes 1008).
- Telegram inline keyboard: `/start`/`/menu` show Status/Usage/Subscription/Expiry/Kill ON-OFF buttons (`tg:*` callbacks); taps are answered and edit the message in place.
- Country-tagged addresses: `AddressSetting` gains optional `country`/`city`; `?country=XX` (comma-separated, case-insensitive, invalid tokens ignored) on `/{sp}/sub` and per-user links keeps matching tagged addresses plus all untagged entries and the hostname fallback.
- Bulk user operations: `POST /{sp}/api/users/bulk` patches `enabled`/`expiresAt` or deletes up to 50 users per call (`{updated, deleted, unknown}`; unknown ids skipped, tokens never returned).
- Quantumult X subscription format: `?target=quantumult` (UA `quantumult`/`quanx`), `.conf` download with a single static PROXY group; VLESS/Trojan TLS-only, plain VMess/Shadowsocks included.
- Panel wave-4 batch: show-once token-rotation modal (copy+QR), keyboard shortcuts (`?` cheatsheet; Ctrl/Cmd+S apply, Ctrl/Cmd+K search-or-home, g-h home, Ctrl/Cmd+Z per-section undo/redo), traffic chart on Home, 30-day backup nudge, per-address country/city fields, mobile pass.
- VLESS `xtls-rprx-vision` flow: the inbound negotiates vision from the handshake addons field (TCP only; UDP keeps the length-framed codec) and serves the body phase through a dedicated length-prefixed body codec (split-frame buffering, 64 KiB cap, never throws); new `vlessFlow` setting (default off) stamps the flow onto TLS VLESS nodes only — share URIs gain `flow=`, Clash/sing-box emit `flow` (surge/loon untouched).
- Direct Shadowsocks mode: new `ssDirect` setting (default off) emits plain `ss://` URIs and Clash/sing-box nodes with no `v2ray-plugin` indirection, for clients that handle raw SS.
- Transport roadmap decisions (docs only, no route changes): gRPC DEFERRED (no trailer/h2 APIs in the fetch handler), XHTTP DEFERRED as nearest-term candidate (gated on an Xray source pin + an edge full-duplex probe), REALITY termination ruled out permanently with a specified-but-parked remote-reference model (ADR-006/007/008, sequenced by ADR-009).
- D1 persistence for write-hot state: new `QPROXY_DB` binding with `migrations/0001_init.sql` (`users`, `user_totals`, `user_usage`, `user_activity`, `counters`, `audit_log`, `meta`); users directory, per-user quota/activity/totals, global counters, and the audit trail now live in D1 with single-statement race-free UPSERTs. Settings blob, WARP store, and login-throttle/session/ratelimit keys stay on KV. Boot runs schema bootstrap plus a guarded idempotent KV→D1 migration (`meta.kv_migrated_v1`); `npm run deploy` creates the database and applies migrations automatically.
- sing-box subscriptions now emit typed DNS servers by default: `proxy-dns` as `{type, server, detour: "PROXY"}` (domain upstreams resolve via `domain_resolver: "local-dns"`, non-default ports/paths preserved) and `local-dns` as `{type: "local"}`; legacy `address`-string servers are gone.
- Panel sources split for development: `src/ui/panel/` (`shell.html` + `head.js` + `app.css` + 9 JS parts in fixed order) assembles into `src/ui/panel.html` on every build; the committed `panel.html` is byte-identical generated output, covered by an in-sync spec.

### Fixed
- Review sweep (5 rounds, ~70 findings): tunnel lifecycle (origin socket closed when client disconnects mid-dial; chain handshake deadline with proper timer cleanup), VLESS UDP/53 now length-framed per Xray `LengthPacketReader` (was forwarded raw, broken both directions), VMess rejects unknown security types (7-15) and plain+authenticated-length at handshake, fatal uplink corruption closes the tunnel (1011/1008) instead of hanging silently.
- WARP `storeAccount` no longer deletes a pre-existing account record when the token-index write fails on update; `parseWgUri` no longer throws on malformed percent-encoding; S1-S4 cap raised to 65535.
- Per-user daily quota moved to per-hash KV keys (`qproxy:user-usage:{day}:{hash}`) to bound the cross-isolate last-write-wins race; settings saves no longer shadowed by an isolate-local last-write dedupe.
- Auth: `/api/auth/setup` requires the `X-Q-Panel: 1` CSRF header; login/setup cookies use `iat = floor+1` so logout no longer poisons same-second logins; Telegram `setWebhook` registers `secret_token` (webhook accepts the header credential too).
- Settings export keeps protocol credentials by design (round-trip import); panel warns the file is sensitive.
- Wave 1 Docs: `resolveHostname` implements the documented hostname rule; panel a11y batch (nav/accent labels, skip link, 401-dirty confirm, 10s error toasts, tab overflow fade, `qp_lang` sync from `settings.language`); oversize early-data now closes 1009; Telegram `@username` match case-insensitive; counters flush attaches settlement handler (no unhandled rejection without bound context).
- SSRF host guards now deny cloud-metadata literals/hostnames (`169.254.169.254/253`, `100.100.100.200`, `fd00:ec2::254/253` in any IPv6 spelling, `metadata.google.internal`/`metadata.goog`/`instance-data*`/`rancher-metadata`/`metadata`) plus any `.internal` hostname.
- DNS resolver cache is LRU instead of FIFO, so hot entries survive unique-name bursts (256-entry cap and TTL unchanged).
- Settings save/reset/import/killswitch merge from fresh KV state (`loadSettingsFresh`) instead of the stale 60 s isolate cache — locked by regression specs; concurrent writers can still race on the blob `rev` (KV read-modify-write is approximate across isolates).
- Per-user quota/activity and global counters no longer lose increments to cross-isolate read-modify-write races: D1 increments are single `ON CONFLICT` UPSERTs, and the one-time boot migration copies legacy KV keys into D1 behind the `kv_migrated_v1` guard row (legacy keys deleted after copy).

### Changed
- Subscription base64 output drops `ss://` and plain-security VLESS/Trojan URIs (Xray-family clients cannot run them); ss-only per-user scopes keep their nodes.
- Clash emits mihomo's `query-server-name` ECH key (was the invalid `ech_server_name`); Loon emits official `tls-name=` (was `sni=`).
- Removed dead code: `drainChunks`, AES-CFB helpers, `decodeUtf8Base64`, `TOKEN_HINT_SUFFIX`, `emitBase64List`/`base64-list.ts`, `recordUserHit`, `FailoverStrategy.hasNext`, `resolveAuthAlias` (matcher folded into `resolveSecureRoute`); shared `hmacSha256Hex` in `src/utils/hmac.ts`; `readJsonObject` streams bodies with the 64 KiB cap enforced mid-read.
- ProxyIP domain expansion runs DoH lookups in parallel; resolver caches empty answers; users API path parsing fixed for `securePath="users"`.
- `dispatchApi` 21-case switch replaced by a declarative `API_ROUTES` method/auth/handler table — dispatch semantics unchanged.
- Sing-box/clash emitters share typed `SingBoxOutbound` outbounds and `nodeHas*` helpers — emitted configs byte-identical.
- Test-only coverage: warp emitter goldens, subscription pipeline, and relay-failover specs (no `src/` changes).
- `Env` requires the `QPROXY_DB` D1 binding and `wrangler.toml` ships the matching `[[d1_databases]]` stanza; `audit()` persists to the D1 `audit_log` table (via `waitUntil`) in addition to the JSON log line; counters read/flush D1-first with KV fallback; the `workers` vitest project covers `test/d1/**` with a provisioned `QPROXY_DB`.
- `scripts/deploy-direct.mjs` provisions D1 (create database, apply `migrations/0001_init.sql`, bind on upload; API tokens need `D1:Edit`) and continues KV-only with a warning when D1 setup fails.

## 1.2.0 - 2026-08-27

### Added
- **Direct API deploy**: `scripts/deploy-direct.mjs` — one command, no wrangler, no git, handles API Token and Global Key, creates KV, uploads Worker, seeds, sets password, prints Panel URL. Fixed `main` → `master` branch references.
- **Release artifacts**: `.github/workflows/release.yml` publishes `dist/q-proxy.js` + `dist/_worker.js` on `v*` tags.

### Fixed
- SHAKE128 test: `node:crypto` `outputEncoding` moved to positional arg (Node 22 compat).

### Changed
- Removed 8 bloat scripts (`setup.mjs`, `deploy.mjs`, `deploy-pages.mjs`, `quick-deploy.mjs`, `quick-deploy.sh`, `quick-deploy.ps1`, `deploy.py`, `post-deploy.mjs`). `deploy-direct.mjs` is the single deploy path.

## 1.1.0 - 2026-08-26

### Added
- **WARP integration**: Cloudflare WARP device generation (x25519, RFC 7748) and `.conf`/`wg://` import; 17 subscription formats including Amnezia variants; endpoint presets (default/Iran/China/custom); per-account Amnezia overrides; public token'd routes `/{sp}/sub/wg/{token}/{format}` with edge caching and purge-on-change.
- **User center**: scoped per-user subscription links at `/{sp}/sub/u/{token}` with protocol filters, daily request quotas, and expiry; admin CRUD under `/{sp}/api/users`.
- **Telegram bot**: HMAC-gated webhook (`/{sp}/telegram/webhook/{secret}`), /status /sub /kill /usage commands, EN/FA replies, in-panel webhook setup/removal. `telegram.botToken` is write-only.
- **Settings import/export**: JSON export with all secrets and the secure path stripped; validated import that preserves identity and URLs.
- **ECH**: `echEnabled` + `echServerName`; emitted as `ech=` on VLESS/Trojan TLS URIs, sing-box `tls.ech`, and Clash `ech-opts`.
- **Routing rules**: LAN bypass, QUIC block, and custom bypass/block domain lists injected into Clash and sing-box outputs.
- **Panel self-update check** against GitHub releases; first-run wizard (EN/FA).

### Changed
- **Efficiency**: panel boot coalesced to one `GET /api/bootstrap` call with ETag/304 revalidation; sessionStorage client cache with in-flight dedup; settings isolate cache 60 s + KV `cacheTtl` + write-through saves with no-op skip; subscription responses edge-cached 60 s; remote subscriptions memoized per update interval; `robots.txt` and OPTIONS answered without loading settings.
- **Visual identity**: design system ported from the warp-generator project: dark glass tokens, four accent themes, ambient dot-grid/noise/blobs, gradient CTAs, pill navigation, toast progress bars, skeleton loaders, empty states, stat chips, sheet modals.
- **UX details**: help popovers on policy fields, on-blur scalar validation, live character counters, and explicit Worker-quota vs WARP-direct labeling on subscriptions.

### Fixed
- Kill switch double-click spam (debounced), stale panel HTML after deploys (cache headers), no-op settings writes burning KV quota.

## 1.0.5 — 2026-08-24

### Added
- **Pinned ports on clean addresses**: the clean-address list now accepts `ip:port`, `[ipv6]:port`, and `host:port` entries. An entry with an explicit port generates nodes for that port only (security derived from Cloudflare's canonical TLS/plain port families); bare entries keep using the global TLS/plain port selection. Invalid lines are dropped at save time and the rest are normalized/deduped.
- Panel hint text (EN/FA) documents the syntax.

### Changed
- `generateNodes` treats a pinned port as a single-entry family; all invariants (fragment ⇒ TLS, SS earlyData=0, naming) apply unchanged.

## 1.0.4 — 2026-08-24

### Fixed
- Settings validation now rejects an empty `tlsPorts` list with "select at least one TLS port" — previously a panel save with all TLS ports unchecked produced zero subscription configs silently (the failure mode reported from live testing).

## 1.0.3 — 2026-08-24

### Fixed
- **Shadowsocks downlink was broken for real clients**: the session salt was routed through the AEAD framer, double-wrapping it. Clients could complete the handshake but never decrypt the response. Salt is now sent raw, followed by counter-framed AEAD chunks per SIP004. Proven end-to-end with an independent Node client (full HTTP fetch through the tunnel).
- **VMess responses were missing the encrypted response header** when the body codec was active: the protocol's cached AEAD response header is now sent raw before the first body frame, as Xray clients require.
- Tunnel smoke tests now pin exact statuses instead of accepting any non-5xx.

### Added
- `test/manual/vless-probe.mjs` and `test/manual/ss-probe.mjs` — real-client end-to-end probes that speak VLESS and Shadowsocks against a running `wrangler dev`, verifying handshakes, framing, and actual proxied HTTP.

### Notes
- Found while debugging with real clients: unit tests exercised the encoder in isolation, so the salt-wrapping seam bug at the relay boundary was invisible until a wire-level client was used.

## 1.0.2 — 2026-08-24

### Fixed
- Surge emitter no longer emits VLESS nodes — VLESS is not a supported Surge proxy type (manual.nssurge.com); previously produced configs Surge would reject.
- Loon emitter aligned to official nsloon.app grammar: `transport=` (was `transporter=`), `over-tls=` for vmess, positional cipher/uuid/password, `udp=true` on vless/trojan.
- Surge subscriptions now prepend `#!MANAGED-CONFIG` so URL-imported profiles auto-refresh.
- sing-box urltest group now emits explicit `tolerance: 50`.
- Login rate-limit responses carry a computed `Retry-After` header (the UI already parsed it).
- `/sub?view=html` now forces the info page regardless of User-Agent, matching the link shown in the panel.
- DoH upstream fetch has a 5s timeout; POST bodies are size-checked before buffering via Content-Length pre-check.
- Counters flush straddling midnight files counts under the correct day key.
- Flaky network-dependent unit test in the egress suite stubs fetch.

### Changed
- Dead code removed: relay `pump()`, `randomInt`, `generateUuid`, `SMART_SWEEP_LENGTHS`, `bufferedLength`.
- Stronger test assertions: chacha20 AEAD full-vector compare vs node oracle, tunnel smoke and router sub/doh exact statuses.

### Docs
- ARCHITECTURE.md Rev note amended: Surge/Loon protocol coverage corrected after upstream research.
- AGENTS.md: wrangler dev wedged-session workaround, expanded known-gaps list.

## 1.0.1 — 2026-08-24

### Security
- Removed operator-specific deployment data (account IDs, worker host, securePath, KV namespace ID) from all public docs and config. Private deploy targets now live in `wrangler.local.toml` (gitignored).

### Added
- `scripts/deploy.mjs` — `npm run deploy` prefers `wrangler.local.toml` when present, falls back to `wrangler.toml`.
- `scripts/version.mjs` + `scripts/release.mjs` — version is derived from git tags; build fails on version drift at a tagged commit; release gate runs typecheck + tests + changelog check before tagging.
- `AGENTS.md` — agent context: conventions, invariants, boundaries, patterns.

### Changed
- `wrangler.toml` ships with a placeholder KV id.

## 1.0.0 — 2026-08-24 (stable)

First stable release. Single-file Cloudflare Worker, zero runtime deps, bilingual EN/FA panel.

### Shipped

- **Protocols** VLESS / VMess AEAD (`aid=0`, `scy=aes-128-gcm`) / Trojan (SHA-224) / Shadowsocks `aes-128-gcm`/`aes-256-gcm` over WebSocket. Dedicated paths `/{sp}/vl|vm|tr|ss`, early-data `Sec-WebSocket-Protocol` (`ed=2048`, 8 KB cap, SS disabled), 16 KiB/10 s handshake caps. Verified against Xray-core vectors.
- **Tunnel** WebSocketPair with `binaryType=arraybuffer`, half-open handling, speedtest intercept (`speed.cloudflare.com` → synthetic 204), UDP53-only → DoH relay.
- **Egress** Direct-first with zero-byte failover (≤2 retries), proxyIP/NAT64 pool (DoH-resolved, deterministic shuffle, top 8), global chain `socks5://`/`http://`/`https://` (RFC 1928 + CONNECT). Respects `isBlockedDirectHost`.
- **Subscriptions** 5 formats UA-negotiated: `base64` (mixed URIs), `clash` (real YAML `yaml-writer`), `singbox` (tun+mixed+DNS detour+urltest), `surge`, `loon`. `?target=` override, browser → bilingual HTML info page. Fragment `?mode=fragment` filters to `variant=fragment` nodes (TLS-only, excludes CDN). Headers: `Profile-Title`, `Subscription-Userinfo`, `Profile-Update-Interval`, `Content-Disposition: attachment`.
- **Panel** Self-contained SPA (`src/ui/*.html` → `src/ui/assets.ts` ASSETS, no framework). Hash-routed Home/Settings (7 tabs)/IP Checker/Login. Client-side QR, `qp_lang` cookie + `settings.language` (EN/FA RTL), 15s KV cache, 24h session `q_session` HMAC.
- **Settings** 52 fields (`src/types/settings.ts`): protocols, ports (`tlsPorts`/`plainPorts`/`plainPortPolicy`), routing (`hostnameOverride`/`customDomains`/`cleanIps`/`cdn`), TLS (`fingerprint`/`alpn`), fragment presets, DNS (`dohUpstream`/`remoteDns`/`localDns`), privacy (`camouflage`/`killSwitch`/`remoteSubUrls`).
- **Auth** PBKDF2-SHA256 ≥100k (legacy 15k fallback), constant-time, setup race-guarded via `loadSettingsFresh`, login throttle best-effort, CSRF `X-Q-Panel: 1`, `HttpOnly; Secure; SameSite=Lax` cookie.
- **KV** `qproxy:settings` (`{version, updatedAt, data}`), `qproxy:meta`, `qproxy:counters` (buffered 60s/32, day rollover). Migrations `src/settings/migrate.ts`.
- **Build** `scripts/build-single-file.mjs` esbuild esm/browser/es2023/minify, `.html`→text, `__APP_VERSION__` define, rejects bare imports except `cloudflare:*`. `dist/q-proxy.js` ≈228 KB.
- **Hardening (post-audit)** LE SS nonce (SIP004), first-packet dedup, Trojan UDP codec, proto-pollution guard, `sessionSecret` redaction, setup TOCTOU, PBKDF2 100k, throttle cap, counters single-flight, `my-ip` auth, `remoteDns` normalization, `proxyIp` DoH upstream, `driveSession` catch.

### Docs

- `README.md` landing + 2-min deploy + panel tour + troubleshooting
- `docs/USER_GUIDE.md` (prereqs, Path A/B, wizard, panel, subs matrix, per-client import, 6-row troubleshooting, advanced examples)
- `docs/DEVELOPER_GUIDE.md` (stack, mermaid router/egress/emitter flows, KV schema, adding emitter, testing, conventions)
- `docs/ARCHITECTURE.md` Rev 2026-08-24 (BodyCodec + killSwitch location + naming + aliases)

### Tests

- `vitest` 2 projects: `unit` (node) 457 tests, `workers` (miniflare) 8 tests. Typecheck clean. `protocol` vectors vs Xray, `emitters` golden snapshots (now include vless in surge/loon).

### Known limitations (v1)

- No WARP, no REALITY/gRPC/XHTTP, no multi-user, no D1/DO, UDP only port 53. See `docs/SPEC.md` 19 excluded.

### Upgrade

```
git pull
npm run deploy  # build + deploy; KV migrates automatically
```

