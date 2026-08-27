# Q Proxy

Self-hosted Cloudflare Worker proxy panel. VLESS, VMess, Trojan, Shadowsocks over WebSocket. Subscriptions for every major client, WARP/WireGuard configs, per-user links, optional Telegram bot. One file, zero runtime deps, bilingual EN/FA panel.

> **فارسی:** پنل کاملاً دوزبانه است (EN/FA با RTL).

## Deploy

Two ways. No `wrangler`, no `git` needed.

### Way 1 — Manual (dashboard, 3 min)

1. Download [`q-proxy.js`](https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js) from Releases.
2. Cloudflare Dashboard → **Workers & Pages** → Create Worker `q-proxy` → Edit code → paste → Save.
3. **Settings** → **Bindings** → Add KV `QPROXY_KV` → Create namespace → Save → Deploy.
4. Visit `https://q-proxy.<sub>.workers.dev/` once.
5. KV → View `qproxy:settings` → copy `data.securePath` → open `https://.../<sp>/panel` → set password.

### Way 2 — Automatic (one command, 1 min)

**Bash (macOS/Linux/WSL) — no node, no git, just curl:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/master/scripts/deploy.sh)
```

The script prints a pre-filled token link, waits for paste, creates KV, uploads Worker, seeds, sets password, prints `Panel: https://.../<sp>/panel`.

**Node (if you have it):**
```bash
node scripts/deploy-direct.mjs
```

## Commands

| Command | What |
|---------|------|
| `npm run build` | `dist/q-proxy.js` + `dist/_worker.js` (~400 KB) |
| `npm run deploy` | Direct API deploy (no wrangler needed) |
| `npm run dev` | Local dev at `http://127.0.0.1:8787` |
| `npm test` | 763 tests |
| `npm run typecheck` | Type check |

## Docs

| Doc | For |
|-----|-----|
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Full deploy guide |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | Panel tour, client import, troubleshooting |
| [DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Architecture, contributing |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Frozen contracts |
| [CHANGELOG.md](docs/CHANGELOG.md) | Release notes |

## License

MIT
