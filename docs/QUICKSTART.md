# Q Proxy — Quickstart

Deploy, claim the panel, connect a client.

## 1. Deploy

Preferred: `npm run deploy` (direct Cloudflare API — creates the
`QPROXY_KV` namespace and `q-proxy` D1 database, applies
`migrations/0001_init.sql`, uploads `dist/q-proxy.js`).

Then visit `https://<your-worker>.workers.dev/` once to seed settings.

## 2. Claim the panel

Read `securePath` from KV key `qproxy:settings`, open
`https://<your-worker>.workers.dev/<securePath>/panel`, and set a
passphrase (minimum 8 characters, with a letter and a digit).

## 3. Connect a client

Copy a subscription URL from the panel Subscriptions hub (`#/subs`).
Pick the row matching your client:

| Client | URL | Format |
|--------|-----|--------|
| v2rayNG / v2rayN / Hiddify / Streisand / Shadowrocket | `/<securePath>/sub?target=base64` | Base64 `vless://` list |
| sing-box / SFA / Karing / NekoBox | `/<securePath>/sub?target=singbox` | sing-box JSON profile |
| Clash Verge / Mihomo / Stash | `/<securePath>/sub?target=clash` | Clash YAML profile |
| Xray-core desktop (v2rayN / NekoRay) | `/<securePath>/sub?target=xray` | Xray JSON profile |

Without `?target=` in a browser you get an info page with the same links.
Any other `?target=` value is rejected with a 400 — these four are the
whole list (see `SUB_FORMATS` in `src/subscription/negotiate.ts`,
drift-guarded by `test/docs/quickstart.spec.ts`).
