# Changelog

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

