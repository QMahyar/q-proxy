# Deployment Guide

> Two ways to deploy Q Proxy. Both use the same single-file bundle (`dist/q-proxy.js` for Workers, `dist/_worker.js` for Pages). No runtime dependencies. One KV namespace.

Related: [USER_GUIDE.md](USER_GUIDE.md) (panel tour) · [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) (contributing) · [ARCHITECTURE.md](ARCHITECTURE.md) (frozen contracts).

## Before you start

| Need | Notes |
|------|-------|
| Cloudflare account | Free tier works. |
| API token **or** Global Key | Automatic way will give you a pre-filled link. Manual way needs you to create a KV and paste the worker. |
| `q-proxy.js` | Every tagged release publishes it (`https://github.com/QMahyar/q-proxy/releases` → Assets). No build needed. `npm run build` also writes `dist/q-proxy.js` + `dist/_worker.js`. |

The worker needs one KV binding `QPROXY_KV`. You create it in step 2 of the Manual way. The Automatic way creates it for you.

---

## Way 1 — Manual (5 steps, no CLI)

Do everything in the Cloudflare dashboard. No `wrangler`, no `git`, no `npm`.

| Step | Do |
|------|----|
| 1. Get the worker file | Download `q-proxy.js` from **Releases** (`https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js`) — or run `npm run build` locally and use `dist/q-proxy.js`. |
| 2. Create KV | Cloudflare Dashboard → **Workers & Pages** → **KV** → **Create namespace** → name `q-proxy` → **Create**. Remember the ID. |
| 3. Create Worker | **Workers & Pages** → **Create application** → **Create Worker** → name `q-proxy` → **Edit code** → delete placeholder → paste the entire `q-proxy.js` → **Save**. |
| 4. Bind KV | In the Worker → **Settings** → **Bindings** → **Add binding** → **KV Namespace** → **Variable name** `QPROXY_KV` → select the namespace from step 2 → **Save** → **Deploy**. |
| 5. Seed + Panel | Visit `https://q-proxy.<your-subdomain>.workers.dev/` once (seeds `qproxy:settings`). Then open **Workers & Pages** → **KV** → your namespace → **View** → key `qproxy:settings` → copy `data.securePath` → open `https://q-proxy.<sub>.workers.dev/<securePath>/panel` → set password (8+ chars, letter + digit). Or run `node scripts/post-deploy.mjs https://q-proxy.xxx.workers.dev` to print the Panel URL. |

Update: re-download `q-proxy.js` from Releases → paste again → **Save and deploy**. KV migrates automatically (`src/settings/migrate.ts`). No data loss.

For Pages (Advanced Mode): upload `dist` (contains `_worker.js`) via **Pages** → **Direct Upload** → bind `QPROXY_KV` in **Settings** → **Bindings** → redeploy.

---

## Way 2 — Automatic (one command, no wrangler, no git)

The script downloads `q-proxy.js` from Releases, creates the KV, uploads the Worker via Cloudflare API (`curl`), seeds, reads `securePath`, optionally sets your first password, and prints the Panel link.

It works with **API Token** and **Global Key**. If you paste a Global Key (`cfk_...`) it asks for your email. If you paste a normal API Token it just deploys.

### Pre-filled token link

The script will give you this link and wait for you to paste the token. You don't need to pick permissions — it's pre-filled with **Workers Scripts:Edit** + **Workers KV Storage:Edit**:

```
https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all
```

Open it, click **Continue to summary** → **Create Token** → **Copy**, paste back into the terminal.

### One-liners

Pick the shell you use. All do the same thing — no `wrangler` installed, no repo cloned, just `curl` + `q-proxy.js` from Releases.

