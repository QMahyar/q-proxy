# Deployment

All supported deploy paths — pick the one that fits your environment.

## Way 1 — Manual (dashboard, no CLI)

1. Download [`q-proxy.js`](https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js)
2. Dashboard → **Workers & Pages** → Create Worker `q-proxy` → paste → Save
3. **Settings** → **Bindings** → Add KV `QPROXY_KV` → Create namespace → Save → Deploy
4. **Settings** → **Bindings** → Add D1 `QPROXY_DB` → Create database `q-proxy` → apply `migrations/0001_init.sql` (dashboard SQL console or `npx wrangler d1 migrations apply q-proxy --remote`, see [D1 database](#d1-database) below) → Save → Deploy
5. Visit `https://q-proxy.<sub>.workers.dev/`
6. KV → View `qproxy:settings` → copy `securePath` → open `https://.../<sp>/panel`

Update: re-download from Releases → paste → Save and deploy. KV migrates automatically; D1 schema is created by the migration file (re-applying is idempotent — `CREATE TABLE IF NOT EXISTS`).

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

D1 is not provisioned by the one-liners — after the script finishes, create the `q-proxy` database, apply `migrations/0001_init.sql`, and add the `QPROXY_DB` binding via the dashboard (Worker → Settings → Bindings), as described in [D1 database](#d1-database) below. Bind D1 last: re-running the script's upload would replace the binding list with KV-only. Until D1 is bound, the worker falls back to KV for users/counters/audit state.

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

Uses the same direct-API flow as Way 2 but from your local `dist/q-proxy.js` if present (otherwise downloads from Releases → default-branch raw). Creates/reuses KV `q-proxy-QPROXY_KV`, creates/reuses D1 database `q-proxy` and applies `migrations/0001_init.sql`, uploads Worker with KV + D1 bindings, waits 2s for KV eventual consistency, seeds `/`, reads `securePath`, optionally sets password via `POST /<sp>/api/auth/setup`, prints Panel URL. Supports `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` env vars (API tokens need Workers Scripts:Edit + Workers KV Storage:Edit + D1:Edit). Default branch is auto-detected (API → master → main). If D1 setup fails the deploy continues KV-only with a warning — the worker falls back to KV until D1 is configured.

### `npm run deploy:pages` — Cloudflare Pages Advanced Mode

```bash
npm run build
npx wrangler pages deploy dist --project-name=q-proxy
# or add to package.json: "deploy:pages": "wrangler pages deploy dist --project-name=q-proxy"
```

Deploys `dist/_worker.js` (Pages Advanced Mode, same bundle as Workers). KV binding must exist (create via dashboard or `npx wrangler kv namespace create QPROXY_KV`). The D1 database must exist too — create it once and bind it to the Pages project (dashboard → Pages project → Settings → Bindings → Add D1 `QPROXY_DB` → `q-proxy`), then apply the migration (see [D1 database](#d1-database) below). Pages project `q-proxy` is created on first deploy.

### `wrangler deploy` with `wrangler.local.toml`

For private credentials/config that should not be committed:

```bash
cp wrangler.toml wrangler.local.toml   # gitignored
# edit wrangler.local.toml → set kv_namespaces id to your real KV id
#                            → set [[d1_databases]] database_id to your real D1 id (same stanza shape as wrangler.toml)
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

## D1 database

Write-hot state (users directory, per-user quota/activity/totals, global counters, audit log) lives in D1 (`QPROXY_DB`); settings, WARP store, and throttle/session/ratelimit keys stay on KV. Every deploy path needs the database plus the schema in `migrations/0001_init.sql` — only `npm run deploy` does both automatically.

| Path | D1 creation | Migration | Binding |
|------|-------------|-----------|---------|
| Manual (dashboard) | Dashboard → D1 → Create `q-proxy` | Paste `migrations/0001_init.sql` into the database SQL console, or run the wrangler command below | Worker → Settings → Bindings → Add D1 `QPROXY_DB` |
| One-liner (`deploy.sh` / `deploy.ps1`) | Dashboard → D1 → Create `q-proxy` (script uploads KV-only bindings) | Dashboard SQL console or the wrangler command below | Dashboard → Worker → Settings → Bindings → Add D1 `QPROXY_DB` **after** the script finishes (re-running the upload would drop it) |
| `npm run deploy` (`deploy-direct.mjs`) | Automatic (create-or-reuse `q-proxy`; needs D1:Edit on the token) | Automatic (`migrations/0001_init.sql`, single-query with batch fallback) | Automatic on upload |
| Pages | `npx wrangler d1 create q-proxy` (or dashboard D1) | `npx wrangler d1 migrations apply q-proxy --remote` | Pages project → Settings → Bindings → Add D1 `QPROXY_DB` |
| Deploy Button / Git-connected builds | Create `q-proxy` in the dashboard beforehand | Apply via dashboard SQL console or `npx wrangler d1 migrations apply q-proxy --remote` | Configure the `QPROXY_DB` binding on the project |
| `wrangler deploy` | `npx wrangler d1 create q-proxy`, then set `database_id` in `wrangler.toml` (or gitignored `wrangler.local.toml`, same `[[d1_databases]]` stanza) | `npx wrangler d1 migrations apply q-proxy --remote` (repeat `--local` instead for local dev) | Via `wrangler.toml` / `wrangler.local.toml` |

```bash
npx wrangler d1 create q-proxy
# copy database_id → wrangler.toml [[d1_databases]] (or wrangler.local.toml)
npx wrangler d1 migrations apply q-proxy --remote   # applies migrations/0001_init.sql
```

Re-applying is safe (`CREATE TABLE IF NOT EXISTS`). On first boot with D1 bound, the worker copies any legacy KV user/counter keys into D1 once (guard row `meta.kv_migrated_v1`) and deletes the legacy keys — pre-D1 deploys upgrade without data loss.

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
