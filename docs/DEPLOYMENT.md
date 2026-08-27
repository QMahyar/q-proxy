# Deployment Guide

> How to deploy Q Proxy to your own Cloudflare account. Works on both Cloudflare Workers and Cloudflare Pages. Pick one path. All paths produce the same single-file bundle (`dist/q-proxy.js` for Workers, `dist/_worker.js` for Pages).

Related: [USER_GUIDE.md](USER_GUIDE.md) (panel tour, subscriptions, troubleshooting) · [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) (contributing) · [ARCHITECTURE.md](ARCHITECTURE.md) (frozen contracts).

## Before you start

| Requirement | Notes |
|-------------|-------|
| Cloudflare account | Free tier works. One KV namespace is the only resource. `npx wrangler whoami` verifies login. |
| Node 20+ · npm | Only for CLI builds. Dashboard paste needs no local toolchain. `node -v` |
| Git (optional) | Only for the Deploy Button and Workers Builds paths. |

No runtime `dependencies`. `package.json` lists `devDependencies` only. The build rejects any bare import except `cloudflare:*`.

The bundle requires one binding:

```toml
[[kv_namespaces]]
binding = "QPROXY_KV"
id = "REPLACE_WITH_YOUR_KV_ID"
```

`wrangler.toml` ships with the placeholder above. Replace it after you create the namespace. For local overrides, put your real id in `wrangler.local.toml` (gitignored). `npm run deploy` prefers `wrangler.local.toml` when it exists. `scripts/deploy.mjs` refuses to deploy while the placeholder remains and tells you to run `npm run setup`.

## Build artifact

`npm run build` reads `src/worker.ts` and writes two identical files:

| File | Use |
|------|-----|
| `dist/q-proxy.js` | Workers — `wrangler.toml` `main` |
| `dist/_worker.js` | Pages — Advanced Mode (`_worker.js` in the output directory) |

Both are ESM, `target: es2023`, minified, ~380 KB. `scripts/build-single-file.mjs` copies `q-proxy.js` to `_worker.js` so you never build twice. `wrangler dev` and `wrangler pages dev` both read the built file, not the source. Rebuild after every source edit.

## Choose a deployment path

| Path | Time | Needs Node | Creates KV for you | Best for |
|------|------|------------|--------------------|----------|
| **A · Deploy Button** (Workers) | 2 min | No | Yes | First deploy without CLI |
| **B · Dashboard paste** (Workers) | 3 min | Only for `npm run build` | You create in dashboard | No CLI, maximum control |
| **C · Wrangler CLI** (Workers) | 5 min | Yes | `npm run setup` automates it | Repeatable, CI-friendly |
| **D · Pages Advanced Mode** (Dashboard) | 4 min | Only for build | You create in dashboard | You already use Pages |
| **E · Wrangler Pages** (`pages deploy`) | 5 min | Yes | You create via CLI or dashboard | Pages + CLI workflow |
| **F · Setup script** | 5 min | Yes | Yes | CLI users who want one command |
| **G · Git-connected Workers Builds** | 5 min + push | No (after connect) | Automatic on first build | Auto-deploy on every git push |

Cloudflare recommends Workers for new projects. Pages is in maintenance mode but remains available via Advanced Mode and continues to run the same Worker code.

---

## A · Deploy Button (Workers, one click)

Use this when you want zero local setup. The button forks the repository to your GitHub account, provisions the KV namespace, and enables Workers Builds.

1. Fork this repository to your GitHub account (the button will also fork if needed).
2. Add the button to your README or open it directly:

   ```md
   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<your-user>/Q-Proxy)
   ```

   Replace `<your-user>/Q-Proxy` with the fork URL. When the repo is public, use it as the template.

3. Click the button. On the setup page you choose the repository name, Worker name, and KV namespace name. Cloudflare provisions `QPROXY_KV` automatically.

4. Wait for the build (`npm run build` runs in Workers Builds, then `wrangler deploy`). The first request seeds settings.

