# Research 03 — Nahan (پروژه نهان) Cloudflare Worker Panel

> Research for the Q Proxy unified panel project (BPB + edgetunnel + nahan).
> All file/function references verified against a shallow clone of the repo at
> `C:\Users\qmahyar\AppData\Local\Temp\opencode\qproxy-research\nahan`.
>
> **WARP note:** Nahan contains **zero WARP/WireGuard features** — nothing to exclude;
> it simply does not have them. Marked per instructions.

---

## A. Repo identification

| Field | Value |
|---|---|
| Canonical URL | https://github.com/itsyebekhe/nahan |
| Author | `itsyebekhe` (GitHub org) |
| Stars / Forks | 2,982 ⭐ / 365 forks (GitHub API, 2026-08-22) |
| Language | JavaScript — entire backend is one file `_worker.js` (9,090 lines, ~391 KB); GitHub labels repo "HTML" because `dashboard.html` is 458 KB |
| Version | 3.0.0 (`version` file; `CURRENT_VERSION` at `_worker.js:8`) |
| Created | 2026-06-05 |
| Last push | 2026-07-28 (repo metadata updated 2026-08-22) |
| License | MIT (LICENSE file + README badge; GitHub API license field is null) |
| Open issues | 104 |
| Lineage | **Fork of `ImLTHQ/edgetunnel`** (edgetunnel family), then fully rewritten: D1 storage, dashboard, Telegram bot, multi-user system are Nahan-specific |
| Homepage | https://itsyebekhe.github.io/nahan/ |

**Name disambiguation ("Nahon" vs "Nahan"):** No project named "nahon" exists.
Searches in English and Persian (`ناهن پنل cloudflare`) converge on this single project,
whose Persian name is نهان ("Hidden"). Other hits are direct forks/clones of it:
`elPooriX/Nahan-Panel`, `Drshahinka/Nahan-Panel`, plus installer repos
(`erpycode/nahan-installer`). `itsyebekhe/nahan` is unambiguously canonical.

**Repo layout** (deliberately tiny):

```
nahan/
├── _worker.js         # The entire gateway: proxy core + REST API + sub generator (9,090 lines)
├── dashboard.html     # Admin panel UI (458 KB, self-contained Tailwind SPA)
├── subscription.html  # End-user subscription info page (bilingual EN/FA, RTL)
├── index.html         # Landing page
├── clash.yml          # Clash/Mihomo output template (fetched at runtime by worker)
├── singbox.json       # sing-box output template
├── v.json             # "v2ray JSON" output template
├── setup.sh           # Interactive wrangler CLI wizard (provision D1 → deploy → destroy)
├── wrangler.toml      # Local dev config, IOT_DB binding
└── README(.md/_FA.md), HELP(.md/_FA.md), CHANGELOG.md, version
```

Code is deliberately disguised as an "IoT Device Telemetry Gateway" (file header comment,
`_worker.js:3-6`; routes named `data`, `processTelemetryStream`) — a cover story woven
through identifiers.

---

## B. Protocols & transports supported

| Layer | Support |
|---|---|
| VLESS | ✅ ("alpha" internally) |
| Trojan | ✅ ("beta" internally) |
| Mode switch | `sysConfig.mode`: `alpha` \| `beta` \| `both` (`SYSTEM_DEFAULTS.mode`, `_worker.js:38`) |
| VMess / Shadowsocks / WireGuard | ❌ none |
| Transport | **WebSocket only** (`type=ws` hard-coded in all URI builders, `_worker.js:7323`) |
| TLS | Per-port heuristic: CF HTTP ports `80,8080,8880,2052,2082,2086,2095` → `security=none`, else `tls` (`getTransportParams`, `_worker.js:6491-6497`) |
| gRPC / HTTPUpgrade / xhttp / REALITY | ❌ none |
| UDP over WS | ❌ not handled |

