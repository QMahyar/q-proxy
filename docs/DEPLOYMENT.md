# Deployment

Two ways to deploy. Both use the same single file. No runtime deps. One KV namespace.

## Way 1 — Manual (dashboard, no CLI)

| Step | Do |
|------|----|
| 1 | Download [`q-proxy.js`](https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js) from Releases |
| 2 | Dashboard → **Workers & Pages** → **KV** → Create namespace `q-proxy` |
| 3 | **Workers & Pages** → Create Worker `q-proxy` → Edit code → paste → Save |
| 4 | Worker → **Settings** → **Bindings** → Add KV `QPROXY_KV` → select namespace → Save → Deploy |
| 5 | Visit `https://q-proxy.<sub>.workers.dev/` → KV → View `qproxy:settings` → copy `securePath` → open `https://.../<sp>/panel` |

Update: re-download from Releases → paste → Save and deploy. KV migrates automatically.

## Way 2 — Automatic (one command)

```bash
# Bash / macOS / Linux / WSL (from a clone):
node scripts/deploy-direct.mjs

# Node 18+ directly (no clone needed):
npx --yes github:QMahyar/q-proxy#master -- --token <token> --password <pass>
```

The script:
1. Prints a pre-filled [token link](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all) — open it, create token, paste back
2. Detects Global Key (`cfk_...`) → asks email; API Token → skips
3. Asks first password and Workers vs Pages
4. Downloads `q-proxy.js` from Releases, creates KV, uploads Worker (multipart), seeds, sets password
5. Prints `Panel: https://.../<sp>/panel`

Flags: `--token`, `--password`, `--dry`

## After deploy

- Keep the full `https://<host>/<securePath>` URL — rotating it invalidates clients.
- Custom domains: Worker → Settings → Triggers → Custom Domains, or set `hostnameOverride` in panel.
- Backup: Panel → Settings → Export. Restore via Import.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `key not found` reading settings | `curl https://<worker>/` then retry after 3s |
| Panel 404 | `securePath` is 12 hex chars, case-sensitive |
| Subdomain not found | Visit Worker → Settings → Triggers → enable `*.workers.dev`