5. Read the next section ["After deploy"](#after-deploy-seed--secure-path) to open the panel.

Deploy Buttons only support Workers, not Pages. The button appears in the Worker detail page under Share if you already deployed via Workers Builds.

---

## B · Dashboard paste (Workers, no CLI deploy)

You build locally, then paste in the Cloudflare dashboard.

```bash
git clone https://github.com/<your-user>/Q-Proxy.git
cd Q-Proxy
npm install
npm run build
# verify dist/q-proxy.js exists, ~380 KB
```

In the dashboard:

1. Go to **Workers & Pages** → **Create application** → **Create Worker** → name it `q-proxy`.
2. Click **Edit code**. Delete the placeholder, paste the entire `dist/q-proxy.js`, click **Save and deploy**.
3. Go to **Settings** → **Bindings** → **Add binding** → **KV Namespace**. Set **Variable name** to `QPROXY_KV`. Click **Create namespace** (name it `qproxy` or any name), then bind it.
4. Click **Deploy**.
5. Visit any URL of the Worker once (for example `https://q-proxy.<subdomain>.workers.dev/`). This seeds `qproxy:settings` in KV.
6. Continue at [After deploy](#after-deploy-seed--secure-path).

To update later, run `npm run build` again, paste the new `dist/q-proxy.js`, and click **Save and deploy**. KV data migrates automatically (`src/settings/migrate.ts`).

---

## C · Wrangler CLI (Workers, recommended for CLI users)

Auth options (pick one):

| Method | Command or env |
|--------|----------------|
| OAuth (recommended) | `npx wrangler login` → `npx wrangler whoami` |
| API Token | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| Global API Key | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` + `CLOUDFLARE_ACCOUNT_ID` |

If you use a `cfk_` Global Key with `CLOUDFLARE_API_TOKEN`, deployment fails `[code: 9109] Invalid access token`. Use `CLOUDFLARE_API_KEY` for that key type.

### C1 · Automated (setup script)

```bash
git clone https://github.com/<your-user>/Q-Proxy.git
cd Q-Proxy
npm install
npx wrangler login          # or export CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npm run setup               # creates KV, patches wrangler.toml, builds
npm run deploy              # build + wrangler deploy
```

`npm run setup` does three things: `wrangler kv namespace create QPROXY_KV`, replaces `REPLACE_WITH_YOUR_KV_ID` in `wrangler.toml`, and runs `npm run build`. Pass `--dry` to preview: `node scripts/setup.mjs --dry`.

### C2 · Manual

```bash
npx wrangler whoami
npx wrangler kv namespace create QPROXY_KV
# copy the returned id
```

Edit `wrangler.toml`:

```toml
name = "q-proxy"
main = "dist/q-proxy.js"
compatibility_date = "2026-08-01"

[[kv_namespaces]]
binding = "QPROXY_KV"
id = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"
```

If you want to keep the public file untouched, put the real id in `wrangler.local.toml` instead (gitignored):

```toml
name = "q-proxy"
main = "dist/q-proxy.js"
compatibility_date = "2026-08-01"

[[kv_namespaces]]
binding = "QPROXY_KV"
id = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"
```

Then:

```bash
npm run build
npm run deploy              # refuses while the placeholder remains
# or directly:
npx wrangler deploy --config wrangler.toml
# local preview (in-memory KV):
npm run dev                 # http://127.0.0.1:8787
# remote preview (real KV):
npx wrangler dev --remote
```

If `wrangler dev` wedges (accepts connections, never responds), kill the stray `workerd` process and retry on another port: `npx wrangler dev --port 8788`.

---

## D · Pages Advanced Mode (Dashboard)

Use this only if you prefer Pages. Workers and Pages run the same `src/worker.ts` code. Pages Advanced Mode routes every request through `dist/_worker.js`.

1. Build locally:

   ```bash
   npm install
   npm run build          # writes dist/_worker.js
   ```

2. Create a KV namespace: **Workers & Pages** → **KV** → **Create namespace** → name `qproxy-pages` (any name).

3. Create the Pages project: **Workers & Pages** → **Create application** → **Pages** → **Direct Upload** (or **Upload assets**) → name `q-proxy`.

4. Upload the `dist` directory. Ensure `_worker.js` is at the root of the upload (not nested). The output directory is `dist`. No build command is needed because you already built.

5. After the upload, go to **Settings** → **Bindings** → **Add binding** → **KV Namespace** → **Variable name** `QPROXY_KV` → select the namespace you created → **Save**.

6. Redeploy (upload `dist` again, or trigger a retry) so the new binding takes effect. Pages requires a redeploy after adding a binding.

7. Visit the Pages URL once to seed, then continue at [After deploy](#after-deploy-seed--secure-path).

For Pages via **Git integration** (automatic deploys on push): create the project as **Pages** → **Connect to Git** → pick the repository → set **Build command** to `npm run build` and **Build output directory** to `dist`. Add the KV binding as above. The `_worker.js` file in `dist` is picked up automatically. The `/functions` directory is ignored when `_worker.js` exists.

---

## E · Wrangler Pages (CLI, Pages)

```bash
npm install
npm run build
npx wrangler login
npx wrangler kv namespace create QPROXY_KV
# note the id for dashboard binding, or add via config:
```

Pages KV bindings are configured in the dashboard or in a Wrangler configuration file via `kv_namespaces` and `pages_build_output_dir`. Minimal `wrangler.toml` for `wrangler pages deploy`:

```toml
name = "q-proxy"
pages_build_output_dir = "dist"

[[kv_namespaces]]
binding = "QPROXY_KV"
id = "your-kv-id"
```

Deploy:

```bash
# first-time project creation (if not yet created in dashboard):
npx wrangler pages project create q-proxy --production-branch main

# deploy the built output:
npm run deploy:pages
# or explicitly:
npx wrangler pages deploy dist --project-name=q-proxy
```

The helper `npm run deploy:pages` runs `npm run build` and then `wrangler pages deploy dist`. Set `PAGES_PROJECT_NAME` to override the project name: `PAGES_PROJECT_NAME=q-proxy npm run deploy:pages`.

If the Pages project was created in the dashboard, you can also bind KV there instead of in the config file — either place works. After adding a binding via the dashboard, redeploy once.

Local Pages development:

```bash
npm run dev:pages        # wrangler pages dev dist
# with KV:
npx wrangler pages dev dist --kv=QPROXY_KV
```

---

## F · Setup script (reference)

`scripts/setup.mjs` automates path C. It verifies auth (`wrangler whoami`), creates the namespace, patches `wrangler.toml`, and builds.

```bash
node scripts/setup.mjs --help
node scripts/setup.mjs --dry     # preview without side effects
npm run setup                    # execute
```

`scripts/deploy.mjs` builds, checks that the placeholder is replaced, and runs `wrangler deploy --config wrangler.toml` (or `wrangler.local.toml` if present). `scripts/deploy-pages.mjs` does the same for Pages.

---

## G · Git-connected Workers Builds (CI/CD)

Connect your fork to Workers Builds for automatic deploys.

1. Push the fork to GitHub.
2. In the dashboard: **Workers & Pages** → **Create application** → **Workers** → **Import a repository** → authorize GitHub → pick the fork.
3. Set:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Cloudflare provisions the KV namespace on the first build if `wrangler.toml` declares `kv_namespaces` with the `QPROXY_KV` binding. If the build fails with `[code: 10014] a namespace with this account ID and title already exists`, reuse the existing id: run `npx wrangler kv namespace list`, copy the id, and commit it to `wrangler.toml`.
5. Every push to the production branch rebuilds and deploys. Pull requests get preview URLs when preview builds are enabled.

Secrets (if you add any) go in **Settings** → **Variables and Secrets**, not in `wrangler.toml`. Q Proxy needs no secrets — everything lives in KV.

---

## After deploy: seed + secure path

All deployment paths converge here.

1. Visit any URL of your Worker or Pages deployment once. For example:

   ```
   https://q-proxy.<your-subdomain>.workers.dev/
   https://q-proxy.pages.dev/
   ```

   The first request seeds `qproxy:settings` in KV (`src/settings/store.ts` → `src/settings/seed.ts`).

2. Read the `securePath` (12 hex chars). Two ways:

   - **Dashboard KV viewer:** Workers & Pages → your Worker or Pages project → **Settings** → **Bindings** → **KV Namespace** → **View** → key `qproxy:settings` → JSON field `data.securePath`.
   - **CLI:**

     ```bash
     npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV --preview false
     # look for "securePath": "a1b2c3d4e5f6"
     # with remote (production) binding explicitly:
     npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV --remote
     ```

3. Open the panel:

   ```
   https://q-proxy.<subdomain>.workers.dev/<securePath>/panel
   ```

   The first-run wizard asks for a password (8+ characters, at least one letter and one digit). It is stored as PBKDF2-SHA256, 100k iterations, 16-byte salt. The wizard is only available while `passwordHash` is null.

4. After login, the panel shows subscription URLs and settings. Keep the full `https://<host>/<securePath>` URL — rotating the path invalidates every client config.

---

## KV details

| Topic | Workers | Pages |
|-------|---------|-------|
| Where to create | `npx wrangler kv namespace create QPROXY_KV` or dashboard **Workers & Pages** → **KV** → **Create namespace** | Same command or dashboard **Workers & Pages** → **KV** → **Create namespace** |
| Where to bind | `wrangler.toml` `[[kv_namespaces]] binding = "QPROXY_KV"` or dashboard **Worker** → **Settings** → **Bindings** | Dashboard **Pages project** → **Settings** → **Bindings** → **Add** → **KV Namespace**, or `wrangler.toml` with `pages_build_output_dir` |
| Binding name | `QPROXY_KV` exactly. Mismatch returns a binding error. | Same. `src/types/env.ts` freezes the name. |
| When binding takes effect | Next `wrangler deploy` or dashboard Save | Next Pages deployment (re-upload `dist` after adding) |
| Local dev id | Any placeholder works with `wrangler dev` (in-memory KV). Use a real id only with `wrangler dev --remote`. | `wrangler pages dev dist --kv=QPROXY_KV` uses in-memory KV unless `--remote` or real binding. |
| Preview vs production | Optional `preview_id` in `wrangler.toml` points `wrangler dev --remote` and preview deployments at a separate namespace. | `[env.preview.kv_namespaces]` in `wrangler.toml` overrides the production id for preview. |

All keys use the `qproxy:` prefix. Do not rename them. Do not share the KV namespace between two deployments.

---

## Custom domains

Workers: **Worker** → **Settings** → **Triggers** → **Custom Domains** → **Add Custom Domain**. Point the hostname to the proxied (orange cloud) DNS record. After adding, set **Settings → Routing → hostnameOverride** or **customDomains** in the Q Proxy panel to emit nodes with that hostname.

Pages: **Pages project** → **Custom domains** → **Set up a custom domain**. The same panel settings control the emitted SNI and host.

TLS nodes use ports `443,2053,2083,2087,2096,8443`. Plain nodes use `80,8080,8880,2052,2082,2086,2095`. The port family must match `security` (enforced in `src/nodes/generate.ts`). Fragment nodes are TLS-only.

---

## Update, backup, and reset

### Update

| Deployment type | Command |
|-----------------|---------|
| Dashboard paste (Workers or Pages) | `npm run build` → paste `dist/q-proxy.js` or re-upload `dist` |
| Wrangler Workers | `npm run deploy` |
| Wrangler Pages | `npm run deploy:pages` |
| Deploy Button / Workers Builds | `git push` to the production branch |

`SETTINGS_VERSION` is `1`. On write, `src/settings/migrate.ts` deep-merges stored settings over a clone of `DEFAULT_SETTINGS` and runs any pending migrations. Unknown keys are preserved on downgrade.

### Backup and restore

**Export** (authenticated): `GET /{securePath}/api/settings/export` — returns secrets-stripped JSON. The panel has an Export button on the settings page.

**Import**: `POST /{securePath}/api/settings/import` with the exported file. The handler checks `version` and validates every field (`src/settings/validate.ts`).

**Full KV dump** (CLI):

```bash
npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV --remote > backup.json
```

To restore on a new deployment, deploy first, complete the first-run wizard, then import the exported JSON.

### Reset

Panel → **Settings** → **Reset** (`POST /{securePath}/api/settings/reset`) restores defaults but keeps identity fields (`securePath`, UUIDs, `sessionSecret`, password).

To remove all data, delete keys that start with `qproxy:` in the KV viewer, or delete the KV namespace itself.

---

## Local configuration files

| File | Tracked | Purpose |
|------|---------|---------|
| `wrangler.toml` | Yes | Public template. Placeholder `REPLACE_WITH_YOUR_KV_ID`. Commit this. |
| `wrangler.local.toml` | No (gitignored) | Your local override with the real id. `npm run deploy` prefers it when present. |
| `.dev.vars` | No (gitignored) | Local secrets for `wrangler dev --remote`. No secrets required by Q Proxy. |
| `.dev.vars.example` | Yes | Template. Copy to `.dev.vars` if you need remote dev. |
| `dist/` | No (gitignored) | Build output. Regenerate with `npm run build`. |

Never commit `wrangler.local.toml`, `.dev.vars`, or a `wrangler.toml` that contains a real KV id when contributing to the public repository.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `REPLACE_WITH_YOUR_KV_ID` error on deploy | Placeholder not replaced | `npx wrangler kv namespace create QPROXY_KV` → copy id → paste into `wrangler.toml` → `npm run setup` |
| `wrangler whoami` shows no account | Not logged in | `npx wrangler login` or set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| `[code: 9109] Invalid access token` with `cfk_` | Global Key passed as `CLOUDFLARE_API_TOKEN` | Use `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` + `CLOUDFLARE_ACCOUNT_ID` |
| `No KV Namespaces configured` | Binding not in config file used by the command | Ensure `[[kv_namespaces]] binding = "QPROXY_KV"` is top-level in the `wrangler.toml` you pass with `--config` |
| Secure path 404 after deploy | KV not seeded or wrong path | Visit the worker root URL once to seed. Read `qproxy:settings` → `data.securePath`. Paths are case-sensitive. |
| `wrangler dev` serves old code | `dist/q-proxy.js` stale | `npm run build` before `wrangler dev`. `npm run dev` does both. |
| `workerd` wedged (accepts, never responds) | Stale miniflare session | Kill the `workerd` process, retry on another port: `npx wrangler dev --port 8788` |
| Pages binding not visible | Project not redeployed | After adding the KV binding in dashboard, re-upload `dist` or `npx wrangler pages deploy dist` |
| `a namespace with this account ID and title already exists [code: 10014]` | Namespace already exists (Workers Builds) | Reuse it: `npx wrangler kv namespace list` → copy id → put it in `wrangler.toml` |

For panel and subscription issues, see [USER_GUIDE.md §6](USER_GUIDE.md#6-troubleshooting). Enable `debugLogging` in Settings and run `npx wrangler tail` for structured logs (`src/core/log.ts`). Never log `passwordHash`, `passwordSalt`, `sessionSecret`, or `telegram.botToken` — the logger redacts them.

---

## Before going public: sanitize the repository

Current files contain no secrets. `wrangler.toml` ships with `REPLACE_WITH_YOUR_KV_ID`. Local overrides live in `wrangler.local.toml` and `.dev.vars` (both gitignored). `.dev.vars.example` is the tracked template.

Before you push a fork as a public template, do three checks.

### 1 · Check the working tree

```bash
git ls-files | xargs grep -l "REPLACE_WITH_YOUR_KV_ID"   # should show only wrangler.toml and docs
git status                                                # wrangler.local.toml and .dev.vars must not appear
# if you know a previous personal id or worker URL, search for it:
# grep -r "YOUR_KV_ID\|YOUR_ACCOUNT_ID\|YOUR_WORKER_URL" . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.wrangler
```

If the last command prints matches, remove them. Rotate the leaked value (delete the KV namespace and create a new one, regenerate the `securePath` via **Settings → Reset** or by deleting `qproxy:settings`).

### 2 · Check git history

The placeholder was added in `175e1cf`. Earlier history (`1f6f753`) still stores the original KV id, Account ID, worker URL, `securePath`, and vault paths. That history will become public when you push.

To rewrite it locally, pick one method.

**Option A — start a clean history (simplest, keeps only the public state):**

```bash
# from the repo root
git checkout --orphan public-main
git add -A
git commit -m "chore: public release — clean history, placeholder KV id"
git branch -D master
git branch -m public-main master
# then: git push -f origin master  (only if the remote is your new public fork)
```

You lose old history but guarantee no leak. Tag `v1.1.0` again if needed.

**Option B — filter the existing history (keeps commits, rewrites hashes):**

```bash
# install git-filter-repo once: pip install git-filter-repo

# discover the values you need to scrub (run in the original repo before you push it public):
git log -S "REPLACE_WITH" --all -p | head -n 100   # look for KV ids, account ids, worker URLs

# create a replacements file with your real values (use your own ids, not the examples):
cat > /tmp/replacements.txt <<'EOF'
YOUR_KV_NAMESPACE_ID==>REPLACE_WITH_YOUR_KV_ID
YOUR_ACCOUNT_ID==>REPLACE_WITH_ACCOUNT_ID
YOUR_WORKER_URL==>REPLACE_WITH_WORKER_URL
YOUR_SECURE_PATH==>REPLACE_WITH_SECURE_PATH
E:\vault\Platforms\cloudflare\qproxy.md==>REPLACE_WITH_VAULT_PATH
E:\vault\Platforms\cloudflare\platform.md==>REPLACE_WITH_VAULT_PATH
EOF

git filter-repo --replace-text /tmp/replacements.txt --force

# verify (search for the literal prefixes you just replaced):
git log -S "YOUR_KV" --all --oneline   # should print nothing after scrub
git log -S "YOUR_ACCOUNT" --all --oneline

# force-push to your public fork only:
git push -f origin master --tags
```

`git filter-repo` rewrites every commit hash. Do not run it on a branch others already depend on. Coordinate with collaborators or push to a new repository.

### 3 · Remove tracked dev artifacts

`.playwright-mcp/` is now gitignored. If you forked before this change, untrack its old snapshots:

```bash
git rm --cached -r .playwright-mcp/
echo ".playwright-mcp/" >> .gitignore
git commit -m "chore: untrack playwright snapshots"
```

`.wrangler/` and `dist/` are already ignored. Never commit them.