**Wire framing (custom, both protocols parsed in `parseSensorData`, `_worker.js:6180-6479`):**
- **VLESS path:** first byte `0x00`, then 16-byte client hash = config UUID hex (`_worker.js:6191`),
  option length byte, port (u16 BE), address type 1=IPv4 / 2=domain / 3=IPv6 (`_worker.js:6271-6286`).
  Worker replies `0x00 0x00` ack (`_worker.js:6170`), then raw TCP pipe via `cloudflare:sockets`
  `connect()` (`_worker.js:6403`).
- **Trojan path:** password line terminated by CRLF; hash lookup via hand-implemented
  SHA-224 of the user UUID (`sha224Hex`, `_worker.js:183-260`; `getTrojanHash`, `_worker.js:262-268`);
  address types 1=domain / 3=IPv4 / 4=IPv6 (`_worker.js:6359-6374`). Changelog notes a past bug
  where first 2 payload bytes were dropped (`CHANGELOG.md:148`).

Protocol names are obfuscated with char-code builders to avoid literal strings:
`getAlpha()` → "vless", `getBeta()` → "trojan", `getGamma()` → "clash" (`_worker.js:10-12`).

---

## C. Config generation logic

Core builder: `buildUriProfile(hostName, targetSub, allowInsecure)` — `_worker.js:7265-7463`.

**Cartesian expansion:** for each profile × hostname × clean IP × port × relay(proxy) IP,
it emits one node per protocol enabled. Loop nesting visible at `_worker.js:7307-7456`.

**VLESS URI params** (`_worker.js:7323-7325`):
```
encryption=none&security={tls|none}&sni={host}&fp={agent}&type=ws&host={host}&path=/{apiRoute}&allowInsecure={0|1}
```
plus `pbk=enabled` when `sysConfig.enableOpt2` is set (ECH toggle).

**Trojan URI**: real user UUID as password, WS path embeds a base64 JSON control payload
(`_worker.js:7369-7377`):
```json
{ "junk": "<11 random chars>", "protocol": "tr", "mode": "proxyip", "panelIPs": [], "relayIdx": <n> }
```

**Per-config derived UUIDs (unique design):** `generateConfigUuid(uuid, index)`
(`_worker.js:280-295`) mints a distinct UUID per generated node; `registerConfigEntry()`
(`_worker.js:269-275`) maps it → (user, relayIp) in an isolate-local `configRegistry` Map.
On connection the worker resolves the node back to its owning user either via registry or by
decoding the fingerprint embedded in the UUID (`decodeConfigUuid`, `_worker.js:288-295`,
fallback at `_worker.js:6212-6231`). This enables per-node relay routing and attribution
without extra DB reads.

**Relay-index-in-path:** the same base64 `{relayIdx}` payload rides the WS path (or `ri`
query param, or numeric last path segment — triple fallback, fetch handler `_worker.js:905-928`)
so each generated node pins its designated proxy IP.

**Outbound connection strategy** (`_worker.js:6402-6463`):
1. Try direct `connect(target)` from Worker.
2. On failure build relay list: user's `proxyIp` → global `backupRelay` → `customRelay`.
3. Pick start index by consistent hash of profile ID (`_worker.js:6427-6435`) to keep a user's
   egress IP stable across CF sessions.
4. Up to 3 failover attempts across the list.

**NAT64:** `ipv4ToNat64(ipv4, prefix)` (`_worker.js:6724-6734`) converts IPv4 relays into
NAT64-mapped IPv6; multiple prefixes supported (`getProxyIpsWithNat64`, `_worker.js:6736-6755`).

**Direct configs:** `sysConfig.enableDirectConfigs` adds extra entries that bypass relay IPs
entirely (`_worker.js:7385-7450`), flagged with ☁️ instead of geo flag (`_worker.js:6987`).

**Fake configs:** entries like `trojan://00000000-…@127.0.0.1:1080?security=none#📊 {usage}`
prepended to subscriptions (`_worker.js:7286-7291`), templates configurable with
`{usage}`/`{expiry}` variables (`SYSTEM_DEFAULTS.fakeConfigs`, `_worker.js:73-76`;
`getFakeConfigNames`, `_worker.js:6549-6563`). Used to display traffic/expiry inside clients.

