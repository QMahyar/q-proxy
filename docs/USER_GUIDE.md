# Q Proxy — User Guide v1.0.0

> For architecture and contributing, see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md). For decisions, see [../RATIONALE.md](../RATIONALE.md).

## 1. Prerequisites

| Requirement | Notes | Check |
|-------------|-------|-------|
| Cloudflare account | Free tier works; one KV namespace required | `npx wrangler whoami` |
| Node 20+ + npm | Only for wrangler path; dashboard paste needs no local toolchain | `node -v` |
| Domain (optional) | Custom domains via Settings → routing; TLS/plain ports auto-paired | — |
| Clients | v2rayNG / sing-box / Clash Meta / Surge / Loon / Shadowrocket | — |

No runtime `dependencies` — `package.json:13` is `devDependencies` only. No D1, no Durable Objects.

## 2. Deploy

Pick one path. Both produce the identical bundle from `scripts/build-single-file.mjs:10` (`src/worker.ts → dist/q-proxy.js`, `format: esm`, `target: es2023`).

### Path A — Dashboard Paste (no CLI, ~3 min)

| Step | Action |
|------|--------|
| 1 | `npm run build` → verify `dist/q-proxy.js` exists (`scripts/build-single-file.mjs:15`) |
| 2 | Cloudflare Dashboard → Workers & Pages → Create Worker → Edit Code → paste entire `dist/q-proxy.js` → Save |
| 3 | Settings → Bindings → Add KV Namespace → variable `QPROXY_KV` → create + bind `qproxy` namespace |
| 4 | Deploy. Open `https://<worker>.workers.dev/` → expect camouflage 500 page until first-run wizard completes |

Screenshot: *Dashboard → Edit Code with pasted bundle + KV binding panel*

### Path B — Wrangler (repeatable, recommended)

`wrangler.toml:1` is the source of truth:

```toml
name = "q-proxy"
main = "dist/q-proxy.js"
compatibility_date = "2026-08-01"
[[kv_namespaces]]
binding = "QPROXY_KV"
id = "REPLACE_WITH_YOUR_KV_ID"
```

Credentials use a **Global API Key** (dash.cloudflare.com → My Profile → API Tokens → Global API Key):

```powershell
$env:CLOUDFLARE_API_KEY   = "cfk_<your-global-api-key>"
$env:CLOUDFLARE_EMAIL     = "you@example.com"
$env:CLOUDFLARE_ACCOUNT_ID = "<your-account-id>"
npx wrangler whoami          # must show the chosen account
npx wrangler kv namespace create qproxy
# copy id → paste into wrangler.toml
npm run deploy               # = build + wrangler deploy (package.json:11)
# or: npm run dev            # local miniflare at http://127.0.0.1:8787
```

> `CLOUDFLARE_API_TOKEN` with a `cfk_` value fails `[code: 9109] Invalid access token` — use `CLOUDFLARE_API_KEY`.

Screenshot: *Terminal `wrangler whoami` + `deploy` success + assigned `*.workers.dev` URL*

## 3. First-Setup Wizard

On first load with empty `qproxy:settings`, every panel route renders the setup form (`src/handlers/api/auth.ts:handleSetup`).

| Step | Screen | Action |
|------|--------|--------|
| 1 | `/{securePath}/panel` redirects to `/{securePath}/login` | Shown automatically when `passwordHash === null` (`src/types/settings.ts:43`) |
| 2 | Set Password | Enter ≥8 chars with letter+digit; stored as PBKDF2-SHA256 (`src/auth/password.ts`). Race-guarded: only accepted while unset |
| 3 | Secure Path noted | Generated `randomHex(12)` (`src/settings/seed.ts`). Gating: panel, APIs, subscriptions, DoH, and all `/{vl|vm|tr|ss}/` tunnels live under it (`src/core/routes.ts:53`) |
| 4 | Login | Sets `q_session` cookie (`HttpOnly; Secure; SameSite=Lax`, 7-day, `src/handlers/api/auth.ts` flow) + CSRF header `X-Q-Panel: 1` for mutating calls |

Screenshot: *Setup form (EN/FA toggle) → Login → Panel Home*

