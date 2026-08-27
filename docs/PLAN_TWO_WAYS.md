# Plan: Two Easy Ways (No Wrangler Required)

## Goal
Normal users don't have `wrangler`. Provide exactly two paths:

1. **Manual** — 5 clicks in Cloudflare dashboard, no CLI, no Node, paste `q-proxy.js`
2. **Automatic** — one command (`npm` / `bash` / `powershell` / `python`) that asks for one API token, asks Workers vs Pages, deploys, prints `https://<worker>/<sp>/panel`

Both must work with **Global API Key** (`cfk_...` + email) and **API Token** (`Bearer ...`).

## Why wrangler-free matters
- `wrangler` is a devDependency (4.125, ~50MB, Node 20+). Normal users won't `npm install`.
- Competitors: BPB wizard uses direct CF API (no wrangler), Edgetunnel is paste-only (no build). Q Proxy should match.
- Since `wrangler@4.45` auto-provisions KV, but users on older wrangler still need manual KV. Direct API removes that variance.

## Automatic flow (one command)

```
$ npx q-proxy deploy          # or: npm run quick-deploy
$ bash <(curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.sh)
$ irm https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.ps1 | iex
$ curl -fsSL https://.../deploy.py | python3 -
```

Steps inside the script (no wrangler, only fetch/curl):

1. Detect auth type
   - Input starts with `cfk_` → Global Key → ask `email` + detect `account_id` via `GET /accounts` or ask user
   - Else → API Token → header `Authorization: Bearer <token>`, account_id via `GET /accounts` or ask

2. Ask target
   - `Workers or Pages? [Workers]`
   - Workers → `PUT /accounts/{id}/workers/scripts/q-proxy` (multipart: metadata + `q-proxy.js`)
   - Pages → `POST /accounts/{id}/pages/projects` + upload `dist/_worker.js` (more complex, defer to wrangler for Pages; for now Workers only)

3. Create KV via API
   - `POST /accounts/{id}/storage/kv/namespaces {"title":"q-proxy-QPROXY_KV"}`
   - If `400` already exists, `GET /accounts/{id}/storage/kv/namespaces` and reuse

4. Get script content
   - Prefer local `dist/q-proxy.js` if exists (`npm run build` artifact)
   - Else download from Releases `https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js` (no build needed)
   - Else build via `npx esbuild` if source present

5. Upload Worker via API
   - `PUT /accounts/{id}/workers/scripts/q-proxy`
   - multipart: `metadata={"main_module":"q-proxy.js","compatibility_date":"2026-08-01","bindings":[{"type":"kv_namespace","name":"QPROXY_KV","namespace_id":"<kv_id>"}]}` + `q-proxy.js` as `application/javascript+module`
   - Headers: `X-Auth-Email`+`X-Auth-Key` for Global, `Authorization: Bearer` for Token

6. Enable `*.workers.dev` subdomain if not enabled
   - `GET /accounts/{id}/workers/subdomain` → if not exists, `PUT` to enable

7. Seed and print URL
   - `fetch https://q-proxy.<subdomain>.workers.dev/` (seeds `qproxy:settings`)
   - `GET /accounts/{id}/storage/kv/namespaces/{kv_id}/values/qproxy:settings` via API → parse `securePath`
   - Print:
     ```
     Panel: https://q-proxy.<sub>.workers.dev/<sp>/panel
     Sub:   https://.../<sp>/sub
     ```

8. Handle pre-filled token link
   - If no token given, open browser to:
     ```
     https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all
     ```
   - User creates token, pastes back

## Manual flow (5 steps, no CLI)

1. Download `q-proxy.js` from Releases (or `npm run build` → `dist/q-proxy.js`)
2. Cloudflare Dashboard → Workers & Pages → Create Worker → Edit code → paste → Save
3. Workers & Pages → KV → Create namespace `q-proxy` → Workers & Pages → your Worker → Settings → Bindings → Add KV → `QPROXY_KV` → select namespace → Deploy
4. Visit `https://q-proxy.<sub>.workers.dev/` once (seeds)
5. KV → View `qproxy:settings` → copy `securePath` → open `https://.../<sp>/panel` → set password

Screenshots at each step. No `wrangler`, no env vars.

## Implementation

- `scripts/deploy-direct.mjs` — pure Node `fetch`, no wrangler import, handles both auth types, uses Release artifact fallback
- `scripts/quick-deploy.sh` — bash wrapper `curl -fsSL .../deploy-direct.mjs | node -`
- `scripts/quick-deploy.ps1` — PowerShell wrapper
- `scripts/deploy.py` — Python stdlib `urllib` version
- Update `docs/DEPLOYMENT.md` to exactly two sections: Manual (5 steps) + Automatic (one-liners + token detection)
- Keep `wrangler` for devs (`npm run dev`), but remove it from the user path

## Testing

- Dry run: `node scripts/deploy-direct.mjs --dry --token cfk_*** --email test@example.com`
- Live: use `qhope1@gmail.com` / `qmirror1@gmail.com` accounts (unused) with direct API, no wrangler installed
- Verify panel loads, sub returns base64/clash, no wrangler binary invoked