**Upstream chain:** optional upstream VLESS URI parsed by `parseVlessUri` (`_worker.js:7085+`)
and prepended raw to every subscription (`_worker.js:7457-7461`).

**Naming engine:** `getConfigName(...)` (`_worker.js:6958-7020`) supports a template strategy
with tags `{FLAG} {COUNTRY} {CITY} {ISP} {PROTOCOL} {USER} {PORT} {PREFIX} {IP} {IP_NAME}
{HOST} {DATE} {INDEX} {WORKER}` (validated by `validateNameStrategy`, tag list
`VALID_NAME_TAGS` `_worker.js:6757-6772`) or preset strategies (`type-user-port`, `user-port`,
`host-port-user`, `prefix-user-port`, `ip`, default). Geo data preloaded in batches of 100 from
ip-api.com (`preloadIpFlags`, `_worker.js:6787-6871`; `fetchIpGeoData`, `_worker.js:6909`)
with `ipGeoCache` Map.

**DoH resolution:** domains resolved through configurable DoH before `connect()`
(default `https://cloudflare-dns.com/dns-query`, `_worker.js:6387-6400`).

---

## D. Subscription formats & endpoints

Single content endpoint: `GET /{apiRoute}?sub=<username>` (default route prefix `sync`,
configurable). Format dispatch at fetch handler `_worker.js:784-898`.

| Format | Trigger (`flag`/`format`/`type`/`output` param) | Builder |
|---|---|---|
| Base64 plain-text URI list | default / `a` / `raw` / `base64` | `buildUriProfile` → `safeBtoa` (`_worker.js:885-898`) |
| Clash YAML (Mihomo/Stash/meta) | `clash`,`yaml`,`meta`,`stash`,`y` | `buildYamlProfile` (`_worker.js:7515`) |
| sing-box JSON | `singbox`,`sb`,`s`,`c`,`g`,`sing-box` | `buildSingBoxJsonProfile` (`_worker.js:8676`) |
| Clash JSON (legacy) | `b`,`c_legacy` | `buildClashJsonProfile` (`_worker.js:7969`) |
| v2ray-style JSON | `vjson`,`v` | `buildVJsonProfile` (`_worker.js:8536`) |

- UA auto-detection for no-flag links: clash/mihomo/v2ray/sing-box/hiddify/nekobox/karing…
  (`_worker.js:816-839`); browser-vs-client discrimination blocks known client UAs from getting
  the HTML page (`_worker.js:618-634`).
- Templates fetched live from the GitHub repo raw URLs and cached module-globally
  (`fetchTemplates`, `_worker.js:7470-7490`) — `clash.yml`, `singbox.json`, `v.json` are data,
  not static assets.
- Custom routing rules (`getCustomRouting`, `_worker.js:7493-7513`): free-form lines
  `geoip:XX`, `geosite:xx`, IPs, domains injected into YAML/sing-box rule sections.
- Subscription headers: `subscription-userinfo` (upload/download/total/expire),
  `profile-update-interval: 12`, `Content-Disposition` attachment with user name
  (`_worker.js:771-781`). Byte totals are *estimated* from request counts
  (`totalReqs × (1GiB/6000)`, `_worker.js:761-763`).
- Browser GET on the endpoint renders `subscription.html` info page with usage bars,
  status (active/paused/expired/limit), bilingual RTL, dark/light mode
  (`_worker.js:636-715`; placeholders `__USER_NAME__`… replaced server-side).
- Per-user clean-URL rewriting: subscription links can point at a custom panel host
  (`customPanelUrl` global, `userPanelUrl` per user, `_worker.js:667-674`).

Multi-user access model: `/{apiRoute}` alone serves the Default profile; when multi-user is
active the default link is disabled (HTTP 403, `_worker.js:717-722`) and each subscriber uses
`?sub=<name>` (`README.md` Multi-User Profiles format `<uuid>:Username`).

---

## E. Panel UI pages/features & auth mechanism