Keep the full `https://<worker>/ <securePath>` URL — rotating the path invalidates every client config.

## 4. Panel Tour

### 4.1 Home

- **Status card** — `GET /{sp}/api/status` (`src/handlers/api/status.ts`): version (`__APP_VERSION__`), colo, `killSwitch`, usage counters.
- **Subscription URLs** — `GET /{sp}/api/suburls`: one URL per format with QR (client-side JS, no `/qrcode` endpoint). Copy/QR per format.
- **Quick toggles** — Kill Switch, Speedtest Intercept without opening Settings.

### 4.2 Settings

All fields from `src/types/settings.ts:41` grouped below. Saving is `PUT /{sp}/api/settings` with per-field validation (`src/settings/validate.ts`), 256 KB cap, `SENSITIVE_SETTING_PATHS` stripped from GET view.

| Group | Fields (`src/types/settings.ts`) | What it does |
|-------|----------------------------------|--------------|
| General | `language` (`en`/`fa`, RTL), `debugLogging`, `profileTitle`, `subUpdateIntervalHours`, `maxNodesPerFormat` | UI + subscription headers |
| Protocols | `vlessEnabled`/`vmessEnabled`/`trojanEnabled`/`ssEnabled`, `vlessUuid`/`vmessUuid`/`trojanPassword`/`ssPassword`, `ssMethod` (`aes-128-gcm`/`aes-256-gcm`), `vlessPath`/`vmessPath`/`trojanPath`/`ssPath` (`vl`/`vm`/`tr`/`ss` defaults) | Per-protocol enable + creds + WS path suffix |
| Egress | `earlyDataEnabled`+`earlyDataMaxBytes` (2048), `proxyIpMode` (`proxyip`/`nat64`), `proxyIps[]`, `nat64Prefixes[]`, `chainProxy {enabled, uri}` (`socks5://`/`http://`/`https://`), `enableUdp53` | Tunnel egress chain |
| Routing | `hostnameOverride`, `customDomains[]`, `cleanIps[]`, `tlsPorts[]` (443,2053,2083,2087,2096,8443), `plainPorts[]` (80,8080,...), `plainPortPolicy` (`always`/`workers-dev`/`never`), `cdn {enabled, addresses[], host, sni}` | Address pool + port matrix |
| TLS | `fingerprint` (chrome/firefox/safari/ios/android/edge/360/qq/random/randomized), `randomizeSniCase`, `alpn` (`["http/1.1"]`) | Emitted node TLS hygiene |
| Fragment | `fragment {mode (off/low/medium/high/severe/custom), packets (tlshello/1-1…1-5), lengthMin/Max, delayMin/Max, maxSplitMin/Max}` | Xray fragment subs |
| DNS | `dohUpstream` (`https://cloudflare-dns.com/dns-query`), `remoteDns` (`https://8.8.8.8/dns-query`), `localDns` (`localhost`) | DoH + resolver |
| Privacy | `camouflage {mode (off/static/proxy), url}`, `killSwitch`, `speedtestIntercept`, `remoteSubUrls[]`, `urlTestIntervalSec` (300) | Camouflage + merging |

Per-field validation errors return `422 { fields: { "proxyIps[0]": "…" } }`. Reset is `POST /{sp}/api/settings/reset` (keeps identity fields).

Screenshot: *Settings form with grouped tabs + validation toast + dirty-guard*

### 4.3 IP Checker (`GET /{sp}/my-ip`)

Authenticated page (`src/handlers/myip.ts`, `src/core/router.ts:164`). JSON when `Accept: application/json`. Shows CF vs non-CF egress IPs, colo flag via static map (no `ip-api.com`), no third-party geo.

### 4.4 Kill Switch

`POST /{sp}/api/killswitch {enabled}` (`src/handlers/api/status.ts`). When `killSwitch: true`, every WS upgrade returns `503` before upgrade (`src/core/router.ts:202`); panel/sub/DoH stay live. Operational containment — flip without redeploy.

## 5. Subscriptions

### 5.1 Matrix

