# Q Proxy — User Guide

> For architecture and contributing, see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md). For frozen contracts, see [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Prerequisites

| Requirement | Notes | Check |
|-------------|-------|-------|
| Cloudflare account | Free tier works; one KV namespace + one D1 database required | `npx wrangler whoami` |
| Node 20+ + npm | Only for wrangler path; dashboard paste needs no local toolchain | `node -v` |
| Domain (optional) | Extra endpoints via Settings → Endpoints (CDN presets + custom box); TLS/plain ports auto-paired | — |
| Clients | v2rayNG / sing-box / Shadowrocket / Happ / Streisand | — |

No runtime `dependencies` — `package.json:13` is `devDependencies` only. No Durable Objects. D1 holds write-hot state (counters, audit log); settings and the WARP store stay in KV.

## 2. Deploy

Full deployment guide with all seven paths — including Workers and Pages, dashboard and CLI, one-click button and setup script, KV creation, custom domains, and updates — lives in **[docs/DEPLOYMENT.md](DEPLOYMENT.md)**. The two quickest paths are below. Both produce the identical bundle from `scripts/build-single-file.mjs:10` (`src/worker.ts → dist/q-proxy.js` for Workers, `dist/_worker.js` for Pages, `format: esm`, `target: es2023`).

### Path A — Dashboard Paste (no CLI, ~3 min, Workers)

| Step | Action |
|------|--------|
| 1 | `npm run build` → verify `dist/q-proxy.js` exists (`scripts/build-single-file.mjs:15`) |
| 2 | Cloudflare Dashboard → Workers & Pages → Create Worker → Edit Code → paste entire `dist/q-proxy.js` → Save |
| 3 | Settings → Bindings → Add KV Namespace → variable `QPROXY_KV` → create + bind `qproxy` namespace |
| 3b | Settings → Bindings → Add D1 → variable `QPROXY_DB` → create + bind database `q-proxy`, then apply the migrations in `migrations/` (database SQL console or `npx wrangler d1 migrations apply q-proxy --remote`) |
| 4 | Deploy. Visit any worker URL once — this seeds settings into KV |
| 5 | Read your secret path from KV key `qproxy:settings`, field `data.securePath` (dashboard binding viewer or `npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV`) |
| 6 | Open `https://<worker>.workers.dev/<securePath>/panel` → first-run setup card (24 h window — see §3.2) |

For the one-click Deploy Button, Wrangler CLI, `npm run deploy` (direct API), and Pages paths, see [DEPLOYMENT.md](DEPLOYMENT.md).

### Path B — Wrangler CLI (repeatable, recommended, Workers)

`wrangler.toml` is the source of truth:

```toml
name = "q-proxy"
main = "dist/q-proxy.js"
compatibility_date = "2026-08-01"
[[kv_namespaces]]
binding = "QPROXY_KV"
id = "REPLACE_WITH_YOUR_KV_ID"
[[d1_databases]]
binding = "QPROXY_DB"
database_name = "q-proxy"
database_id = "REPLACE_WITH_YOUR_D1_ID"
migrations_dir = "migrations"
```

Automated:

```bash
npx wrangler login            # or export CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npm run build                 # → dist/q-proxy.js
npx wrangler kv namespace create QPROXY_KV   # replace id in wrangler.toml
npx wrangler d1 create q-proxy                # replace database_id in wrangler.toml
npx wrangler d1 migrations apply q-proxy --remote   # one-time schema setup
npx wrangler deploy
```

Or skip wrangler entirely: `npm run deploy` uploads `dist/q-proxy.js` via the Cloudflare REST API and creates the KV namespace and D1 database (plus schema) if missing.

Manual:

```powershell
$env:CLOUDFLARE_API_KEY   = "cfk_<your-global-api-key>"
$env:CLOUDFLARE_EMAIL     = "you@example.com"
$env:CLOUDFLARE_ACCOUNT_ID = "<your-account-id>"
npx wrangler whoami          # must show the chosen account
npx wrangler kv namespace create QPROXY_KV
# copy id → paste into wrangler.toml (or wrangler.local.toml, gitignored)
npm run deploy               # = build + wrangler deploy (package.json:11)
# or: npm run dev            # local miniflare at http://127.0.0.1:8787
```

> `CLOUDFLARE_API_TOKEN` with a `cfk_` value fails `[code: 9109] Invalid access token` — use `CLOUDFLARE_API_KEY`.

See [DEPLOYMENT.md](DEPLOYMENT.md) for Pages (`dist/_worker.js`), Deploy Button, and Git-connected Builds. Screenshot: *Terminal `wrangler whoami` + `deploy` success + assigned `*.workers.dev` URL*

## 3. First Run and Onboarding

How you get your first admin password depends on the deploy path:

| Deploy path | First password |
|-------------|----------------|
| `npm run deploy` (direct API) | The script generates a strong bootstrap password (`qproxy-XXXXXXXX`), **prints it exactly once** in the terminal, and sets it through the setup endpoint. Copy it immediately — it is never shown or stored again. `--password` / `QPROXY_PASSWORD` override the generated value. |
| One-liner scripts (`deploy.sh` / `deploy.ps1`) | The script prompts for a password (or takes `--password`) and sets it the same way. |
| Dashboard paste / Pages / wrangler | Nothing is set at deploy time — the login page shows the **Create passphrase** setup card on first visit (§3.2). |

Login is password-only. There is no second factor: one passphrase signs in, and changing it signs out every other device.

### 3.1 Bootstrap password and the forced change

The deploy-script password is marked as a *bootstrap* password: it protects the panel, but it is not meant to stay. Logging in with it succeeds (the login response carries `mustChangePassword: true`), and until you pick a personal password the panel blocks everything else — every other authenticated API answers `403 PASSWORD_CHANGE_REQUIRED`. While the flag is on you can only change the password, view settings (read-only), or log out.

Fix it in one step: Settings → General → Security card → Change passphrase. The new password clears the bootstrap flag, unlocks the whole panel, and logs out every other device (existing behavior).

### 3.2 The 24 h setup card (paste deploys)

On first load with empty `qproxy:settings`, every panel route renders the setup form (`src/handlers/api/auth.ts:handleSetup`), and the first visit seeds settings with a `seededAt` timestamp. The setup card accepts a passphrase only for **24 hours** after that seed — a submission after the window returns `409 SETUP_WINDOW_EXPIRED` and the panel can no longer be claimed from the web.

Missed the window? Delete the `qproxy:settings` key (Cloudflare dashboard → KV → `qproxy` namespace → delete `qproxy:settings`) and revisit the worker URL: settings re-seed with a fresh 24 h window (same recovery path as the IP allowlist, §4.4).

| Step | Screen | Action |
|------|--------|--------|
| 1 | `/{securePath}/panel` redirects to `/{securePath}/login` | Shown automatically when `passwordHash === null` (`src/types/settings.ts:43`) |
| 2 | Set Password | Enter ≥8 chars with letter+digit; stored as PBKDF2-SHA256 (`src/auth/password.ts`). Race-guarded: only accepted while unset, and only inside the 24 h window (§3.2) |
| 3 | Secure Path noted | Generated `randomHex(12)` (`src/settings/seed.ts`). Gating: panel, APIs, subscriptions, DoH, and the VLESS tunnel live under it (`src/core/routes.ts:53`) |
| 4 | Login | Sets `q_session` cookie (`HttpOnly; Secure; SameSite=Lax`, 7-day, `src/handlers/api/auth.ts` flow) + CSRF header `X-Q-Panel: 1` for mutating calls. With a deploy-script bootstrap password you land on the forced change first (§3.1) |

Screenshot: *Setup form (EN/FA toggle) → Login → forced password change → Panel Home*

Keep the full `https://<worker>/ <securePath>` URL — rotating the path invalidates every client config.

## 4. Panel Tour

### 4.1 Home

- **Status card** — `GET /{sp}/api/status` (`src/handlers/api/status.ts`): version (`__APP_VERSION__`), colo, `killSwitch`, usage counters.
- **Subscription URLs** — `GET /{sp}/api/suburls`: one URL per format with QR (client-side JS, no `/qrcode` endpoint). Copy/QR per format.
- **Quick toggle** — Kill Switch without opening Settings.

Bookmarks to deleted views land on Home (single unknown-view redirect rule, documented once here).

### 4.2 Settings

All fields from `src/types/settings.ts:53` grouped below. Saving is `PUT /{sp}/api/settings` with per-field validation (`src/settings/validate.ts`), 256 KB cap, `SENSITIVE_SETTING_PATHS` stripped from GET view.

| Group | Fields (`src/types/settings.ts`) | What it does |
|-------|----------------------------------|--------------|
| General | `language` (`en`/`fa`, RTL), `debugLogging`, `profileTitle`, `subUpdateIntervalHours`, `maxNodesPerFormat` | UI + subscription headers |
| VLESS | `vlessEnabled`, `vlessUuid`, `vlessFlow` (empty / `xtls-rprx-vision`, TLS nodes only), `vlessPath` (`vl` default) | Single inbound enable + credential + WS path suffix; flow details in §4.7 |
| Endpoints | `cdnPresets[]` (default empty, all opt-in), `customEndpoints[]` (default empty), `warpPresets[]` (default `["default"]`), `warpCustomEndpoints[]` (default empty), `defaultPort` (443), `nameTemplate` | Preset ticks + custom paste + remark naming; details in §7.1 (VLESS) and §5.4 (WARP) |
| TLS | `echEnabled`, `echAuto` (derive ECH name from node SNI), `echServerName` (manual override, always wins), `fingerprint` (chrome/firefox/safari/ios/android/edge/360/qq/random/randomized), `randomizeSniCase`, `alpn` (`["http/1.1"]`) | Emitted node TLS hygiene + ECH |
| Fragment | `fragment {mode (off/low/medium/high/severe/custom), packets (tlshello/1-1…1-5), lengthMin/Max, delayMin/Max, maxSplitMin/Max}` | Fragment subs |
| Egress | `earlyDataEnabled`+`earlyDataMaxBytes` (2048), `proxyIps[]`, `proxyIpPoolUrl`, `enableUdp53` | Tunnel egress: direct first, then the proxyIP pool |
| DNS | `dohUpstream` (`https://cloudflare-dns.com/dns-query`) | Private DoH endpoint upstream |
| Privacy | `camouflage {mode (off/static)}`, `killSwitch` | Camouflage + containment |
| Routing rules | `routingRules {bypassLan, blockAds, blockMalware, blockQuic, customBypass[], customBlock[]}` | sing-box rule-section injection |
| Telegram | `telegram {enabled, chatId}` (`botToken` write-only, never returned) | Bot management |
| Security | `allowedIps[]` (default empty = allow all) | Panel IP allowlist: one IP or CIDR per line, v4/v6; non-listed client IPs get 403 after login (see §4.4) |

Per-field validation errors return `422 { fields: { "proxyIps[0]": "…" } }`. Reset is `POST /{sp}/api/settings/reset` (keeps identity fields).

Screenshot: *Settings form with grouped tabs + validation toast + dirty-guard*

### 4.3 Kill Switch

`POST /{sp}/api/killswitch {enabled}` (`src/handlers/api/status.ts`). When `killSwitch: true`, every VLESS WebSocket upgrade returns `503` before upgrade (`src/core/router.ts:191`); panel/sub/DoH stay live. Operational containment — flip without redeploy.

### 4.4 Panel IP Allowlist

Settings → General → Panel IP allowlist (`allowedIps`, one entry per line). Empty means everyone can log in; any entry restricts the whole panel (APIs included) to those client IPs as seen in `CF-Connecting-IP`:

- Exact addresses (`203.0.113.9`, `2001:db8::1`) or CIDR ranges (`10.0.0.0/8`, `2001:db8::/32`); hostnames and `ip:port` lines are rejected at save, blanks/dupes are cleaned, max 64 entries.
- Order of checks: bad/missing session → 401 first, then non-listed IP → 403. Login and first-setup stay reachable without a session, so a bad list can never lock you out permanently.
- **Recovery:** if you lock yourself out, delete the `qproxy:settings` key in the Cloudflare dashboard (KV → `qproxy` namespace → delete `qproxy:settings`) and revisit the worker URL — settings re-seed with an empty allowlist. Reconfigure the panel afterwards.

### 4.5 Admin Audit Log

Settings saves/resets/imports, kill-switch toggles, and WARP account/preset/Amnezia writes append one JSON line to the Worker log (`wrangler tail` or Cloudflare Dashboard → Workers → Logs). Each line has `"scope":"audit"` with the action as message:

```json
{"t":1725450000000,"level":"info","scope":"audit","message":"settings.save","extra":{"ip":"203.0.113.9","keys":["profileTitle"]}}
```

- `settings.save|reset|import` log `{ip, keys}` — sorted changed top-level key **names** only, never values.
- `killswitch` logs `{ip, enabled}`; `warp.account.*` / `warp.preset.*` log `{ip, id}`; `warp.amnezia.update` logs `{ip}`.
- Filter with `"scope":"audit"`. Secrets (passwords, hashes, UUIDs, `securePath`) never appear — only key names, account ids, and booleans.

### 4.6 Panel Productivity (Shortcuts, Undo/Redo, Traffic, Backup)

- **Keyboard shortcuts** — press `?` in the top bar for the cheatsheet: `Ctrl/Cmd+S` applies unsaved settings, `Ctrl/Cmd+K` focuses search (or goes home), `g` then `h` goes home, `Ctrl/Cmd+Z` undoes and `Shift+Ctrl/Cmd+Z` redoes the last change.
- **Undo/redo** — per settings section, kept in memory while the panel is open (up to 20 steps); switching sections keeps each section's own history.
- **Traffic chart** — the Home status card renders an SVG sparkline from the `qp_traffic` browser-local history (accumulated from the bootstrap usage counters on each visit); it shows an empty state until enough visits have built history. History never leaves the browser.
- **Backup nudge** — if no settings export has happened in over 30 days, a banner offers a one-click export (dismissable). Export via Settings → Backup regularly regardless. Imports of backups exported by a pre-cut release are rejected whole with a localized message (see §10).
- **Mobile** — below 500 px the layout stacks (tables collapse to labeled rows, modals go near-full-width); on touch devices help triggers are 44 px targets.

### 4.7 VLESS Vision Flow

Settings → VLESS (`vlessFlow` in `src/types/settings.ts`; off by default, legacy output byte-identical when off).

Set `vlessFlow: xtls-rprx-vision` when your clients configure `flow=xtls-rprx-vision` on the VLESS node. The worker detects the flow from the handshake and decodes the length-prefixed body framing; the response header stays `[version, 0x00]` and non-vision clients keep working unchanged. `generateNodes` stamps the flow onto TLS VLESS nodes only — plain-port (`security: none`) nodes never carry it, so enabling the setting cannot break plain-port subs. Emitted share URIs gain `flow=xtls-rprx-vision` after the transport params; the sing-box emitter adds `"flow": "xtls-rprx-vision"` on the VLESS entry. If a client enables vision locally but the setting is off here, only the URI advertisement is missing — the inbound still negotiates vision from the handshake.

## 5. Subscriptions

### 5.1 Matrix

Base path: `GET /{sp}/sub` (`src/handlers/subscribe.ts`, `src/core/router.ts:160`). Content negotiation in `src/subscription/negotiate.ts:7` and `src/core/ua.ts:19`:

| `?target=` | UA sniff token | Format | Content-Type | Body |
|------------|----------------|--------|--------------|------|
| `base64` | `v2rayng`/`v2rayn`/`shadowrocket`/`happ`/`streisand`… | Base64 | `text/plain` | Std padded base64 of `\n`-joined `vless://` links |
| `singbox` | `sing-box`/`singbox`/`sfa`/`hiddify`/`nekobox`/`karing` | sing-box JSON | `application/json` | Full profile: tun+mixed inbounds, DNS detour, `urltest` best-ping |
| `clash` | `clash`/`mihomo`/`stash` | Clash YAML | `text/yaml` | Mihomo-compatible profile: vless+ws proxies, `urltest` group, REJECT/DIRECT rules |
| *(none, browser UA)* | `mozilla/`/`chrome/`/`safari/`/`firefox` | Info page | `text/html` | Bilingual EN/FA landing with per-format copy/QR |

Those three targets are the whole list. Priority: `?target=` param > UA tokens > `base64` fallback; browsers get the info page. Any other `?target=` value is rejected with `400 invalid target` — never remapped, never substituted. Non-browser UAs get `Content-Disposition: attachment` + `Subscription-Userinfo` / `Profile-Title` headers (`src/subscription/headers.ts`).

Fragment variant: `?mode=fragment` filters nodes to the fragment family (presets in `src/nodes/fragments.ts`). Shadowrocket/Happ UAs on mixed subs get `fragment=` URI params automatically.

### 5.2 Per-Client Import

| Client | Steps |
|--------|-------|
| **v2rayNG** (Android) | Copy `/{sp}/sub?target=base64` → v2rayNG → `+` → Import from clipboard; or scan QR from panel Home |
| **sing-box / SFA** | Use `?target=singbox` URL → SFA → Add profile from URL → enable tun `auto_route` |
| **Clash Verge / Mihomo** | Use `/{sp}/sub?target=clash` URL → Profiles → New profile from URL; select the `PROXY` group |
| **Shadowrocket** (iOS) | Use base64 sub; fragment param auto-appended when UA is Shadowrocket — verify `fragment=` appears in URI preview |

Screenshot placeholders: *QR modal + "Copy URL" toast + per-format tabs on info page*

### 5.3 Retired token links

There is only one subscription class: yours. Old token links from before the cut no longer exist as a feature — requesting one serves the static camouflage page, byte-identical to any random unknown URL, with no hint that anything was ever there.

### 5.4 WARP Subscriptions

Panel → WARP section: register a real Cloudflare WARP device (or import a config), pick the ONE global endpoint source — tick `warpPresets` (default `["default"]`) plus an optional `warpCustomEndpoints` paste box (one `endpoint:port` per line, any port 1–65535, e.g. WireGuard ports 2408/500) — optionally save Amnezia parameters and flip the global Amnezia switch, then copy a config URL `/{sp}/sub/wg/{token}/{format}`. Four format slugs are served from `src/warp/formats/registry.ts`: `wireguard-conf` (ZIP for the official app), `singbox` (JSON), `v2rayn` (base64 links, never Amnezia), `throne` (links, always Amnezia). Every other name serves camouflage like an unknown URL.

That single global selection governs every account and all four output families, with one global Amnezia switch (default off): on, the WireGuard and sing-box outputs carry the Amnezia values; Throne always does; v2rayn never does. Flipping the switch purges served copies, so clients must re-download — previously shared files are snapshots. Per-account endpoint selection and per-account Amnezia overrides are retired: any stored `endpoint_list` or `amnezia_overrides` is ignored, not migrated. An empty global selection (nothing ticked, custom box empty) falls back to the `default` preset, so configs are never empty for this reason. The custom box follows the same paste discipline as VLESS (§7.1): bad lines reject the whole save naming each line, valid lines are kept verbatim, max 64 lines.

These configs connect straight to Cloudflare's WARP network — their tunnel traffic never passes through your Worker and does not consume the Workers request budget.

### 5.5 Telegram Bot

1. Create a bot with @BotFather, copy the token.
2. Panel → Settings → Advanced → Telegram: enable, paste token, set your chat ID.
3. Click Set webhook. The webhook URL embeds an HMAC-derived secret; commands `/status`, `/sub`, `/kill on|off` get EN/FA replies per `settings.language`. Anything else gets the help reply listing exactly those three commands.

**Menu buttons:** `/start` and `/menu` reply with the help text plus an inline keyboard — Status · Subscription on the first rows, Kill ON · Kill OFF on the last row. Tapping a button runs the matching command and edits the same message in place (no chat spam); other commands reply as plain text without buttons. Kill buttons flip the kill switch immediately, so guard chat access accordingly.

Removing the webhook deletes it from BotFather. The bot token is write-only: it is stripped from settings responses and exports.

### 5.6 Transport Support Matrix

All worker-terminated proxy traffic is VLESS over WebSocket tunnels (under the secure path). There is no other inbound transport:

| Transport | Status | What it means for you |
|-----------|--------|------------------------|
| WebSocket (`type=ws`) | ✅ Works | Every emitted node uses it; the only transport clients need to configure |
| VLESS `xtls-rprx-vision` flow over WS | ✅ Works | Opt-in via `vlessFlow` (see §4.7); framing only, still inside the WS tunnel |

Do not set any other `type=` or `security=` on worker nodes — no client will connect. Requests to former tunnel paths are not upgraded: they serve the camouflage page exactly like an unknown path.

## 6. Troubleshooting

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | **Bad password / 401 on panel** — login fails, no hint which field | PBKDF2 constant-time check (`src/auth/password.ts`); login throttle 5 fails/15 min → 403 | Wait 15 min or clear KV `rl:*`; verify password has letter+digit; check cookie `q_session` not blocked; `X-Q-Panel: 1` header present on PUTs |
| 1b | **403 PASSWORD_CHANGE_REQUIRED on panel APIs** | The deploy-script bootstrap password is still in force — the panel is locked until a personal password is set | Settings → Security → change the passphrase (§3.1); the flag clears on success |
| 1c | **409 SETUP_WINDOW_EXPIRED on the setup card** | The panel was seeded but never claimed, more than 24 h ago | Delete KV `qproxy:settings` and revisit the worker URL to re-seed with a fresh window (§3.2) |
| 2 | **Early data rejected / WS 1008** | `Sec-WebSocket-Protocol` payload >8 KB or not base64url | Cap at `earlyDataMaxBytes: 2048` (`src/types/settings.ts:68`), ensure `ed=2048` in URI (`?ed=2048`), use the dedicated `/<vlessPath>/<suffix>` path (`src/core/routes.ts:14`) |
| 3 | **Fragment sub empty / plain ports in fragment** | `fragment.mode: "off"` disables fragment family; fragment forces TLS only (`src/nodes/generate.ts:157`) | Set `fragment.mode` to `low`/`medium`/`high`/`severe`; check the endpoint port is in the TLS family |
| 4 | **Camouflage on a valid-looking path** | Wrong `securePath` segment (case-sensitive), unmatched route, removed URL shape, or internal error all return the identical static page (`src/handlers/camouflage.ts`) | Copy exact `/{securePath}/panel` URL from KV `qproxy:settings`; check `GET /robots.txt` returns `Disallow: /`; never guess — rotate path via Settings if leaked |
| 5 | **DNS / UDP53 fails, only TCP works** | `enableUdp53: false` or upstream `dohUpstream` unreachable; non-53 UDP always rejected (VLESS cmd 2 guard) | Enable `enableUdp53: true`, set `dohUpstream` to `https://cloudflare-dns.com/dns-query`, test `GET /{sp}/doh?dns=...`; expected: only port-53 UDP relayed via `DnsPacketRelay` (`src/types/tunnel.ts:525`) |
| 6 | **Subscription counters always 0** | `qproxy:counters` not yet flushed (isolate buffer, 60 s / 32 conns) | Generate traffic then wait 60 s; `download = requestsTotal × 1 MiB` is an estimate |
| 7 | **403 on panel after setting the IP allowlist** | Your current IP is not in `allowedIps` (session is valid, hence 403 not 401) | Add your IP/CIDR from another allowed network, or recover by deleting KV `qproxy:settings` and re-seeding (see §4.4) |
| 8 | **400 invalid target on a subscription URL** | `?target=` names a format that does not exist (only `base64` and `singbox` are served) | Use `?target=base64` or `?target=singbox`, or drop the param for UA negotiation |

Still stuck? Enable `debugLogging: true` (`src/types/settings.ts:62` → `src/core/log.ts`) and check `wrangler tail`, or open an issue with the sanitized `GET /{sp}/api/status` output.

## 7. Advanced Settings Examples

### 7.1 Preset + Custom Endpoints

Set in Panel → Settings → Endpoints. VLESS address sources are exactly three, in this order:

1. **Ticked CDN presets** — 8 curated `ip:port` entries shipped in `src/nodes/cdn-presets.ts`, all opt-in (`cdnPresets[]`, default empty). Ticking an entry adds its `ip:port` to generation; unticked entries contribute nothing. Unknown ids are ignored, never errors.
2. **Custom paste box** — `customEndpoints[]` (default empty), one `ip-or-host[:port]` per line (IPv6 in brackets, e.g. `[2606:4700::1]:443`). Lines are stored verbatim (trimmed); blank lines are ignored, not errors.
3. **Worker-hostname fallback** — when no preset is ticked and the custom box is empty, nodes use the request hostname, so subscriptions are never empty.

Paste discipline — the whole save is rejected when any line is bad; stored state is untouched and the panel keeps your text for correction:

- Each non-blank line must parse as `ip:port`. Unparsable lines are rejected with `line N "…"` (content truncated to 64 chars).
- Explicit ports must be in the Cloudflare families {443,2053,2083,2087,2096,8443} ∪ {80,8080,8880,2052,2082,2086,2095}. Out-of-family ports reject the save naming the bad lines — never silently converted or dropped.
- Bare hosts (no port) use `defaultPort` (443 default; TLS-only values allowed).
- Max 64 stored lines; longer boxes are rejected with a count message.
- Dedupe happens at generation by lowercased `host:port` across presets+custom — ticking a preset and pasting the same endpoint yields one node.

Address composition guarantee: subscriptions contain **only** the worker hostname plus enabled presets plus valid custom lines — no other built-in or hard-coded IPs/domains are ever added (the 8 shipped presets are the single blessed exception, and only when ticked).

Removed: the old `addresses[]` list is gone — per-address host/SNI overrides, labels, country tags, enabled toggles, and the `?country=` subscription filter no longer exist. Pre-cut `addresses` data is dropped on upgrade, not migrated: after upgrade re-tick presets or re-paste lines; until then subscriptions serve the worker-hostname fallback. Settings version stays 3.

Fragment variants apply to preset endpoints like any TLS address: when fragment mode is on, every TLS endpoint (preset, custom, or hostname) gains a fragment variant — no per-variant endpoint splitting.

DNS for extra domains must be proxied (orange cloud) in CF dashboard — no auto DNS changes.

Screenshot: *Endpoints card with preset checklist + custom textarea + validation icons*

### 7.2 ProxyIP Pool

- `proxyIps[]` accepts ipv4, [ipv6], host, host:port; hosts resolve A/AAAA via DoH at use time with 10-min isolate cache (`src/tunnel/proxyip.ts`). Empty default — no extra hosts.
- `proxyIpPoolUrl` points at a pool file the worker merges into the same candidate set (probed via the pool API in the panel).

Egress tries direct first, then the pool. Failover keeps the top 8 candidates, shuffled deterministically by target host via hashSeed (`src/tunnel/egress.ts:60`). Generation counters prevent stale writes across redials.

### 7.3 Fragment Settings

Fragment presets (`src/nodes/fragments.ts`) map panel modes to length/delay/maxSplit:

| Mode | length | delay | maxSplit | Notes |
|------|--------|-------|----------|-------|
| off | — | — | — | Fragment family disabled |
| low | 100-200 | 1-1 | 2-4 | Default from `src/types/settings.ts:118` |
| medium | 50-100 | 1-5 | — | |
| high | 10-20 | 10-20 | — | |
| severe | 1-5 | 1-5 | — | |
| custom | lengthMin/Max | delayMin/Max | maxSplitMin/Max | User fields `src/types/settings.ts:118` |

Fragment forces TLS ports. Use `?mode=fragment` on sub or enable in panel.

## 8. Port Matrix and TLS Notes

- Port families (`src/types/settings.ts:3`): TLS [443,2053,2083,2087,2096,8443] → `security=tls`; plain [80,8080,8880,2052,2082,2086,2095] → `security=none`. Mismatch never emitted — property test over generator.
- `defaultPort` (443) applies to pasted lines without an explicit port. Plain-port nodes appear whenever the resolved port is in the plain family.
- Emitted nodes: sni = randomized-uppercase hostname per remark seed, alpn=http/1.1, fingerprint selectable (chrome default, 10 values + random/randomized), allowInsecure=false always.
- ECH (Encrypted ClientHello): enable `echEnabled`, then either set a manual `echServerName` (always wins) or turn on `echAuto` to derive the query name per node from its SNI — the panel previews the effective name live. Nodes whose SNI is not a usable domain name emit without ECH rather than failing.
- Remarks encode port + address class + flags (F = fragment, D = custom domain) — unique and stable per `src/nodes/naming.ts`.

## 9. Security Checklist

- Rotate securePath after sharing configs — rotation invalidates every client URI by design (`src/handlers/api/auth.ts`).
- Store the VLESS UUID only in KV — never commit wrangler.toml with secrets. Mask in any diagnostic output.
- Login is password-only. Pick a strong passphrase; changing it signs out all other devices.
- Enable camouflage.mode: static (default) so probes get the static page, not fingerprints (`src/handlers/camouflage.ts`). `off` serves a bare refusal instead. /robots.txt always Disallow.
- killSwitch is instant containment — no redeploy needed (`src/core/router.ts`). Panel stays live.
- Replace the deploy-script bootstrap password (`qproxy-XXXXXXXX`) with a personal one immediately after first login — the panel refuses every other API until you do (§3.1).
- Password stored PBKDF2-SHA256 >=100k iterations + 16-byte salt; setup race-guarded.

## 10. Updating

Dashboard: npm run build -> paste new dist/q-proxy.js -> Save. Wrangler: npm run deploy (package.json:11 does build+deploy). KV `qproxy:settings` migrates automatically (`src/settings/migrate.ts`); version stamped at SETTINGS_VERSION = 3. Check `GET /{sp}/api/status` -> version after deploy. Downgrade keeps unknown keys opaque.

Pre-cut backups (version below 3) are not migrated: importing one is rejected whole with a clear message telling you to reconfigure on the current version, and nothing is applied. On first boot over a pre-cut store, leftover data from the retired scope is purged with a single log note, then the store is stamped to version 3; counters and the audit log survive untouched.

Screenshot: *Status card showing version bump + KV migration log*

## 11. DoH Private Endpoint

`GET /{sp}/doh` — blind DoH reverse proxy to dohUpstream (`src/handlers/doh.ts`). GET ?dns= and POST both forwarded verbatim, cookies stripped, correct content-type returned. POST bodies size-capped at 64 KiB. Lives under securePath — knowledge of path is capability. Test: curl https://<worker>/<sp>/doh?dns=<b64url(dns packet)> -H "accept: application/dns-message".

## 12. Language and i18n

Panel and info page bilingual EN/FA via embedded dictionary. FA renders dir=rtl with mirrored layout. Language switch persists per session; `src/types/settings.ts` language: en | fa, default fa. Zero hardcoded English strings in templates (lint-checked).

## 13. QR Codes

Client-side embedded JS generator compiled into panel asset. Panel shows QR per sub/config link. No /qrcode GET endpoint exists server-side. Scan with any camera app or client QR import. Verify QR payload matches copied URL.

Screenshot: *Panel QR modal with per-format tabs (base64/singbox) + language toggle EN/FA*

## 14. Backup and Restore

Settings live in KV `qproxy:settings`. To backup: panel → Settings → Backup → Export, or authenticated `GET /{sp}/api/settings/export` → save the JSON file (secrets and `securePath` stripped). To restore: `POST /{sp}/api/settings/import` with the saved file. For full migration, copy wrangler.toml KV id and redeploy.

A backup exported by a pre-cut release cannot be imported: the import answers `422` with a message telling you the file came from a pre-cut release and to reconfigure on the current version, and applies nothing — never a half-applied state. The panel surfaces the same incompatibility as a localized message.

Global counters and the audit trail live in D1 (`q-proxy` database), not in that export. Back them up separately — dashboard D1 console or `npx wrangler d1 export q-proxy --remote --output backup.sql` — and point the new deploy at the same database (copy the `[[d1_databases]] database_id`, or restore the export into the new database). A settings-only restore on a fresh database starts with zeroed counters.

## 15. Common Gotchas

- Custom domain without TLS cert -> nodes still emit security=tls but client may fail verify if domain not proxied. Ensure orange cloud + valid cert.
- Plain-port nodes appear only when the resolved port is in the plain family — otherwise the sub will be TLS-only even though endpoints are configured.
- A custom line with a port outside both port families rejects the whole save naming the bad lines — fix or remove them; nothing is silently dropped. Keep pasted ports inside the TLS/plain families.
- `?target=` with any name other than `base64`/`singbox` answers `400 invalid target` — it is never remapped.
- Old token links serve the camouflage page, exactly like an unknown URL.

## 16. Example Settings JSON (redacted GET view)

`GET /{sp}/api/settings` returns PublicSettings (`src/types/settings.ts:144` omits `passwordHash`/`passwordSalt`/`sessionSecret`):

```json
{
  "version": 3,
  "securePath": "a1b2c3d4e5f6",
  "language": "fa",
  "vlessEnabled": true,
  "vlessUuid": "…",
  "vlessFlow": "",
  "vlessPath": "vl",
  "defaultPort": 443,
  "cdnPresets": [],
  "customEndpoints": [],
  "warpPresets": ["default"],
  "warpCustomEndpoints": [],
  "fingerprint": "chrome",
  "proxyIps": [],
  "proxyIpPoolUrl": "",
  "dohUpstream": "https://cloudflare-dns.com/dns-query",
  "camouflage": { "mode": "static" },
  "killSwitch": false
}
```

Full field list: `src/types/settings.ts:53` Settings interface.

## 17. Kill Switch vs Camouflage vs Debug

| Toggle | Field | Scope | Panel stays live? |
|--------|-------|-------|-------------------|
| Kill Switch | killSwitch (`src/types/settings.ts:86`) | VLESS WS upgrades only -> 503 (`src/core/router.ts:191`) | Yes |
| Camouflage | camouflage.mode off/static | Unmatched routes + wrong securePath + retired URL shapes | Yes (mode controls fallback) |
| Debug Logging | debugLogging | Structured log verbosity (`src/core/log.ts`) | Yes — enable for wrangler tail |

## 18. End-to-End Smoke Test

1. Deploy (path A or B) -> open /{sp}/panel -> complete setup (§3) -> login (and clear the bootstrap flag if the deploy script set the password, §3.1).
2. Settings -> verify no presets ticked and custom box empty (worker hostname fallback), defaultPort 443.
3. Home -> copy ?target=base64 URL -> import in v2rayNG -> verify VLESS lines decoded.
4. Open ?target=singbox URL with a sing-box UA -> verify JSON parses in the client.
5. Tunnel test: client -> curl https://example.com via proxy -> expect 200.
6. Kill switch on -> client WS should get 503 -> toggle off -> recovers.
7. Check `GET /{sp}/doh?dns=...` answers via your upstream.

Screenshot: *Smoke test checklist with green pass icons*