**Dashboard** served at `GET /{apiRoute}/dash`. Not embedded in the worker: HTML is fetched
from `env.DASHBOARD_URL || https://raw.githubusercontent.com/itsyebekhe/nahan/main/dashboard.html`
at request time, version string substituted, DB-missing warning injected
(fetch handler `_worker.js:500-516`). Tabs per README/HELP.md: Endpoints (info + QR codes +
per-profile sync links), Metrics (origin IP, colo, latency diagnostics), System (settings),
Advanced (relay IPs, NAT64, Telegram, kill switch, auto-update, backup/restore), Activity Logs.

**Auth mechanism** (`handleAuth`, `_worker.js:2313-2478`):
- Single POST `/​{apiRoute}/api/auth` with `{ key }`. Valid if equals `sysConfig.masterKey`
  (default `"admin"`, `_worker.js:33`) or matches an entry in `panelApiKeys`
  (`isPanelApiKey`, `_worker.js:296`).
- **No sessions/JWT/cookies** — the dashboard holds the key client-side and sends it on every
  API call (`extractAuthKey`, `_worker.js:306`; `isAuthorized`, `_worker.js:314`).
- API keys: create/revoke actions (`_worker.js:2227`, `_worker.js:2259`), random generation
  (`generateApiKey`, `_worker.js:319`), `lastUsed` tracking; key-authenticated responses mask
  secrets as `[PROTECTED]` (`_worker.js:2422-2434`).
- Login success/failure triggers activity log entry (`logActivity`, `_worker.js:1284`) and
  Telegram alert (`sendTelegramMessage`, `_worker.js:1180`); a `tg_panel_login` signal is also
  stored for the bot and optionally pushed to a hub panel (`_worker.js:2344-2391`).
- Camouflage: any non-routed request is reverse-proxied to legit sites
  (`maintenanceHost`: ubuntu.com, docker.com) via `serveMaintenancePage` (`_worker.js:1007-1048`,
  gating at `_worker.js:495-497`).

**Management API surface** (all under `/{apiRoute}/…`, route table `_worker.js:458-470`):
`POST api/auth`, `POST api/sync` (save config), `GET/POST api/logs`, `api/users`
(CRUD + `toggle` pause user `_worker.js:1649` + `reset` traffic `_worker.js:1685`),
`api/stats`, `api/update` (`check` `_worker.js:1954` / `deploy` `_worker.js:2005`),
`api/keys`, Telegram webhook `tg` + `tg/sync_panel`.

Telegram bot (`handleTelegramWebhook`, `_worker.js:3129-~6000`, ~2,900 lines): full remote
administration with inline keyboards — users list/create/pause/reset, settings, logs,
kill switch (`/pause`), status (`/status`), localized FA/EN (`tgBotLang` default `fa`).

Kill switch: `sysConfig.isPaused` makes all WS upgrades return 503 (`_worker.js:903-904`)
while panel stays reachable.

Per-user object schema (`handleUsersApi` create, `_worker.js:1488-1511`):
`id (uuid), name, limitTotalReq, limitDailyReq, expiryMs, notes, maxConfigs, proxyIp,
cleanIp, userMode, userPorts, userNodes, nat64, connLimit, userPanelUrl, createdAt`.
`connLimit` caps simultaneous connections (`_worker.js:6246-6252`).

---

## F. Env vars / KV schema / deployment modes

**Bindings & env vars**

| Binding | Type | Required | Purpose |
|---|---|---|---|
| `IOT_DB` | D1 database | ✅ | All persistence; missing binding ⇒ warning banner + no saves (`_worker.js:506-510`) |
| `RELAY_IP` | var | optional | Fallback relay/proxy IP when none configured (`_worker.js:1146`) |
| `DASHBOARD_URL` | var | optional | Override dashboard HTML source (`_worker.js:501`) |
| `SUBSCRIPTION_URL` | var | optional | Override subscription page source (`_worker.js:638`) |

No secrets required to boot — Telegram token/chat id, Cloudflare account id/API token/worker
name are all stored *inside* D1 config by the admin from the panel (`SYSTEM_DEFAULTS`,
`_worker.js:27-77`: `tgToken, tgChatId, tgAdminId, cfAccountId, cfApiToken, cfWorkerName`).