Base path: `GET /{sp}/sub` (`src/handlers/subscribe.ts`, `src/core/router.ts:154`). Content negotiation in `src/subscription/negotiate.ts:6` and `src/core/ua.ts:19`:

| `?target=` | UA sniff token | Format | Content-Type | Body |
|------------|----------------|--------|--------------|------|
| `base64` | `v2rayng`/`shadowrocket`/`happ`/`streisand`… | Base64 | `text/plain` | Std padded base64 of `\n`-joined `vless://`/`vmess://`/`trojan://`/`ss://` |
| `clash` | `clash`/`meta`/`mihomo`/`stash`/`verge` | Clash YAML | `text/yaml` | Real YAML via `yaml-writer` (not JSON), `servername` vs `sni`, ws-opts `max-early-data: 2048` |
| `singbox` | `sing-box`/`singbox`/`sfa`/`hiddify`/`nekobox`/`karing` | sing-box JSON | `application/json` | Full profile: tun+mixed inbounds, DNS detour, `urltest` best-ping |
| `surge` | `surge` | Surge INI | `text/plain` | `[Proxy]` + select/url-test groups; SS omitted (no v2ray-plugin) |
| `loon` | `loon` | Loon | `text/plain` | `[Proxy]` lines; SS omitted |
| *(none, browser UA)* | `mozilla/`/`chrome/`/`safari`/`firefox` | Info page | `text/html` | Bilingual EN/FA landing with per-format copy/QR |

Priority: `?target=` param > UA tokens > `base64` fallback; browsers get the info page. Non-browser UAs get `Content-Disposition: attachment` + `Subscription-Userinfo` / `Profile-Title` headers (`src/subscription/headers.ts`).

Fragment variant: `?fragment=1` emits Xray JSON chained through `fragment` outbound (presets low→severe map in `src/nodes/fragments.ts`). Shadowrocket/Happ UAs on mixed subs get `fragment=` URI param automatically.

### 5.2 Per-Client Import

| Client | Steps |
|--------|-------|
| **v2rayNG** (Android) | Copy `/{sp}/sub?target=base64` → v2rayNG → `+` → Import from clipboard; or scan QR from panel Home |
| **sing-box / SFA** | Use `?target=singbox` URL → SFA → Add profile from URL → enable tun `auto_route` |
| **Clash Meta / Mihomo** | Use `?target=clash` URL → import as remote profile; `url-test` group auto-selects best ping every `urlTestIntervalSec` |
| **Shadowrocket** (iOS) | Use base64 sub; fragment param auto-appended when UA is Shadowrocket — verify `fragment=` appears in URI preview |
| **Surge** | Use `?target=surge` → Surge → Add config from URL; `#!MANAGED-CONFIG` interval auto-updates |
| **Loon** | Use `?target=loon` → Loon → Add from URL → `[Proxy]` section populated |

Screenshot placeholders: *QR modal + "Copy URL" toast + per-format tabs on info page*