**Bash / macOS / Linux / WSL:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.sh)
# with args (non-interactive):
# curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.sh | bash -s -- --token <token> --password <pass>
```

**PowerShell (Windows):**
```powershell
irm https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.ps1 | iex
# with args:
# & ([scriptblock]::Create((irm https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.ps1))) -Token <token> -Password <pass>
```

**Node (if you have Node 18+):**
```bash
npx --yes github:QMahyar/q-proxy#main -- --token <token> --password <pass>
# or from a clone:
node scripts/deploy-direct.mjs --token <token> --password <pass>
# dry run:
node scripts/deploy-direct.mjs --dry
```

**Python (stdlib only):**
```bash
curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/deploy.py | python3 -
# with args:
# curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/deploy.py | python3 - --token <token>
```

### What the script asks

```
Paste API Token or Global Key (cfk_...):  <you paste>
[if Global Key] Cloudflare email:         <you type>
First panel password [empty to set later]: <you type>
Workers or Pages? [Workers]:              <you type>
```

Then it:

1. Resolves `account_id` via `GET /accounts` (or asks if multiple)
2. Creates KV `q-proxy-QPROXY_KV` via `POST /accounts/{id}/storage/kv/namespaces` (or reuses on `10014`)
3. Downloads `q-proxy.js` from Releases (or uses `dist/q-proxy.js` if you run from a clone)
4. Uploads Worker via `PUT /accounts/{id}/workers/scripts/q-proxy` (multipart `metadata` + `q-proxy.js`, `compatibility_date 2026-08-01`, binding `QPROXY_KV`)
5. Enables `*.workers.dev` subdomain if needed
6. `fetch https://q-proxy.<sub>.workers.dev/` to seed `qproxy:settings`
7. Reads `securePath` from `GET /accounts/{id}/storage/kv/namespaces/{kv_id}/values/qproxy:settings`
8. If you gave a password, `POST https://<worker>/<sp>/api/auth/setup {"newPassword":"..."}` to set it
9. Prints:
   ```
   Panel:        https://q-proxy.xxx.workers.dev/<sp>/panel
   Subscription: https://.../<sp>/sub
   ```

No file is changed in your repo. No `wrangler.toml` edit. No `git` needed.

### Already deployed? Just get the Panel URL

```bash
node scripts/post-deploy.mjs https://q-proxy.xxx.workers.dev
# or with token override:
CLOUDFLARE_API_TOKEN=xxx node scripts/post-deploy.mjs https://q-proxy.xxx.workers.dev
```

---

## After deploy

- Keep the full `https://<host>/<securePath>` URL — rotating the path invalidates clients.
- Custom domains: **Worker** → **Settings** → **Triggers** → **Custom Domains** → set `hostnameOverride` or `customDomains` in the Q Proxy panel.
- Update: Automatic way re-runs the same command. Manual way re-pastes `q-proxy.js`.
- Backup: Panel → **Settings** → **Export** (`GET /{sp}/api/settings/export`), restore via **Import**.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No such module: q-proxy.js` on upload | Multipart field name mismatch | Use the provided scripts — they set `main_module` + filename correctly. |
| `already exists [10014]` on KV create | Namespace exists | Script reuses it. Manual: `GET /accounts/{id}/storage/kv/namespaces` → reuse ID. |
| `key not found` reading `qproxy:settings` | KV eventual consistency or not seeded | `curl https://<worker>/` then retry after 3s. Or `npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV --remote`. |
| Panel 404 | Wrong `securePath` | Read `qproxy:settings` → `data.securePath` is 12 hex chars, case-sensitive. |
| Workers.dev subdomain not found | Not enabled | Script enables it via `PUT /accounts/{id}/workers/subdomain {"enabled":true}`. Manual: visit Worker → **Settings** → **Triggers**. |

No `wrangler` is required for either way. If you do use `wrangler`, `npm run quick-deploy` (Node 20+) does the same flow but via `wrangler` API. `npm run dev` still needs `wrangler` for local dev (`http://127.0.0.1:8787`).

## For developers (advanced)

The two ways above are enough for users. If you contribute, you may also use:

- `npm run dev` / `npm run dev:pages` (local miniflare, no KV seed needed — uses in-memory KV)
- `wrangler deploy` / `wrangler pages deploy` (requires `wrangler.toml` with `QPROXY_KV` id)
- `npm run setup` + `npm run deploy` (legacy wrangler path, now superseded by `quick-deploy.sh`)

`wrangler.toml` ships with `REPLACE_WITH_YOUR_KV_ID`. `wrangler.local.toml` (gitignored) overrides it. `scripts/deploy.mjs` now picks the valid file and warns if the other has a placeholder (fix for earlier bug).

---

## Before going public

`wrangler.toml` has a placeholder. Local overrides are gitignored. Before you push a fork as a template:

```bash
git ls-files | xargs grep -l "REPLACE_WITH_YOUR_KV_ID"   # only wrangler.toml and docs
git status                                                # wrangler.local.toml and .dev.vars must not appear
```