**D1 schema** — deliberately minimal, one table (`d1Init`, `_worker.js:139-150`):
```sql
CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT);
```
Known keys (JSON blobs): `sys_config` (whole panel state incl. users array),
`sys_usage` (per-user counters), `backup_ip` (auto-detected working relay),
`tg_panel_login` (login signal for bot). Read-through caches with 10 s/10 s/30 s TTLs
(`CACHE_TTL_*`, `_worker.js:90-96`; `loadSysConfig`, `_worker.js:1076-1147`) — explicitly to
avoid Workers KV write limits (README: "eliminating KV write limitations").

**Deployment modes**
1. Dashboard paste-and-deploy into online editor (primary, README Step 2).
2. `setup.sh` — interactive wrangler CLI wizard: dependency checks, D1 provisioning, deploy,
   destroy (`setup.sh:1-15`, DeepWiki confirms full lifecycle automation).
3. Telegram install bot `@itsyebekhebot`; web installer `erpycode.github.io/nahan-installer`.
4. `wrangler.toml` provided for local dev (port 8787).

**Self-update pipeline** (scheduled handler `_worker.js:937-1004`): cron compares local
`CURRENT_VERSION` vs `version` file on GitHub; downloads new `_worker.js`, optionally runs
`obfuscateCode` (`_worker.js:1853-1916` — renames identifiers to `_0xNahan*` style), then
deploys via Cloudflare API `deployWorkerToCloudflare` (`_worker.js:98-137`) using stored
account/token bindings; propagates update to all `linkedPanels` via their `/api/update`
endpoints.

**Panel federation:** `linkedPanels[]` (url + apiKey) with helper RPCs `remotePanelFetch`,
`remotePanelToggleUser`, `remotePanelResetTraffic` etc. (`_worker.js:3052-3127`);
legacy `slaveNodes`/cascade fields auto-migrated (`migrateSlaveNodesToLinkedPanels`,
`_worker.js:1049`). A `hubPanelUrl` receives login signals so one hub can monitor many nodes.

---

## G. Unique features worth copying (evidence)

1. **Per-config UUID derivation without DB round-trips** — every generated node gets a unique
   UUID encoding the owner's fingerprint + relay index; decodable statelessly on connect.
   `_worker.js: generateConfigUuid (:280)`, `decodeConfigUuid (:288)`, `registerConfigEntry (:269)`,
   resolution fallback `:6212-6231`. Ideal for unified panel: per-node attribution + revocation
   granularity without per-node storage.
2. **Relay-index carried in WS path payload** (base64 JSON, triple extraction: query `ri` →
   numeric segment → b64 JSON) lets one subscription pin different nodes to different egress IPs.
   `_worker.js:905-928`, `:7369-7377`.
3. **Consistent-hash egress selection + bounded failover** — stable per-user exit IP across CF
   sessions, max 3 attempts down the relay list. `_worker.js:6426-6462`.
4. **Geo-tagged naming engine** with batched ip-api.com prefetch and template validation.
   `_worker.js: VALID_NAME_TAGS (:6757)`, `validateNameStrategy (:6775)`, `preloadIpFlags (:6787)`,
   `getConfigName (:6958)`.
5. **Fake configs with `{usage}`/`{expiry}` templates** — usage/expiry shown inside any client
   as dummy nodes. `_worker.js:73-76`, `getFakeConfigNames (:6549)`, emission `:7286-7291`.
6. **Camouflage mode** — unmatched paths reverse-proxied to real sites (ubuntu/docker) so the
   worker domain looks like an ordinary site to scanners/censors. `_worker.js:495-497`, `:1007-1048`.
7. **Self-hosted auto-update incl. code-obfuscation option** — version check against GitHub,
   optional identifier obfuscation, API-driven redeploy, fan-out to linked panels.
   `_worker.js: scheduled (:937-1004)`, `obfuscateCode (:1853)`, `deployWorkerToCloudflare (:98)`.
8. **Multi-panel federation** (hub/spoke with sync API keys, login-signal propagation,
   cross-panel user toggle/traffic reset). `_worker.js: handleSyncPanel (:2678)`,
   `remotePanelFetch (:3052)`, hub notify in `handleAuth (:2363-2391)`.