## 6. Troubleshooting

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | **Bad password / 401 on panel** — login fails, no hint which field | PBKDF2 constant-time check (`src/auth/password.ts`); login throttle 5 fails/15 min → 403 (`docs/SPEC.md:35`) | Wait 15 min or clear KV `rl:*`; verify password has letter+digit; check cookie `__Host-qpsid` / `q_session` not blocked; `X-Q-Panel: 1` header present on PUTs |
| 2 | **Early data rejected / WS 1008** | `Sec-WebSocket-Protocol` payload >8 KB or not base64url, or SS path with early data (early data disabled for SS, `src/types/node.ts` invariant) | Cap at `earlyDataMaxBytes: 2048` (`src/types/settings.ts:195`), ensure `ed=2048` in URI (`?ed=2048`), use dedicated `/ss/<suffix>` path (`src/core/routes.ts:11`) |
| 3 | **Fragment sub empty / plain ports in fragment** | `fragment.mode: "off"` disables fragment family; fragment forces TLS only, excludes CDN hosts (`src/types/node.ts:358`) | Set `fragment.mode` to `low`/`medium`/`high`/`severe`; check `tlsPorts` includes 443; disable `cdn.enabled` for fragment |
| 4 | **Camouflage shows 500 on valid path** | Wrong `securePath` segment (case-sensitive), unmatched route, or internal error all return identical fake 1101 HTML (`src/handlers/camouflage.ts`, `docs/SPEC.md:37`) | Copy exact `/{securePath}/panel` URL from KV `qproxy:settings`; check `GET /robots.txt` returns `Disallow: /`; never guess — rotate path via Settings if leaked |
| 5 | **DNS / UDP53 fails, only TCP works** | `enableUdp53: false` or upstream `dohUpstream` unreachable; non-53 UDP always rejected (`src/protocols/vless.ts` cmd 2 guard) | Enable `enableUdp53: true`, set `dohUpstream` to `https://cloudflare-dns.com/dns-query`, test `GET /{sp}/doh?dns=...`; expected: only port-53 UDP relayed via `DnsPacketRelay` (`src/types/tunnel.ts:525`) |
| 6 | **Subscription counters always 0 / `total` missing** | `qproxy:counters` not yet flushed (isolate buffer, 60 s / 32 conns), or `total`/`expire` unset by design (`docs/SPEC.md:24`) | Generate traffic then wait 60 s; `download = requestsTotal × 1 MiB` is an estimate — set `total`/`expire` in Settings if you want explicit quota display |

Still stuck? Enable `debugLogging: true` (`src/types/settings.ts:48` → `src/core/log.ts`) and check `wrangler tail`, or open an issue with the sanitized `GET /{sp}/api/status` output.

## 7. Advanced Settings Examples

### 7.1 Custom Domains and Clean IPs

| Field | Example | Effect |
|-------|---------|--------|
| hostnameOverride | proxy.example.com | Overrides worker hostname for all emitted nodes |
| customDomains[] | cdn.example.com | Extra SNI/host entries; plain-port nodes hidden unless plainPortPolicy=always |
| cleanIps[] | 104.21.12.34, [2606:4700::1]:8443, ip:port | Direct addresses in the pool. An entry with `:port` emits only that port (TLS family decides security); bare entries follow the TLS/plain port selection below. Invalid lines are dropped on save. |

Address composition guarantee: subscriptions contain **only** your worker hostname plus entries from these user-owned lists — no built-in or hard-coded IPs/domains are ever added.

Set in Panel -> Settings -> Routing. DNS for custom domains must be proxied (orange cloud) in CF dashboard — no auto DNS changes (docs/SPEC.md F-16).

Screenshot: *Routing tab with custom domain + clean IP list + validation icons*

### 7.2 Chain Proxy

chainProxy { enabled: true, uri: "socks5://user:pass@1.2.3.4:1080" } (src/types/settings.ts:78) or http:// / https:// .

- All tunneled TCP routes through the chain when enabled — no silent fallback on failure (docs/SPEC.md F-11, src/tunnel/egress.ts:46).
- SOCKS5 per RFC 1928 with optional auth (src/tunnel/chain/socks5.ts); HTTP CONNECT via src/tunnel/chain/http-connect.ts; HTTPS uses native TLS socket (secureTransport:on).
- Chain failure closes the session. Disable to restore direct-first flow.

### 7.3 ProxyIP and NAT64

- ProxyIP mode (proxyIpMode: proxyip): proxyIps[] accepts ipv4, [ipv6], host, host:port; hosts resolve A/AAAA via DoH at use time with 10-min isolate cache (src/tunnel/proxyip.ts). Empty default — no author hosts.
- NAT64 mode (proxyIpMode: nat64): nat64Prefixes[] validated as IPv6 literals (defaults src/types/settings.ts:138: [2a02:898:146:64::] etc.); target IPv4 resolved then synthesized as [prefix + hex(v4)] (src/tunnel/nat64.ts).

Failover keeps top 8 candidates, shuffled deterministically by target host via hashSeed (src/tunnel/egress.ts:64). Generation counters prevent stale writes across redials.

### 7.4 Remote Subscriptions

