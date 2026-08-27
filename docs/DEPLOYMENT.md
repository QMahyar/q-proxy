# Deployment

Two ways. No `wrangler`, no `git`.

## Way 1 — Manual (dashboard)

1. Download [`q-proxy.js`](https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js)
2. Dashboard → **Workers & Pages** → Create Worker `q-proxy` → paste → Save
3. **Settings** → **Bindings** → Add KV `QPROXY_KV` → Create namespace → Save → Deploy
4. Visit `https://q-proxy.<sub>.workers.dev/`
5. KV → View `qproxy:settings` → copy `securePath` → open `https://.../<sp>/panel`

Update: re-download from Releases → paste → Save and deploy. KV migrates automatically.

## Way 2 — Automatic (one command)

**Bash (macOS/Linux/WSL):**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/master/scripts/deploy.sh)
```

**PowerShell (Windows):**
```powershell
irm https://raw.githubusercontent.com/QMahyar/q-proxy/master/scripts/deploy.ps1 | iex
```

No node, no git, no wrangler. Just shell + curl/web requests (built-in).

The script:
1. Opens a pre-filled [token link](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all) — create token, paste back
2. Detects Global Key (`cfk_...`) → asks email; API Token → skips
3. Creates KV, downloads `q-proxy.js` from Releases, uploads Worker (multipart), seeds, sets password
4. Prints `Panel: https://.../<sp>/panel`

Flags: `--token <token>` `--password <pass>` `--dry`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `key not found` reading settings | `curl https://<worker>/` then retry after 3s |
| Panel 404 | `securePath` is 12 hex chars, case-sensitive |
| Subdomain not found | Worker → Settings → Triggers → enable `*.workers.dev`
