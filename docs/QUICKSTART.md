# Q Proxy — Five-Minute Quickstart

From zero to a connected client. No CLI, no Cloudflare account needed upfront.
Every step below is verified against the shipped code — the proof table at the
bottom maps each claim to its source or test.

## Minute 0–2 — Deploy with one click

1. Click **Deploy to Cloudflare** (README badge, or
   `https://deploy.workers.cloudflare.com/?url=https://github.com/QMahyar/q-proxy`).
   It walks you through Cloudflare signup, then deploys the Worker.
2. In the dashboard, add the two bindings the button cannot create
   (Worker → Settings → Bindings → Deploy after each):
   - KV namespace, variable **`QPROXY_KV`**
   - D1 database **`q-proxy`**, variable **`QPROXY_DB`** — then apply both files in
     `migrations/` (`0001_init.sql`, `0002_drop_users.sql`) in the D1 SQL console.
3. Visit `https://<your-worker>.workers.dev/` once (this seeds settings),
   read `data.securePath` from KV key `qproxy:settings`, and open
   `https://<your-worker>.workers.dev/<securePath>/panel`.

Prefer the terminal instead? The same deploy is one command —
`docs/DEPLOYMENT.md` Way 0 (`deploy.py`), Way 1 (dashboard paste),
Way 2 (one-liner), Way 3 (npm/wrangler/Pages). All seven paths are compared
in the [deployment matrix](DEPLOYMENT.md#deployment-matrix).

## Minute 2–3 — Claim the panel

1. The login page shows the **setup card** (open for 24 h after seeding).
   Choose a passphrase: **at least 8 characters, with a letter and a digit**.
   Weaker secrets are rejected with an inline error.
2. Log in, then set a **personal** passphrase when asked (the first one is a
   bootstrap password — the panel stays locked until you change it).
3. A 3-step wizard appears: protocols → your subscription URLs → done.
   It never shows again (replay it anytime from the `?` shortcuts menu).

## Minute 3–5 — Connect your first client

Open the **Subscriptions** hub (`#/subs`) or copy a URL from the wizard.
Pick the row matching your client:

| Client | URL | Format |
|--------|-----|--------|
| v2rayNG / v2rayN / Hiddify / Streisand / Shadowrocket | `/<securePath>/sub?target=base64` | Base64 `vless://` list |
| sing-box / SFA / Karing / NekoBox | `/<securePath>/sub?target=singbox` | sing-box JSON profile |
| Clash Verge / Mihomo / Stash | `/<securePath>/sub?target=clash` | Clash YAML profile |

No `?target=` at all in a phone browser opens an info page with the same
links (plus QR codes in the panel's ShareSheet). Any other `?target=` value
is rejected — those three are the whole list.

Paste the URL into your client (Profiles → import from URL), enable the
connection, and open any website. The Home status card counts requests as
**estimates** (labeled in the panel) — the worker has no byte meter.

Done. For WARP configs, Telegram bot, kill switch, and troubleshooting, see
[USER_GUIDE.md](USER_GUIDE.md). For what q-proxy deliberately does *not* do,
see [USER_GUIDE.md §19](USER_GUIDE.md#19-what-q-proxy-deliberately-does-not-do).

Screenshot: *Deploy Button success + setup card + wizard step 2 + connected client*

## Proof table (step → shipped behavior)

| Quickstart claim | Proved by |
|---|---|
| Button URL deploys this repo | `docs/DEPLOYMENT.md` Way B (ticket 10) |
| Bindings `QPROXY_KV` / `QPROXY_DB`, migrations `0001_init.sql` + `0002_drop_users.sql` | `wrangler.toml`, `migrations/` |
| Setup card 24 h window, bootstrap forced change | `src/handlers/api/auth.ts`, `test/workers/auth-flow.spec.ts` |
| 8 + letter + digit floor, inline field error | `src/auth/password.ts`, `test/auth/password.spec.ts` |
| Wizard: protocols → per-format URLs → done | `src/ui/panel/actions.js` `maybeWizard`, walk step 8 |
| `?target=base64\|singbox\|clash` serve those bodies; anything else 400s | `SUB_FORMATS`, `test/workers/subscription-pipeline.spec.ts` |
| Hub rows match served formats (drift-guarded) | `test/ui/format-labels.spec.ts` |
| Usage figures are labeled estimates | `usageView.estimated`, `test/handlers/api/status.spec.ts` |