remoteSubUrls[] — fetched at sub-request time with 5 s timeout, 1 MB cap, 5-min isolate cache (src/subscription/merge.ts). Known schemes (vless/vmess/trojan/ss) converted natively into YAML/JSON/Surge/Loon; unknown schemes pass into base64 mixed only. Unreachable sources degrade silently — own nodes still served. Deduped before emit.

### 7.5 Fragment Settings

Fragment presets (src/nodes/fragments.ts) map panel modes to length/delay/maxSplit:

| Mode | length | delay | maxSplit | Notes |
|------|--------|-------|----------|-------|
| off | — | — | — | Fragment family disabled |
| low | 100-200 | 1-1 | 2-4 | Default from src/types/settings.ts:126 |
| medium | 50-100 | 1-5 | — | |
| high | 10-20 | 10-20 | — | |
| severe | 1-5 | 1-5 | — | |
| custom | lengthMin/Max | delayMin/Max | maxSplitMin/Max | User fields src/types/settings.ts:152 |

Fragment forces TLS ports and excludes CDN hosts (src/types/node.ts). Use ?fragment=1 on sub or enable in panel.

## 8. Port Matrix and TLS Notes

- TLS ports tlsPorts: [443,2053,2083,2087,2096,8443] -> security=tls; plain plainPorts: [80,8080,8880,2052,2082,2086,2095] -> security=none (src/types/settings.ts:119). Mismatch never emitted — property test over generator.
- plainPortPolicy: workers-dev (default) = plain nodes only when hostname is *.workers.dev; always / never override (docs/SPEC.md F-15). Enable always if using custom domain with HTTP allowed.
- Emitted nodes: sni = randomized-uppercase hostname per remark seed, alpn=http/1.1, fingerprint selectable (chrome default, 10 values + random/randomized), allowInsecure=false always (docs/SPEC.md F-29).
- Remarks encode protocol + port + address class + flags (F= fragment, D= custom domain, chain indicator) — unique and stable per src/nodes/naming.ts.

## 9. Security Checklist

- Rotate securePath after sharing configs — rotation invalidates every client URI by design (src/handlers/api/auth.ts, docs/SPEC.md F-36 warning).
- Store trojanPassword / ssPassword / UUIDs only in KV — never commit wrangler.toml with secrets. Mask in any diagnostic output.
- Enable camouflage.mode: static (default) so probes get fake 1101 HTML 500, not 404 fingerprints (src/handlers/camouflage.ts, docs/SPEC.md F-37). /robots.txt always Disallow.
- killSwitch is instant containment — no redeploy needed (src/core/router.ts:202). Panel stays live.
- Password stored PBKDF2-SHA256 >=100k iterations + 16-byte salt; setup race-guarded (docs/SPEC.md F-32/F-33).

## 10. Updating

Dashboard: npm run build -> paste new dist/q-proxy.js -> Save. Wrangler: npm run deploy (package.json:11 does build+deploy). KV qproxy:settings migrates automatically (src/settings/migrate.ts); version stamped at SETTINGS_VERSION = 1. Check GET /{sp}/api/status -> version after deploy. Downgrade keeps unknown keys opaque.

Screenshot: *Status card showing version bump + KV migration log*

## 11. DoH Private Endpoint

GET /{sp}/doh (also /{sp}/dns-query alias in spec, canonical /{sp}/doh in router) — blind DoH reverse proxy to dohUpstream (src/handlers/doh.ts, src/core/router.ts:150). GET ?dns= and POST both forwarded verbatim, cookies stripped, correct content-type returned. Size-capped at 10 MiB. Lives under securePath — knowledge of path is capability. Test: curl https://<worker>/<sp>/doh?dns=<b64url(dns packet)> -H "accept: application/dns-message".

## 12. Speedtest Interception

speedtestIntercept: true (default) (src/types/settings.ts:149, src/tunnel/speedtest.ts). Tunneled requests with Host speed.cloudflare.com or cp.cloudflare.com receive locally synthesized HTTP/1.1 204 without dialing upstream. Saves egress. Toggle in Settings. Unit-tested classifier — wire capture shows no upstream dial for matched hosts.

## 13. Language and i18n