9. **Hand-rolled SHA-224** for Trojan passwords — works where `crypto.subtle` digest support
   is absent. `_worker.js: sha224Hex (:183)`, `getTrojanHash (:262)`.
10. **Per-user simultaneous-connection cap** (`connLimit`) enforced in the data path.
    `_worker.js:6246-6252`, field `:1508`.
11. **Browser-vs-proxy-client UA classification** to serve an HTML info page to humans and
    configs to clients. `_worker.js:618-639`.
12. **D1-as-KV with TTL caches** — single-table persistence dodging KV write quotas while
    keeping hot-path reads cached. `_worker.js: d1Init/d1Get/d1Put (:139-174)`,
    `loadSysConfig (:1076-1147)`.
13. **Bilingual (FA/EN, RTL) end-user subscription page** rendered server-side from template
    substitution. `subscription.html` + injection `_worker.js:636-715`.

---

## H. Weaknesses

1. **Monolith**: 9k-line single `_worker.js`; protocol names hidden behind char-code builders
   (`getAlpha/getBeta/getGamma`) and IoT cover-story naming (`telemetry`, `sensor data`)
   actively hurt auditability and onboarding.
2. **WebSocket-only transport** — no gRPC/HTTPUpgrade/xhttp, no REALITY, no VMess/SS; weaker
   coverage than BPB for censored-network conditions.
3. **Traffic accounting is fake precision**: bytes estimated as request count × (1 GiB / 6000)
   (`trackUsage`, `_worker.js:332+`; conversion at `:761-763`) — real bandwidth is never measured.
4. **Isolate-local state**: `configRegistry`, `uuidUsage`, `activeConns` are memory Maps; cold
   starts lose per-config mappings until clients reconnect (fallback fingerprint decode mitigates,
   `_worker.js:6212-6231`), usage stats depend on periodic D1 flushes.
5. **Dashboard fetched from GitHub raw on every dash load** (`_worker.js:501-503`) — external
   dependency, added latency, and supply-chain trust in `itsyebekhe` org; same for sub-page
   (`:638`) and clash/singbox/v.json templates (`:7470-7489`).
6. **Auth is thin**: masterKey defaults to `"admin"` (`_worker.js:33`); no rate limiting on
   `/api/auth`; no session expiry — key replayed forever; state-changing endpoints rely solely
   on the shared key header.
7. **Secrets in D1 plaintext**: `cfApiToken` (full Workers-deploy power), `tgToken`, master key
   all sit in `kv_store.sys_config`; auto-update feature means a leaked D1 read = full worker
   takeover. Masking only happens for API-key logins (`_worker.js:2422-2434`).
8. **Third-party geo leak**: every subscription build batch-queries ip-api.com with clean/relay
   IPs (`preloadIpFlags`, `:6787`) — privacy + availability dependency.
9. **Project hygiene**: 104 open issues; GitHub API shows `license: null` despite MIT claims;
   fork-of-fork lineage (edgetunnel) means upstream CVE fixes don't flow automatically.
10. **No WARP features at all** (excluded scope confirmed empty here — contrast with BPB which
    has Warp General/PRO). Unified panel must source WARP capability from BPB side only.
11. **Cover-story comments can trigger false positives** in security scanners and make the code
    harder to reason about for contributors (whole-file framing as "IoT telemetry gateway").

---

## Summary verdict for unified panel

Nahan contributes the strongest *management plane* of the three projects: multi-user profiles
with quotas/expiry/pause, per-config derived credentials, relay routing per node, geo naming,
fake configs, camouflage, Telegram administration, panel federation, and D1-backed persistence
with TTL caching. Its *data plane* is minimal (VLESS/Trojan over WS only, no fragment/WARP/
REALITY/xhttp). For the unified panel: take Nahan's management/user/federation layer and BPB's
richer data-plane options (fragment, ECH, custom CDN, Warp), with edgetunnel lineage providing
the common WS-core DNA all three share.
