# Q Proxy

Self-hosted proxy panel on a single Cloudflare Worker. Terminates VLESS, VMess, Trojan and Shadowsocks over WebSocket, serves subscriptions for every major client, manages WARP/WireGuard configs and per-user links, and runs an optional Telegram bot — all behind one secret path with a bilingual EN/FA panel. Zero runtime dependencies; deploys as one file.

> **فارسی:** پنل کاملاً دوزبانه است (EN/FA با RTL). سوییچ زبان در نوار بالای پنل است و انتخاب در کوکی `qp_lang` ذخیره می‌شود.

[![compat](https://img.shields.io/badge/compatibility_date-2026--08--01-orange)](./wrangler.toml)
[![tests](https://img.shields.io/badge/tests-763%20passing-green)](./vitest.config.ts)
[![bundle](https://img.shields.io/badge/bundle-single_file_~380KB-black)](./scripts/build-single-file.mjs)
[![deps](https://img.shields.io/badge/runtime_deps-zero-lightgrey)](./package.json)

## Documentation

| Document | Audience |
|----------|----------|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Deploy on Workers or Pages** — one-click button, dashboard paste, Wrangler CLI, setup script, KV + custom domain |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | First-run wizard, panel tour, per-client import, troubleshooting |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Contributing: architecture flows, KV schema, adding emitters, testing |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Frozen contracts: types, route table, API shapes |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records — why, not just what |
| [CONTEXT.md](CONTEXT.md) | Subsystem map for AI coding agents |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Release notes |

## Feature Highlights

| Area | What you get |
|------|--------------|
| Protocols | VLESS, VMess AEAD (`aid=0`), Trojan (SHA-224), Shadowsocks `aes-128-gcm`/`aes-256-gcm` over WebSocket, with early data via `Sec-WebSocket-Protocol` |
| Worker subscriptions | 5 formats negotiated by User-Agent or `?target=`: `base64`, Clash YAML, sing-box JSON, Surge, Loon |
| WARP accounts | Real Cloudflare WARP device registration (hand-rolled X25519); 17 WireGuard output formats including Amnezia variants |
| User center | Up to 50 scoped subscription links with protocol filter, daily request quota and expiry dates |
| Telegram bot | `/status`, `/sub`, `/kill`, `/usage` commands via an HMAC-gated webhook; EN/FA replies |
| Efficiency | One-request bootstrap with ETag/304 revalidation, edge-cached subscriptions, 60 s settings cache |
| Routing | Clash/sing-box rule injection (bypass LAN, block QUIC/ads), custom bypass/block lists, ECH on TLS nodes |
| Ops | Settings export/import JSON (secrets stripped), IP checker page, kill switch (503 before upgrade), camouflage page for wrong paths |

## Deploy

Works on **Cloudflare Workers** and **Cloudflare Pages** (Advanced Mode). One KV namespace, zero runtime dependencies, single-file bundle.

| Path | Best for | Time |
|------|----------|------|
| [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<your-user>/Q-Proxy) One-click | Zero CLI setup | 2 min |
| Dashboard paste (Workers) | No CLI deploy | 3 min |
| Wrangler CLI (Workers) | Repeatable, CI-friendly | 5 min |
| Pages Advanced Mode | Existing Pages users | 4 min |

Full steps for all seven paths — including KV creation, custom domains, first-run seed, and updates — are in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

### Quickstart (Workers, Dashboard)

1. Fork or clone this repo.
2. Run `npm install && npm run build` — this produces `dist/q-proxy.js` and `dist/_worker.js` (Pages).
3. In Cloudflare Dashboard → Workers & Pages → Create Worker → Edit code → paste the whole `dist/q-proxy.js` → Save.
4. Add a KV namespace binding named `QPROXY_KV`, then Deploy.
5. Visit your worker URL once — this seeds settings into KV.
6. Read your secret path from KV key `qproxy:settings` (field `data.securePath`) via the dashboard KV viewer or `npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV`.
7. Open `https://<worker>.workers.dev/<securePath>/panel` and set a password (8+ chars, letter + digit).

CLI path: `npx wrangler login` → `npm run setup` → `npm run deploy`. Details in the [deployment guide](docs/DEPLOYMENT.md#c--wrangler-cli-workers-recommended-for-cli-users).

### Quickstart (Pages)

`npm run build` → upload `dist` (contains `_worker.js`) via Pages Direct Upload → bind KV `QPROXY_KV` → redeploy → visit the Pages URL once. See [docs/DEPLOYMENT.md § D](docs/DEPLOYMENT.md#d--pages-advanced-mode-dashboard) and [§ E](docs/DEPLOYMENT.md#e--wrangler-pages-cli-pages).

## Subscription Types

Two kinds of subscription URLs exist. They differ in where tunnel traffic goes:

| | Worker subscriptions | WARP subscriptions |
|--|---------------------|--------------------|
| URLs | `/{sp}/sub` and `/{sp}/sub/u/{token}` | `/{sp}/sub/wg/{token}/{format}` |
| Content | VLESS/VMess/Trojan/SS nodes that tunnel through the Worker | WireGuard/WARP configs generated from registered devices |
| Tunnel traffic | Through the Worker — consumes the free-tier 100k requests/day Workers budget | Direct to Cloudflare's WARP network — no Worker request quota used |
| Formats | 5 (base64, clash, singbox, surge, loon) | 17 (WireGuard conf/URI, Amnezia variants, Throne, v2rayN, sing-box, Xray, Clash, Surge, Surfboard, Loon, Egern) |

## Security Model

- Panel password stored as PBKDF2-SHA256 (100k iterations, 16-byte salt); constant-time verification.
- Sessions are stateless HMAC cookies (`q_session`, 7-day, `HttpOnly; Secure; SameSite=Lax`); mutating APIs require the `X-Q-Panel: 1` CSRF header.
- Secrets (`passwordHash`, `passwordSalt`, `sessionSecret`, `telegram.botToken`) never appear in API responses, exports or logs.
- Everything sensitive lives under a regenerable 12-char `securePath`; unknown paths get an identical fake-Cloudflare error page, never a 404.
- The Telegram webhook URL embeds an HMAC-derived secret and answers silently to non-matching calls.

## Client Support

| Client | Import |
|--------|--------|
| v2rayNG / NekoBox / Shadowrocket | `.../sub?target=base64` (or bare `/sub`) |
| Clash Verge / mihomo | `.../sub?target=clash` |
| sing-box (SFA/SFI/SFM) | `.../sub?target=singbox` |
| Surge | `.../sub?target=surge` |
| Loon | `.../sub?target=loon` |
| Any browser | `/{sp}/sub` returns an info page with copy/QR per format |
| Official WireGuard apps | `.../sub/wg/{token}/wireguard-conf` (zip import) |
| AmneziaWG apps | `.../sub/wg/{token}/wireguard-conf-amnezia` |
| Throne / Hiddify-family | `.../sub/wg/{token}/throne` |
| v2rayN | `.../sub/wg/{token}/v2rayn` |
| sing-box | `.../sub/wg/{token}/singbox` |
| Xray-core | `.../sub/wg/{token}/xray` |
| Clash.Meta / mihomo | `.../sub/wg/{token}/clash` |
| Surge / Surfboard | `.../sub/wg/{token}/surge` / `surfboard` |
| Loon / Egern | `.../sub/wg/{token}/loon` / `egern` |

All 17 WARP format slugs are listed in `src/warp/formats/registry.ts`.

## Commands

| Command | What it does |
|---------|--------------|
| `npm install` | Installs dev dependencies only (no runtime deps) |
| `npm run typecheck` | `tsc --noEmit` — must pass before commit |
| `npm test` | Runs all 763 tests (unit + workers projects) |
| `npm run build` | Bundles to `dist/q-proxy.js` + `dist/_worker.js` (~400 KB) |
| `npm run setup` | Create KV namespace, patch `wrangler.toml`, build |
| `npm run dev` | Local Workers dev at `http://127.0.0.1:8787` (miniflare KV) |
| `npm run dev:pages` | Local Pages dev at `http://127.0.0.1:8787` (`pages dev dist`) |
| `npm run deploy` | Build + deploy Worker (prefers `wrangler.local.toml` when present) |
| `npm run deploy:pages` | Build + deploy Pages (`pages deploy dist`) |
| `npm run version` | Print version derived from git tags |
| `npm run release` | Tag + changelog check + build gate |

## Architecture

One-admin, one-KV, one-file Worker (see `docs/ARCHITECTURE.md` for frozen contracts). Expensive choices are recorded in [docs/decisions/](docs/decisions/): single-file zero-deps, KV-only 60s cache, stateless HMAC sessions, pure emitters, hand-rolled X25519.

## License

MIT — clean-room implementation; no code copied from BPB, edgetunnel or nahan.
