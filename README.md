# Q Proxy v1.0.0

Single-user Cloudflare Worker that terminates VLESS, VMess, Trojan and Shadowsocks over WebSocket and emits subscriptions for every major client.

> **فارسی:** پنل کاملاً دوزبانه است (EN/FA با RTL). سوئیچ زبان در نوار بالا — ذخیره در `qp_lang` + `settings.language`. ترجمه‌ها در `src/ui/panel.html:194` نگهداری می‌شوند.

[![version](https://img.shields.io/badge/version-1.0.0-blue)](./package.json)
[![compat](https://img.shields.io/badge/compatibility_date-2026--08--01-orange)](./wrangler.toml)
[![tests](https://img.shields.io/badge/tests-vitest%202%20projects-green)](./vitest.config.ts)
[![bundle](https://img.shields.io/badge/bundle-esbuild%20single--file-black)](./scripts/build-single-file.mjs)
[![deps](https://img.shields.io/badge/runtime_deps-zero-lightgrey)](./package.json)

## Quick Links

| Track | Document | Audience |
|-------|----------|----------|
| User | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Deploy, setup, panel tour, per-client import, troubleshooting |
| Developer | [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Architecture, mermaid flows, KV schema, adding emitters, Xray vectors |
| Spec | [docs/SPEC.md](docs/SPEC.md) | 44 v1 features, NFRs, threat model |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Frozen types, route table (21 rows), build contract |
| Changelog | [docs/CHANGELOG.md](docs/CHANGELOG.md) | v1.0.0 notes |

## At a Glance

```
Browser ──► /{securePath}/panel ──► KV qproxy:settings ──► subscriptions
Client  ──► /{vl|vm|tr|ss}/<suffix> ──► ProtocolInbound ──► EgressOpener ──► origin
   │                    │                        │
   │              securePath gates               direct → proxyIp×8 | nat64×N
   │              everything                     chainProxy optional
   └─ camouflage 500 on miss ──────────────────── zero-byte retry swaps socket
```

- **Tunnel:** `src/protocols/{vless,vmess,trojan,shadowsocks}.ts` — dedicated WS paths (`src/core/routes.ts:11`), early-data via `Sec-WebSocket-Protocol` (`ed=2048`, 8 KB cap), DNS-only UDP→DoH.
- **Egress:** `src/tunnel/egress.ts:40` `makeFailoverStrategy()` → `[chain] → direct → proxyIp×8 | nat64×N` (deterministic shuffle `hashSeed`); zero-byte retry in `src/tunnel/relay.ts`.
- **Router:** `src/core/router.ts:143` 21-row precedence — kill-switch at `router.ts:155` before upgrade, `resolveSecureRoute` + `identifyTunnel` + `resolveAuthAlias`.
- **Subs:** `src/subscription/negotiate.ts:6` + `src/core/ua.ts:19` — `?target=` override → UA sniff (`clash`/`singbox`/`surge`/`loon`/`base64`) → browser info page via `src/handlers/subscribe.ts`.

## Features

| Area | Detail |
|------|--------|
| Protocols | VLESS / VMess AEAD (`aid=0`) / Trojan (SHA-224 + CRLF) / Shadowsocks `aes-128-gcm` / `aes-256-gcm` over WS. Paths `/{sp}/vl`, `/vm`, `/tr`, `/ss`. Early-data `Sec-WebSocket-Protocol` (cap 2048). |
| Egress | Direct-first, zero-byte failover (≤2 retries). `proxyIps` (IP/host/host:port/`host.tpNNN`, DoH-resolved + shuffle) or NAT64 synthesis. Chain `socks5://`/`http://`/`https://` global. Speedtest intercept for `speed.cloudflare.com` (toggle). |
| Subs | 5 formats UA-negotiated: `base64` (mixed URIs), `clash` (real YAML), `singbox` (tun+urltest), `surge`, `loon`. `?target=` override. Browsers get bilingual HTML info page. |
| Fragment | Presets `off`/`low`/`medium`/`high`/`severe`/`custom` + `packets` (`tlshello`…`1-5`) → `frag=` on WS path. `?mode=fragment` sub filters to fragment nodes. |
| DoH | Private `/{sp}/doh` (GET `?dns=` + POST RFC 8484) proxied to `dohUpstream` (default `https://cloudflare-dns.com/dns-query`). |
| Management | Regenerable `securePath` (12 hex chars) gates panel/API/subs/DoH/WS. PBKDF2-SHA256 ≥100k + `q_session` HMAC (7d, `HttpOnly; Secure; SameSite=Lax`). Kill-switch 503 on WS. |
| Platform | Zero runtime deps. `dist/q-proxy.js` single file (~228 KB). One KV `QPROXY_KV`. Isolate cache 15s, counters 60s/32. |

## Deploy in 2 Minutes

### A. Dashboard paste (no CLI)

1. Build:
```powershell
Set-Location -LiteralPath "E:\Code\Q Proxy"
npm install
npm run build
# -> dist/q-proxy.js  (≈228 KB)
```
2. Cloudflare Dashboard → Workers & Pages → Create Worker → Edit code → paste entire `dist/q-proxy.js` → Save.
3. Bindings → Add binding → KV Namespace → variable `QPROXY_KV` → create + bind → Deploy.
4. Open `https://<worker>.workers.dev/<securePath>/panel` → first-run wizard (`src/handlers/api/auth.ts:handleSetup`).

### B. Wrangler (repeatable)

`wrangler.toml` is the source of truth:
```toml
name = "q-proxy"
main = "dist/q-proxy.js"
compatibility_date = "2026-08-01"
[[kv_namespaces]]
binding = "QPROXY_KV"
id = "REPLACE_WITH_YOUR_KV_ID"  # from kv create
```

Create a **Global API Key** at dash.cloudflare.com → My Profile → API Tokens → Global API Key (not a Bearer token):
```powershell
Set-Location -LiteralPath "<repo>"
$env:CLOUDFLARE_API_KEY="<your-global-api-key>"
$env:CLOUDFLARE_EMAIL="<your-account-email>"
$env:CLOUDFLARE_ACCOUNT_ID="<your-account-id>"
npx wrangler whoami          # must show the account
npx wrangler kv namespace create QPROXY_KV  # copy id → wrangler.toml
npm run deploy               # = build + deploy (package.json:11)
npx wrangler dev --port 8787 # local miniflare
```
`CLOUDFLARE_API_TOKEN` with a `cfk_` key fails `[code: 9109]` — use `CLOUDFLARE_API_KEY`.

## First Setup

1. Open `https://<worker>/<securePath>/panel` → redirects to `/{sp}/login` when `passwordHash === null`.
2. Set password ≥8 chars, letter+digit (`src/handlers/api/auth.ts:52`). Race-guarded — only accepted while unset (`loadSettingsFresh` double-check).
3. Login → sets `q_session` (`HttpOnly; Secure; SameSite=Lax`, 7d) + `X-Q-Panel: 1` required for mutating APIs.
4. Keep the full `https://<worker>/<securePath>` URL — rotating the path invalidates every client config. Change password via panel (revokes all sessions).

## Panel Tour

| Path | Handler |
|------|---------|
| `/{sp}/panel` | SPA — EN/FA toggle (`qp_lang` cookie + `settings.language`), QR (client-side), copy per format |
| `/{sp}/login` | Login + setup form |
| `/{sp}/sub` | Subscription (UA or `?target=`) |
| `/{sp}/doh` | Private DoH |
| `/{sp}/my-ip` | Authenticated — JSON if `Accept: application/json`, else HTML |
| `/{sp}/api/*` | `auth/login`, `auth/logout`, `auth/setup`, `settings` GET/PUT, `settings/reset`, `status`, `killswitch`, `suburls` |
| `/robots.txt` | `Disallow: /` |

Tunnel WS: `wss://<host>/{sp}/vl/<8-32 alnum>`, `/vm/`, `/tr/`, `/ss/` — kill-switch returns 503 before upgrade.

## Subscriptions

```powershell
curl -s "https://<host>/{sp}/sub?target=clash"   -o clash.yaml
curl -s "https://<host>/{sp}/sub?target=singbox" -o singbox.json
curl -s "https://<host>/{sp}/sub?target=base64"  -o sub.txt
curl -s "https://<host>/{sp}/sub?target=surge"   -o surge.conf
curl -s "https://<host>/{sp}/sub?target=loon"    -o loon.conf
# Fragment variant
curl -s "https://<host>/{sp}/sub?target=clash&mode=fragment" -o clash-frag.yaml
```

| Client | Import |
|--------|--------|
| **v2rayNG / NekoBox** | Add subscription → paste `.../sub?target=base64` (or bare `/sub`) |
| **Clash Verge / mihomo** | Import URL → `.../sub?target=clash` (real YAML, `servername` vs `sni`, `max-early-data: 2048`) |
| **sing-box / SFA** | Import → `.../sub?target=singbox` (tun+urltest) |
| **Surge / Loon** | Import → `.../sub?target=surge|loon` (INI, vless/vmess/trojan over WS) |

Headers: `Profile-Title`, `Profile-Update-Interval`, `Subscription-Userinfo: upload=0; download=…; total=…; expire=…`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| WS 503 | Kill-switch on — Panel → toggle off or `POST /{sp}/api/killswitch {enabled:false}` |
| Sub returns HTML | Browser UA — add `?target=base64` or use client UA |
| 401 on `/api/settings` | Session expired — re-login; ensure `X-Q-Panel: 1` on PUT |
| 403 after 5 fails | Throttled 15 min per IP (KV) — wait or clear `rl:*` |
| `[code: 9109]` on deploy | Used `CLOUDFLARE_API_TOKEN` with `cfk_` — use `CLOUDFLARE_API_KEY` |
| No plain nodes | `plainPortPolicy=workers-dev` + host not `*.workers.dev` — set `always` |

## Development

```powershell
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (unit node + workers @cloudflare/vitest-pool-workers)
npm run build       # → dist/q-proxy.js
npm run dev         # wrangler dev http://127.0.0.1:8787
npm run deploy      # build + deploy
```

Build `scripts/build-single-file.mjs:10` — `esbuild` esm/browser/es2023/minify, `.html` as text, `__APP_VERSION__` from `package.json`, rejects bare imports except `cloudflare:*`.

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Workers (`cloudflare:sockets`, WebCrypto) |
| Build | esbuild single-file `dist/q-proxy.js` |
| Tests | vitest 2 projects (`vitest.config.ts:18`) |
| Storage | KV `qproxy:settings` / `qproxy:meta` / `qproxy:counters` |

See [DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for mermaid flows, KV schema, and adding emitters.

## Version

`1.0.0` (2026-08-24) stable — `__APP_VERSION__` via `scripts/build-single-file.mjs:18`, displayed at `GET /{sp}/api/status`. Update: `git pull && npm run deploy` — `src/settings/migrate.ts` handles KV upgrades.

## License

MIT — clean-room, no code copied from BPB/edgetunnel/nahan.
