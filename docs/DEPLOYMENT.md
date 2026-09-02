# Deployment

All supported deploy paths — pick the one that fits your environment.

## Way 1 — Manual (dashboard, no CLI)

1. Download [`q-proxy.js`](https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js)
2. Dashboard → **Workers & Pages** → Create Worker `q-proxy` → paste → Save
3. **Settings** → **Bindings** → Add KV `QPROXY_KV` → Create namespace → Save → Deploy
4. Visit `https://q-proxy.<sub>.workers.dev/`
5. KV → View `qproxy:settings` → copy `securePath` → open `https://.../<sp>/panel`

Update: re-download from Releases → paste → Save and deploy. KV migrates automatically.

## Way 2 — Automatic one-liner (no wrangler, no node, no git)

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
3. Creates KV, downloads `q-proxy.js` from Releases (falls back to GitHub raw on default branch with master/main fallback), uploads Worker (multipart), seeds with 2s KV propagation wait, sets password
4. Prints `Panel: https://.../<sp>/panel`

Flags: `--token <token>` `--email <email>` `--password <pass>` `--dry`  
Actions (bash): `--action deploy|update|list-kv|remove-kv|status|seed|set-password`  
Actions (PowerShell): `-Action deploy|update|list-kv|remove-kv|status|seed|set-password` `-Title <kv-title>` `-Dry`

The one-liner detects the default branch via `https://api.github.com/repos/QMahyar/q-proxy` and falls back to `master` → `main` to avoid hard-coded branch failures.

## Way 3 — Local npm (developer machine)

### `npm run deploy` — direct Cloudflare API (no wrangler)

```bash
npm ci
npm run build          # builds dist/q-proxy.js + dist/_worker.js
npm run deploy         # → node scripts/deploy-direct.mjs
# or: node scripts/deploy-direct.mjs --dry
# or: CLOUDFLARE_API_TOKEN=xxx npm run deploy
```

Uses the same direct-API flow as Way 2 but from your local `dist/q-proxy.js` if present (otherwise downloads from Releases → default-branch raw). Creates/reuses KV `q-proxy-QPROXY_KV`, uploads Worker, waits 2s for KV eventual consistency, seeds `/`, reads `securePath`, optionally sets password via `POST /<sp>/api/auth/setup`, prints Panel URL. Supports `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` env vars. Default branch is auto-detected (API → master → main).

### `npm run deploy:pages` — Cloudflare Pages Advanced Mode

```bash
npm run build
npx wrangler pages deploy dist --project-name=q-proxy
# or add to package.json: "deploy:pages": "wrangler pages deploy dist --project-name=q-proxy"
```

Deploys `dist/_worker.js` (Pages Advanced Mode, same bundle as Workers). KV binding must exist (create via dashboard or `npx wrangler kv namespace create QPROXY_KV`). Pages project `q-proxy` is created on first deploy.

### `wrangler deploy` with `wrangler.local.toml`

For private credentials/config that should not be committed:

```bash
cp wrangler.toml wrangler.local.toml   # gitignored
# edit wrangler.local.toml → set kv_namespaces id to your real KV id
npx wrangler deploy --config wrangler.local.toml
```

If you see `KV namespace id is not valid` / `REPLACE_WITH_YOUR_KV_ID` error, the placeholder in `wrangler.toml` is still set — either run `npm run deploy` (creates KV automatically), create a KV via `npx wrangler kv namespace create QPROXY_KV` and replace the `id`, or use `wrangler.local.toml` as above. See `wrangler.toml` header comments for details.

### `scripts/deploy.ps1` locally

```powershell
# interactive
powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1
# non-interactive
powershell -File scripts/deploy.ps1 -Token $env:CLOUDFLARE_API_TOKEN -Password "s3curePass1"
# dry run
powershell -File scripts/deploy.ps1 -Dry
# other actions
powershell -File scripts/deploy.ps1 -Action status
powershell -File scripts/deploy.ps1 -Action update
```

Same flow as `deploy.sh` / `deploy-direct.mjs`: auto-detect default branch, create KV, download worker, upload, seed with 2s KV consistency wait, print Panel URL. Also supports `-Title` for multi-project KV titles.

## KV propagation

All deploy paths wait **2s after seeding `https://<worker>/`** before reading `qproxy:settings` — KV is eventually consistent. The 2s value is unified across `scripts/deploy-direct.mjs` (was 1.5s), `scripts/deploy.sh` and `scripts/deploy.ps1` (`sleep 2` / `Start-Sleep -Seconds 2`). If `securePath` still reads empty, retry after a few seconds or read via `npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV --remote`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `KV namespace id is not valid` / `REPLACE_WITH_YOUR_KV_ID` | Create KV (`npx wrangler kv namespace create QPROXY_KV`) and replace `id` in `wrangler.toml` or `wrangler.local.toml`, or just use `npm run deploy` which creates it via API |
| `key not found` reading settings | `curl https://<worker>/` then retry after 2–3s (eventual consistency) |
| Panel 404 | `securePath` is 12 hex chars, case-sensitive — re-read from KV `qproxy:settings → data.securePath` |
| Subdomain not found | Worker → Settings → Triggers → enable `*.workers.dev` or call `GET /accounts/{id}/workers/subdomain` via API |
| `deploy.sh: Download failed` | Releases may not exist yet — raw fallback auto-tries default branch → master → main |
