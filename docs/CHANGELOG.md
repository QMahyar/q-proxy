# Changelog

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