Panel and info page bilingual EN/FA via embedded dictionary (docs/SPEC.md F-38). FA renders dir=rtl with mirrored layout. Language switch persists per session; src/types/settings.ts:47 language: en | fa, default fa. Zero hardcoded English strings in templates (lint-checked).

## 14. QR Codes

Client-side embedded JS generator compiled into panel asset (docs/SPEC.md F-39). Panel shows QR per sub/config link. No /qrcode GET endpoint exists server-side. Scan with any camera app or client QR import. Verify QR payload matches copied URL.

Screenshot: *Panel QR modal with per-format tabs (base64/clash/singbox/surge/loon) + language toggle EN/FA*

## 15. Backup and Restore

Settings live in KV qproxy:settings. To backup: authenticated GET /{sp}/api/settings -> save redacted JSON (passwordHash omitted). To restore: PUT /{sp}/api/settings with saved data. For full migration, copy wrangler.toml KV id and redeploy.

## 16. Common Gotchas

- Custom domain without TLS cert -> nodes still emit security=tls but client may fail verify if domain not proxied. Ensure orange cloud + valid cert.
- Plain-port nodes only appear for *.workers.dev or when plainPortPolicy=always — otherwise base64 sub will be TLS-only even though plainPorts are configured.
- Mixing proxyIpMode toggle without clearing the other list is fine — only the active mode''s list is used.

## 17. Example Settings JSON (redacted GET view)

GET /{sp}/api/settings returns PublicSettings (src/types/settings.ts:156 omits passwordHash/passwordSalt/sessionSecret):

```json
{
  "version": 1,
  "securePath": "a1b2c3d4e5f6",
  "language": "fa",
  "vlessEnabled": true,
  "vmessEnabled": true,
  "trojanEnabled": true,
  "ssEnabled": true,
  "ssMethod": "aes-128-gcm",
  "vlessPath": "vl",
  "tlsPorts": [443,2053,2083,2087,2096,8443],
  "plainPorts": [80,8080,8880,2052,2082,2086,2095],
  "plainPortPolicy": "workers-dev",
  "fingerprint": "chrome",
  "proxyIpMode": "proxyip",
  "proxyIps": [],
  "chainProxy": { "enabled": false, "uri": "" },
  "dohUpstream": "https://cloudflare-dns.com/dns-query",
  "camouflage": { "mode": "static", "url": "" },
  "killSwitch": false
}
```

Full field list: src/types/settings.ts:41 Settings interface (26 top-level keys plus nested cd n/fragment/chainProxy/camouflage).

## 18. IP Checker Details

GET /{sp}/my-ip (src/handlers/myip.ts) performs two server-side fetches: CF-fronted echo + non-CF echo (both configurable, no ip-api). Renders two-column exit-IP table plus colo code with country flag from embedded static colo->flag map. Third-party geo APIs never called (docs/SPEC.md F-40). When Accept: application/json, returns {ip, colo, country, city, asn, cfEgressIp}.

## 19. Kill Switch vs Camouflage vs Debug

| Toggle | Field | Scope | Panel stays live? |
|--------|-------|-------|-------------------|
| Kill Switch | killSwitch (src/types/settings.ts:88) | WS upgrades only -> 503 (src/core/router.ts:202) | Yes |
| Camouflage | camouflage.mode off/static/proxy | Unmatched routes + wrong securePath | Yes (mode controls fallback) |
| Debug Logging | debugLogging | Structured log verbosity (src/core/log.ts) | Yes — enable for wrangler tail |

## 20. End-to-End Smoke Test

1. Deploy (path A or B) -> open /{sp}/panel -> complete wizard -> login.
2. Settings -> verify hostnameOverride empty, tlsPorts defaults present.
3. Home -> copy ?target=base64 URL -> import in v2rayNG -> verify 4 protocol lines decoded.
4. Open ?target=clash URL in browser with clash UA -> verify YAML parses in mihomo strict.
5. Tunnel test: client -> curl https://example.com via proxy -> expect 200.
6. Kill switch on -> client WS should get 503 -> toggle off -> recovers.
7. Check /{sp}/my-ip shows two egress IPs.

Screenshot: *Smoke test checklist with green pass icons*
