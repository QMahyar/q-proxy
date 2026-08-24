# BPB Worker Panel — Capability Inventory

> Research target: canonical repo **https://github.com/bia-pain-bache/BPB-Worker-Panel** (v5.1.1, GPL-3.0).
> NOTE: the originally suggested `mahdibland/BPB-Worker-Panel` does not exist (404); the project author is *bia-pain-bache*.
> Local shallow clone used for this report: `C:\Users\qmahyar\AppData\Local\Temp\opencode\qproxy-research\bpb`.
>
> Purpose: exhaustive, evidence-based inventory to drive a unified panel rebuild combining BPB + edgetunnel + nahan.
> WARP-related capabilities are documented but marked **[EXCLUDED — no WARP in target panel]**.

Architecture at a glance: TypeScript worker bundled by esbuild (`scripts/build.js`) into a single `dist/worker.js`; HTML/JS/CSS panel assets are minified, gzipped and base64-embedded into the script as constants (`PANEL_HTML_CONTENT`, `LOGIN_HTML_CONTENT`, `ERROR_HTML_CONTENT`, `PROXY_IP_HTML_CONTENT`, `ICON_CONTENT`, `SOURCE_CONTENT` — `scripts/build.js:processHtmlPages/buildWorker`, `src/types/global.d.ts`). Runtime deps are only `jose` (JWT), `jszip` (WireGuard zips) and `qrcode-generator` (`package.json`). Routing entry: `src/worker.ts` — a path switch under `/{SECURE_PATH}/...`.

---

## A. Protocols supported

| Protocol | Server-side (worker terminates it) | Client-config only | Evidence |
|---|---|---|---|
| VLESS | YES | YES | `src/protocols/vless.ts:VlOverWSHandler` |
| Trojan | YES | YES | `src/protocols/trojan.ts:TrOverWSHandler` |
| VMess | NO | Chain proxy only | `src/cores/utils.ts:extractProxyParams` (`_VM_` branch), `src/settings/validators.ts:validateChainProxy` |
| Shadowsocks | NO | Chain proxy only | `src/cores/utils.ts:extractProxyParams` (`_SS_` branch) |
| Socks / HTTP | NO | Chain proxy only | same switch, `'socks'/'http'` cases |
| WireGuard (Warp/WoW/Amnezia) | N/A (outbound configs only) | YES | `src/cores/xray/outbounds.ts:buildWarpOutbound`, `src/cores/wireguard.ts:getWireguardConfigs` **[EXCLUDED]** |

### A.1 VLESS over WebSocket — exact parameters
- WS endpoint: `/vl/<random-16-32-chars>`; random path regenerated for every generated config: `src/cores/utils.ts:generateWsPath` → `/${proto}/${getRandomString(16,32)}`; dispatched by first path segment only in `src/handlers/websocket.ts:handleWebsocket` (`case 'vl'` / `case 'tr'`).
- Auth: 16-byte UUID compared to embedded `vlUUID` (`src/protocols/vless.ts:parseVlHeader` — `slicedBufferString === userID`), UUID format enforced by `src/common/common.ts:isValidUUID` (v4-format regex).
- Commands: `1`=TCP CONNECT, `2`=UDP, `3`=MUX rejected (`parseVlHeader`). UDP is allowed **only for destination port 53**, and even then the DNS packet is converted to DoH against hard-coded `https://cloudflare-dns.com/dns-query` (`vless.ts:handleUDPOutBound`, fetch at line ~263). All other UDP throws.
- Response header: `[version[0], 0]` echoed back on first upstream data (`protocols/vless.ts:VLResponseHeader`, `src/protocols/common.ts:remoteSocketToWS`).
- Early data: base64url payload from `sec-websocket-protocol` header decoded by `base64ToArrayBuffer` (`protocols/common.ts:makeReadableWebSocketStream/base64ToArrayBuffer`); client configs carry `?ed=2560` (xray raw URIs) or `max_early_data:2560, early_data_header_name:"Sec-WebSocket-Protocol"` (sing-box/clash builders).

### A.2 Trojan over WebSocket — exact parameters
- WS endpoint: `/tr/<random-16-32-chars>` (same generator).
- Auth: first 56 bytes must equal hex `SHA-224(trPass)` (`trojan.ts:parseTrHeader` uses `node:crypto createHash('sha224')`); followed by CRLF check at bytes 56–57.
- Inner request: SOCKS5-like `CMD(1) ATYP(1) ADDR PORT(2)`; only `cmd===1` (CONNECT) accepted; ATYP 1=IPv4, 3=domain, 4=IPv6 (`parseTrHeader`). No UDP at all.
- Password charset restricted to `[A-Za-z0-9!@$&*_-+;:,.]` (`validators.ts:validateTrPass`), generated 16–32 chars by panel (`panel/script.js:randPassword`).

### A.3 TCP egress (shared by both protocols)
`src/protocols/common.ts:handleTCPOutBound`:
1. Direct `cloudflare:sockets connect()` to target with raw client bytes pre-written (`connectAndWrite`).
2. If remote closes with **zero bytes received** (`remoteSocketToWS` sets `hasIncomingData`), `retry()` runs: either pick **random proxy IP** from list (`proxyIpMode==='proxyip'`, `getRandomValue(proxyIPs)`) or build a **NAT64 IPv6** address from prefix + resolved IPv4 (`proxyIpMode==='prefix'`).
3. ProxyIP entries may embed their own port override via `parseHostPort(proxyIP, true)`.

---

## B. Transports & CDN tricks

### B.1 What the worker itself serves vs what configs advertise
- Server-side transport is **WebSocket only**. There is no gRPC, HTTP-upgrade or xhttp server implementation.
- Transports appearing in *generated client configs* beyond ws exist solely for **chain proxies**: `raw/tcp(+http header)`, `ws`, `grpc`, `httpupgrade`, `xhttp` — `src/cores/xray/outbounds.ts:buildTransport`, mirrored in sing-box (`cores/sing-box/outbounds.ts:buildTransport`, grpc has no multiMode, xhttp absent) and clash (`cores/clash/outbounds.ts:buildTransport` incl. xhttp with x-padding-bytes/reuse-settings defaults).
- Ports: HTTPS `[443, 8443, 2053, 2083, 2087, 2096]`, HTTP `[80, 8080, 2052, 2082, 2086, 2095, 8880]` (`settings/main.ts init()`). Non-TLS ports only offered when deployed on `workers.dev` (no custom domain): filter `domain.endsWith('workers.dev') || isHttps(port)` in every config builder.

### B.2 TLS / SNI tricks
- **SNI = randomized-uppercase worker domain**: `src/cores/utils.ts:randomUpperCase` applied through `selectSniHost` — per-config random case of the domain as SNI (DPI-evasion trick).
- **uTLS fingerprint**: select `chrome|firefox|safari|ios|android|edge|360|qq|random|randomized` (`types/settings.ts:Fingerprint`); clash maps `randomized→'random'` (`clash/outbounds.ts:buildTLS`).
- **ECH (Encrypted Client Hello)**: `enableECH` + optional `echServerName`. Xray: `tlsSettings.echConfigList = "${echServerName}+udp://${localDNS}"` (`xray/outbounds.ts:buildTlsSettings`); sing-box: `ech:{enabled,query_server_name}` (`sing-box/outbounds.ts:buildTLS`) plus an HTTPS-record DNS rule (`sing-box/dns.ts` query_type HTTPS); clash: `ech-opts` (`clash/outbounds.ts`). Disabled automatically on fragment subs (`enableECH && !isFragment`).
- **ALPN pinned to http/1.1** for own configs (`xray/outbounds.ts:buildWebsocketOutbound`).
- **Custom CDN masking** (Fastly/Gcore style): fields `customCdnAddrs/customCdnHost/customCdnSni`; when the config address is a CDN addr, host+sni are replaced and `allowInsecure/skip-cert-verify=true` (`utils.ts:selectSniHost`, remark gets `C` flag via `generateRemark`). Validated all-or-nothing (`validators.ts:validateCustomCdn`).
- **Fallback camouflage**: any non-matching request is proxied to a chosen real site (`handlers/utils.ts:fallback`) instead of 404, if `fallback` set.
- **TCP Fast Open** toggle → `tcp_fast_open` in xray/sb/clash outbounds; **Happy Eyeballs** always set on own outbound sockopt (`tryDelayMs:250, prioritizeIPv6:false, interleave:2, maxConcurrentTry:4` — `xray/outbounds.ts:buildSockopt`).
- **IPv6 toggle**: adds resolved AAAA addresses bracketed to config address pool (`utils.ts:getConfigAddresses` maps `ip => [${ip}]`), influences DNS strategy (`ipv4_only` vs `prefer_ipv4` sb, `UseIP` vs `UseIPv4v6` xray freedom).

### B.3 Fragment machinery (Xray "finalmask" API)
- Settings: `fragmentMode` presets low/medium/high/severe/custom (UI auto-fills length/delay, `panel/script.js:handleFragmentMode` values: low=100-200/1-1, medium=50-100/1-5, high=10-20/10-20, severe=1-5/1-5); `fragmentPackets` tlshello|1-1|1-2|1-3|1-5; `fragmentLengthMin/Max`, `fragmentDelayMin/Max`, new **`fragmentMaxSplitMin/Max`** (`xray/outbounds.ts:buildFinalMask` → `{tcp:[{type:'fragment',settings:{packets,length,delay,maxSplit}}]}`).
- **Smart Fragment config**: one balancer config containing 20 outbounds with fragment lengths spanning `1-5 … 100-200`, observatory picks best (`xray/configs.ts:addBestFragmentConfigs`, `bestFragValues`).
- Fragment subs exclude custom CDN addrs and force TLS-only ports.

### B.4 UDP noise (Xray freedom `finalmask.udp`)
- Multi-noise editor stored as array `{type: rand|str|base64|hex|array, packet, delay:'min-max', count}` (`types/settings.ts:XrUdpNoise`, UI `panel/script.js:addNoise/genNoisePacket` with crypto-random generators). Emitted into `udp:[{type:'noise', settings:{reset:'30-60', noise:[...]}}]` (`xray/outbounds.ts:buildUDPNoises/buildFinalMask`).
- Used by workerless/serverless configs to fight QUIC blocking (`addWorkerlessConfigs` routes udp/quic → `udp-noise` outbound).
- MahsaNG "knocker" noise (`wnoise/wnoisecount/wpayloadsize/wnoisedelay` on wireguard outbound) is Warp-Pro-only **[EXCLUDED]**.

### B.5 ProxyIP handling
- Two modes (`proxyIpMode`): `proxyip` (static list) or `prefix` (NAT64).
- Multiple sources supported: textarea list; default fallback is public aggregator domain `bpb.yousef.isegaro.com` (`settings.ts:_public_proxy_ip_`, resolved at runtime in `handlers/proxy-ip.ts:getProxyIPsInfo` via `resolveDNS(...A records)`).
- Rotation: **random pick per retry** (`protocols/common.ts:getRandomValue(proxyIPs)`), triggered only after direct attempt yields zero bytes — cheap failover without health-check overhead.
- Optional port override inside each entry (`parseHostPort`).
- **ProxyIP catalog page** `/{path}/proxy-ip`: lists current public proxy IPs with country/city/ISP via batched geo lookup (`geoLookupBatch`, ip-api.com/batch, chunks of 100) and per-IP **health test**: raw socket to `:443`, sends `GET /__down?bytes=5000` with `Host: speed.cloudflare.com`, healthy iff response matches `/^HTTP\/1\.[01] 400/` AND contains `cf-ray:`; 5 concurrent attempts → success rate + avg latency (`handlers/proxy-ip.ts:checkProxyIP/testProxyIP`, constants `TIMEOUT_MS=5000, ATTEMPTS=5`).

### B.6 NAT64
- Prefixes default `['[2a02:898:146:64::]','[2602:fc59:b0:64::]','[2602:fc59:11:64::]']` (`settings.ts:init`), user-editable, validated as IPv6 (`validateNAT64Prefixes`), doc list `docs/NAT64Prefixes.md`.
- Generation: resolve hostname→IPv4 if needed, then `convertToNAT64IPv6(ipv4, prefix)` produces `[prefix][h1h2:h3h3]` literal (`protocols/common.ts:getDynamicProxyIP/convertToNAT64IPv6`).

### B.7 DNS tricks (client configs + server)
- **Private DoH endpoint** `/{path}/dns-query`: blind reverse-proxy to configurable underlying DoH (`handlers/doh.ts:handleDoH` copies query params onto target). Default upstream `https://cloudflare-dns.com/dns-query`.
- Remote DNS may be DoH/DoT/TCP URL; **Cloudflare DNS explicitly forbidden** for remote DNS with full blocklist of CF IPs/hostnames (`validators.ts:validateRemoteDNS`) because workers can't reach it sanely.
- `remoteDnsHost`: if remote DNS is a domain, its A/AAAA are pre-resolved at save time and pinned into config `hosts`/predefined servers so the bootstrap never leaks (`kv.ts:getDnsParams`; consumed in all three core DNS builders).
- FakeDNS toggle: xray `fakedns` server unshifted + sniffing destOverride fakedns (`xray/dns.ts`, `xray/inbounds.ts:buildMixedInbound` sniff quic+fakedns flags); sing-box `fakeip` server `198.18.0.0/15` (+`fc00::/18` w/ IPv6) with tun-in A/AAAA rule and `cache_file.store_fakeip`; clash `enhanced-mode: fake-ip` with blacklist filter `+.lan/+.local` (`clash/dns.ts`).
- Anti-sanction DNS (default Shecan `178.22.122.100`): separate resolver for sanctioned vendor domains (see routing).
- NTP sync built into sb/clash configs (`time.cloudflare.com:123`, interval 30m) — protects Reality/TLS time-sensitive handshakes.
- Local DNS supports `localhost` (system) mapping to clash `system` policy.

### B.8 Best-ping / IP-scanner features
- **Xray**: `balancer{strategy:leastPing, selector:['proxy'], fallbackTag:'proxy-2'}` + `observatory{probeUrl:'https://www.gstatic.com/generate_204', probeInterval:${bestPingInterval}s, enableConcurrency:true}` (`xray/configs.ts:buildBalancer`, observatory inline in `buildConfig`). One "💦 Best Ping 🚀" config aggregates all addresses per protocol/domain; chain variants get their own balancer (`addBestPingConfigs`).
- **sing-box**: `urltest` groups incl. separate group for Custom-Domain configs ("💦 Best Ping D 🚀") (`sing-box/configs.ts` tagGroup, `outbounds.ts:buildUrlTest`).
- **clash**: `url-test` groups, `tolerance:50` (`clash/outbounds.ts:buildUrlTest`).
- Interval user-tunable 10–90 s (`bestPingInterval`, default 30).
- Address pool per sub: main domain + resolved A + AAAA + cleanIPs (+custom CDN addrs except fragment) — `getConfigAddresses`; combinatorial expansion across protocols × ports × addresses.
- External scanner links shipped in UI: Cloudflare-Clean-IP-Scanner and BPB-Warp-Scanner repos (`index.html` help icons) **[scanner binary EXCLUDED, concept kept]**.

### B.9 Upstream TCP proxy (SNI-spoof fronting)
- Field `upstreamProxy` (`host:port`); validated `isValidHost(requirePort)`; parsed to `upstreamServer/upstreamPort` (`utils.ts:extractUpstreamParams`); injected as an extra address+port pair into Normal/Raw subs producing dedicated "Upstream Proxy" remarks (`cores/common.ts:getURLConfigs`, `xray/configs.ts:getXrCustomConfigs` guard `(port===upstreamPort)!==(addr===upstreamServer)` keeps pairs matched; TLS forced when addr==upstreamServer).

### B.10 Workerless / serverless emergency configs (unique)
When even the worker domain is blocked, Fragment subs include two self-contained configs that talk straight to Cloudflare edge with fragmented freedom outbound:
`xray/configs.ts:addWorkerlessConfigs` → freedom outbound w/ TLS fragment (`proxy`), http-fragment (`http-fragment`, packets `1-1`), udp-noise; routing rules map `tcp/tls→proxy`, `tcp/http→http-fragment`, `udp/quic + udp 443,2053,... →udp-noise`; DNS pinned to `cloudflare-dns.com` or `dns.google` with static hosts.

---

## C. Subscription system

### C.1 URL scheme & selection
- Format: `/{SECURE_PATH}/sub/{type}?app={core}[&nocache=...]`
  - `type ∈ normal | fragment | raw | warp | warp-pro | share-settings`
  - `app ∈ xray | xray-knocker | sing-box | clash | wireguard | amnezia`
- Dispatch: `src/handlers/subscription.ts:handleSubscriptions` (big switch); registry with human labels + compatible-client lists: `settings.ts:subscriptions` + `clients` (14 clients with minVer + base64 store URLs).
- **No User-Agent based auto-detection** — `app` comes strictly from query string (`settings.ts:init` reads `searchParams.get('app')`). Missing app → falls to `fallback()` (404/camouflage). *(Gap vs edgetunnel; see §G.)*

### C.2 Formats produced
| Sub | Core | Payload |
|---|---|---|
| normal | xray | JSON **array of complete Xray profiles** (per address×port×protocol + chain variants + Best Ping balancer), attachment `bpb-normal-xray.json` (`getXrCustomConfigs(false)`) |
| normal | sing-box | single JSON: tun+mixed inbounds, selector ✅ + urltest groups, ntp, cache_file, clash_api external-ui metacubexd (`getSbCustomConfig(false)`) |
| normal | clash/mihomo | JSON object (mihomo accepts JSON) with mixed-port 7890, tun, sniffer, proxy-groups, rule-providers, geo-auto-update 168h, keep-alive tuning, tcp-concurrent (`getClNormalConfig`, `clash/configs.ts:buildConfig`) |
| fragment | xray / sing-box | same builders with `isFragment=true` + Smart Fragment + workerless (xray only) |
| raw | xray / sing-box | **base64 v2ray URI list** (`getURLConfigs` in `cores/common.ts`): `vless://uuid@addr:port?...type=ws&security=tls&sni=<randcase>&fp=chrome&alpn=http/1.1&host=&path=/vl/<rand>?ed=2560#remark`; trojan analog with `username=trPass`; headers `Profile-Title: base64:…`, `DNS: <remoteDNS>` |
| warp / warp-pro | all cores | WireGuard outbound/endpoints/proxies + Amnezia opts **[EXCLUDED]** |
| warp/warp-pro | wireguard/amnezia | **ZIP of `.conf` files** via JSZip (`cores/wireguard.ts:getWireguardConfigs`; Amnezia adds `Jc/Jmin/Jmax/S1/S2/H1..H4`) **[EXCLUDED]** |
| share-settings | – | base64(JSON `SharedSettings`) as `bpb-settings.dat` download (`subscription.ts:shareSettings`); excludes vlUUID/trPass/securePath/customDomain/panelVersion (`types/settings.ts:SharedSettings`) |

- Remarks encode type: `F`(fragment) `D`(custom domain) `C`(custom CDN) `🔗`(chain) `Clean IP|Domain|IPv4|IPv6 : port` (`cores/utils.ts:generateRemark`).
- Chain proxies appended to normal+fragment subs across all three cores (`xray: buildChainOutbound` w/ dialerProxy; sb: `detour`; clash: `dialer-proxy`), each also aggregated into chain Best-Ping groups.

### C.3 Aggregation of foreign proxies
- `customSubs` (URL list) fetched at subscription time, auto-detecting base64 bodies (`isBase64`) and merging plain text lines (`cores/common.ts:fetchCustomSubs`) — merged **only into Raw sub**.
- `customConfigs` (raw URI lines) appended likewise.
- Validators enforce URL shape (`validators.ts:validateExtSubs`).

### C.4 QR codes
- Server-side PNG generation at `/{path}/qrcode?data=<config-url>`: `qrcode-generator` matrix + **hand-rolled PNG encoder** (crc32 table-less loop, zlib via WHATWG `CompressionStream('deflate')`, RGBA scanlines) — zero image deps (`handlers/qrcode.ts:createPNG/compressZlib/generateQRCode`). Same-origin check on inner URL; unwraps `sing-box://...?url=` deep links.
- Deep-link scheme for sing-box: `sing-box://import-remote-profile?url=<sub>` (telegram `api/telegram.ts:buildClientUrl`, panel `script.js:generateSubUrl`).

### C.5 Update intervals / caching
- All responses `Cache-Control: no-store...`; clients re-fetch manually. The only interval knob is bestPingInterval (client-side probing). **No `profile-update-interval` / `subscription-userinfo` headers emitted** (gap, §G).
- Clash geo assets auto-update weekly (`geo-auto-update:true, geo-update-interval:168`); sb/clash rule-set providers refresh daily (`interval:86400` in `clash/routing.ts:defineProvider`).

### C.6 Rule-set sources per core (parity table)
- Xray: geosite/geoip dat names (Loyalsoldier-compatible: `geosite:category-ir`, `geosite:openai`, `geosite:malware`, ...) — `xray/geo-assets.ts:getGeoAssets`.
- sing-box: Chocolate4U/Iran-sing-box-rules `.srs` remote rule-sets — `sing-box/geo-assets.ts`.
- clash: Chocolate4U/Iran-clash-rules `.txt` (Iran/security) + MetaCubeX/meta-rules-dat `.yaml` (cn/ru/vendor) — `clash/geo-assets.ts`.

---

## D. Panel UI

Single-page HTML at `/{path}/panel` (`handlers/panel.ts:renderPanel` decompresses gzip+base64 asset). Sections (`src/assets/panel/index.html`):

1. **Header**: logo/version, GitHub link, logout button.
2. **Admin** (`<h2>Admin`):
   - Last-24h Requests widget: BPB requests vs account-total, % of 100k free limit, red >80% (`script.js:getUsage`; backend `api/usage.ts:getCfWorkerUsage` via Cloudflare GraphQL `workersInvocationsAdaptive`).
   - *Settings* accordion: **Update Panel** (enabled when GitHub `package.json` version > deployed, `checkVersion/isNewerVersion`), **Reset Password**, **Delete Panel** (confirm modals).
   - *Telegram Bot* form: token + numeric user id, Setup/Remove (`api/telegram.ts:setupTelegramBot/removeTelegramBot` registers webhook `/{path}/telegram/webhook` and bot commands start/config/clients/usage).
3. **Proxy Settings** `<form id=configForm>` accordions:
   - *Common*: localDNS, antiSanctionDNS, fakeDNS, enableIPv6, allowLANConnection, logLevel(none/warning/error/info/debug), customDomain, dohUrl (Underlying DoH), securePath (+🎲 regenerate), fallback.
   - *VLESS–Trojan*: protocols (both/vless/trojan), vlUUID(+🎲), trPass(+🎲), remoteDNS, upstreamProxy, chainProxy, cleanIPs textarea, TLS/non-TLS port checkboxes, fingerprint select (10), bestPingInterval (10–90), enableTFO; sub-blocks: **Proxy IP** (mode proxyip/NAT64, proxyIPs textarea linking `/proxy-ip` page, prefixes textarea), **ECH** (enableECH, echServerName), **Custom CDN** (Addresses/Host/SNI).
   - *Xray Fragment*: Mode presets, Packets, Length min-max, Delay min-max, Max-Split min-max.
   - *External Raw Configs*: customSubs, customConfigs.
   - *Warp General* **[EXCLUDED]**: warpRemoteDNS, warpEndpoints, warpBestPingInterval, warpReservedBytes, Renew accounts.
   - *Warp PRO* **[EXCLUDED]**: MahsaNG knocker noise (mode/count/size/delay), Clash-Amnezia noise (count/size), v2ray noise dynamic rows (mode/packet-generator/count/delay-range, add/delete).
   - *Routing Rules*: Presets bypass Iran/China/Russia; block Ads/Porn/QUIC(UDP443)/Malware/Phishing/Cryptominers (last three show "risky rules" confirm about geo assets); Custom bypass/block IPs+domains; Sanction-bypass checkboxes ChatGPT/Google-AIs/Microsoft/Oracle/Docker/Adobe/EpicGames/Intel/AMD/Nvidia/Asus/HP/Lenovo + custom sanction domains.
   - *Import–Export*: remote settings URL + Import/Share buttons; file `.dat` import/export.
   - Sticky Apply button (enabled on diff detection `hasFormDataChanges`) + reset-to-default icon (`resetSettings` → `POST panel/reset-settings`).
4. **Subscriptions**: accordion per type × core table with QR / copy / download buttons (`renderSubscriptions`).
5. **DNS over HTTPS**: displays private DoH URL + copy.
6. **My IP**: dual-column geo table "Cloudflare targets" (icanhazip) vs "Other targets" (geojs.io), enriched via `POST panel/my-ip` → ip-api.com; emoji flags via polyfill.
7. **Supported Clients**: name/min-version/download-source table from `clients` registry.
8. Modals/templates: QR modal, Reset-password modal (username field shown only on first-run), toast/message template with promise-based confirm (`notify()`).

### Authentication mechanism
- Login page (`assets/login/index.html` + `script.js`): username = **Cloudflare account email**, password; POST `/{path}/login/authenticate`.
- Backend `src/auth/auth.ts:generateJWTToken`: compares lowercase email to embedded `accEmail` and password to KV `pwd`; JWT **HS256** signed with KV-stored random 32-byte hex `secretKey` (auto-created once), claims `{id: accID}`, exp **24 h**; cookie `jwtToken` `HttpOnly; Secure; SameSite=Strict`.
- `authenticate()` verifies cookie on every privileged route (`panel/settings`, `update-settings`, `reset-settings`, `reset-password`, `update-warp`, `update-panel`, `delete-panel`, `usage`, `proxy-ip/get|test`, telegram setup/remove).
- Logout: clears cookie client-side only (`auth.ts:logout`); token stays valid until expiry unless secretKey rotated.
- Reset password: allowed unauthenticated **only when no pwd exists yet** (first-run), else requires valid session; requires matching email as username; clears auth cookie afterwards (`auth.ts:resetPassword`). Client enforces ≥8 chars + capital + digit (`panel/script.js:resetPassword` regex).
- Default-credentials flow: Wizard generates everything; first panel load sees `status 401 && !isPassSet` → auto-opens forced "Set Password" modal with close hidden (`panel/script.js:initPanel` + `openResetPass(event)` w/o event hides close button).

---

## E. State management

### E.1 Env vars / bindings
- Only binding: KV namespace named exactly **`kv`** (docs + `Env` interface `types/global.d.ts`).
- Deploy-type detection: env `CF_PAGES === '1'` → pages, else workers (`settings.ts:init`).
- Legacy env vars `UUID`/`TR_PASS` now **cause a hard error** forcing BPB-Wizard v3 install (`init()` throw) — v5 is wizard/self-contained only (`RELEASE.md`).
- Everything else lives in `EMBEDED_SETTINGS` baked into the script at deploy time: `accID, accEmail, apiToken, vlUUID, trPass, securePath, proxyIpMode, proxyIPs, prefixes, mainDomain, fallback, dohUrl` (`settings/main.ts:buildScript`). Changing them via panel **redeploys the worker through the CF API** (`updateMainSettings` → `deployPages/deployWorkers`), deliberately avoiding D1 (`RELEASE.md` quote).
- `apiToken` (Cloudflare API token) is embedded plaintext in worker.js and used for: workers scripts PUT/DELETE + domains, pages deployments/domains/delete, zones list + CNAME create, GraphQL usage (`api/workers.ts`, `api/pages.ts`, `api/dns.ts`, `api/usage.ts`). Project/script name derived from `mainDomain.split('.')[0]`.

### E.2 KV schema (keys)
| Key | Type | Purpose | Writer |
|---|---|---|---|
| `pwd` | string | panel password (plaintext) | `auth.ts:resetPassword` |
| `secretKey` | hex string | JWT HMAC key (generated once) | `auth.ts:generateJWTToken` |
| `proxySettings` | JSON blob (~90 fields, `KvSettings`) | all tunables | `kv.ts:updateDataset` |
| `telegramBot` | `{telegramBotToken, telegramUserId}` | bot wiring | `api/telegram.ts` |
| `warpAccounts` | JSON `WarpAccount[]` (2 accounts) | WG credentials **[EXCLUDED]** | `api/warp.ts:fetchWarpAccounts` |

- Version migration: `VERSION !== settings.panelVersion` triggers `updateDataset(env)` which merges each known field with defaults (`fields` array in `kv.ts:updateDataset` — authoritative list of every setting) and stamps `panelVersion`.
- Side-effects wired into the settings merge: changing `customDomain` triggers `setCustomDomain` (zone lookup + Pages domain + CNAME / Workers domain); changing `chainProxy/upstreamProxy` parses params; changing `remoteDNS` pre-resolves host IPs (`getParam(key, cbKey, callback)` pattern).

### E.3 Self-redeploy / lifecycle endpoints
- `POST panel/update-panel` → `buildScript(true)`: downloads latest GitHub release `worker.js`, prepends fresh `EMBEDED_SETTINGS` + **anti-signature padding code** (`paddCode`: 50–500 random dummy vars/functions) and redeploys (`panel.ts:updatePanel`, `main.ts:paddCode`).
- `POST panel/delete-panel` → deletes worker script or Pages project (`panel.ts:deletePanel` → `api/workers.ts:deleteWorker` / `api/pages.ts:deletePagesProject`).
- Build pipeline embeds its own source (`SOURCE_CONTENT`) precisely to enable these in-place upgrades (`scripts/build.js:buildWorker`).

### E.4 Deployment modes
- Officially **BPB Wizard only** (one-click web/CLI wizard deploys with token; private relink) — manual dashboard paste and wrangler are dead ends in v5 (`RELEASE.md`, FAQ "error 1101").
- Workers vs Pages both supported at runtime (`deployType` switches API calls and non-TLS port availability).

---

## F. Unique/differentiating features worth copying

Ranked by value to the unified rebuild. Each with evidence.

1. **Self-managing deployment (no env vars)** — settings changes rebuild + redeploy the worker via CF API; update/delete/reset from UI. `src/settings/main.ts:updateMainSettings/buildScript/paddCode`, `src/handlers/panel.ts:updatePanel/deletePanel`.
2. **Full-config subscriptions (not just URI dumps)** for Xray/sing-box/mihomo with bundled DNS, routing, sniffing, TUN, NTP, cache — `src/cores/{xray,sing-box,clash}/*`.
3. **Best-Ping auto-select configs** (leastPing balancer + observatory / urltest groups, tunable interval, separate Custom-Domain group) — `xray/configs.ts:addBestPingConfigs/buildBalancer`, `sing-box/outbounds.ts:buildUrlTest`, `clash/outbounds.ts:buildUrlTest`.
4. **Smart Fragment**: 20-length fragment sweep in one profile — `xray/configs.ts:addBestFragmentConfigs`.
5. **Workerless/serverless rescue configs** (work even when the worker domain is blocked; fragmented freedom + QUIC-noise + pinned DoH) — `xray/configs.ts:addWorkerlessConfigs`.
6. **NAT64 dynamic proxy IPs** from editable prefix list — `protocols/common.ts:convertToNAT64IPv6`, `validators.ts:validateNAT64Prefixes`.
7. **Zero-byte-failover retry** to a *random* proxy IP (or NAT64) only when needed — `protocols/common.ts:handleTCPOutBound.retry` + `hasIncomingData` flag.
8. **ProxyIP explorer page with health scoring** (success-rate/latency over 5 raw-TLS probes against `speed.cloudflare.com/__down`) + public catalog aggregation + batch geo lookup — `handlers/proxy-ip.ts:checkProxyIP/testProxyIP/geoLookupBatch`.
9. **Private DoH endpoint with swappable upstream** — `handlers/doh.ts`, `dohUrl` setting, shown in UI with copy button.
10. **ECH support incl. custom ECH server name** across all three cores + HTTPS-record bootstrap rule — `xray/outbounds.ts:buildTlsSettings`, `sing-box/dns.ts` (query_type HTTPS), `clash/outbounds.ts:ech-opts`.
11. **Custom-CDN masking** (addresses/host/SNI triple, skip-cert-verify, `C` remark, merged into subs) — `utils.ts:selectSniHost/generateRemark`.
12. **Upstream TCP proxy** extra address/port pair generation — `utils.ts:extractUpstreamParams`, consumption in all normal/raw builders.
13. **Rich chain proxy** supporting vless/vmess/trojan/ss/socks/http with tcp/http-header/ws/grpc/httpupgrade/xhttp transports and tls/reality security + VLESS-encryption passthrough — `utils.ts:extractProxyParams`, `validators.ts:validateChainProxy`, per-core `buildChainOutbound`.
14. **Foreign-subscription aggregation** into Raw sub with base64 autodetect — `cores/common.ts:fetchCustomSubs`.
15. **Cross-panel settings sharing/import** (base64 .dat export, remote URL import, share excludes secrets) — `subscription.ts:shareSettings`, `panel/script.js:importRemoteSettings/fetchSettings`.
16. **Telegram bot ops console**: webhook self-setup/removal, inline menus, delivers QR photo + config document per sub type, usage monitor + proactive >80% warning — `api/telegram.ts:setTelegramBot/handleTelegramWebhook/checkCfUsageWarning`.
17. **Usage dashboard** via CF GraphQL (24h window, per-script vs account totals, % bars) — `api/usage.ts:getCfWorkerUsage`.
18. **Per-request-random WS paths** + **randomized-uppercase SNI** + **junk-code padding** (anti DPI-fingerprinting trio) — `utils.ts:generateWsPath/randomUpperCase`, `main.ts:paddCode`.
19. **Compulsory SECURE_PATH** gating panel/subs/APIs with in-panel regeneration + redirect — `worker.ts` path switch, `validators.ts:validatePath`, `panel/script.js` redirect logic.
20. **Sanction-vendor bypass preset list** (OpenAI/GoogleAI/Microsoft/Oracle/Docker/Adobe/Epic/Intel/AMD/Nvidia/Asus/HP/Lenovo) routed via dedicated anti-sanction DNS — `xray/geo-assets.ts`, `dns.ts` sanction server wiring.
21. **Backend validation layer** returning per-field error arrays rendered as toasts — `settings/validators.ts` (24 validators), `respond()` envelope in `common/common.ts`.
22. **First-run forced credential setup UX** (401+isPassSet=false opens mandatory Set-Password modal) — `panel/script.js:initPanel/openResetPass`, `auth.ts:resetPassword`.
23. **Camouflage fallback** for unknown paths — `handlers/utils.ts:fallback`.
24. **LAN-exposure toggle** flipping inbound listen 127.0.0.1↔0.0.0.0 with documented client ports (10808/2080/7890) — `xray/inbounds.ts`, `sing-box/inbounds.ts`, `clash/configs.ts`, docs common.md.
25. **KV-schema versioning with default-merge migration** — `kv.ts:updateDataset` field table.
26. **Server-side QR PNG encoder with zero deps** — `handlers/qrcode.ts:createPNG/compressZlib`.
27. **My-IP dual-egress comparison** (CF egress vs general egress) — `panel/script.js:fetchIPInfo`, `panel.ts:getMyIP`.
28. **UDP-noise editor** (multi-entry rand/str/hex/array/base64 generators) — reusable beyond Warp-Pro for QUIC blocking — `panel/script.js:addNoise/genNoisePacket`, `xray/outbounds.ts:buildUDPNoises`. *(Noise-on-WireGuard usage itself is EXCLUDED.)*

**[EXCLUDED — WARP cluster]**: Warp/WoW/Pro subscriptions, Wireguard/Amnezia conf zips, warp endpoint scanning, reserved-bytes toggle, knocker/amnezia noise on WG, `warpAccounts` KV + renewal, `warpRemoteDNS`. Files: `api/warp.ts`, `cores/wireguard.ts`, warp branches in all config builders, panel sections "Warp General"/"Warp PRO". Target panel must NOT ship these.

---

## G. Known weaknesses / bugs visible in code (fix in rebuild)

1. **No UA-based client detection** — `app` query param required; wrong link → camouflage 404 (`settings.ts:init`, `subscription.ts`). Unified panel should sniff `User-Agent` (v2rayNG/sing-box/clash…) like edgetunnel does.
2. **Single-user design** — one UUID + one trojan password for everyone; no user accounts/quotas/expiry; no `subscription-userinfo` header (no traffic accounting) anywhere in `handlers/subscription.ts`.
3. **Secrets exposure by design**: `apiToken` embedded plaintext in every deployed worker.js (readable via CF versions/diff) — `main.ts:buildScript`; `pwd` stored plaintext in KV (`auth.ts`); `shareSettings` hands the entire settings blob (incl. `chainProxyParams` which may contain upstream credentials) to anyone knowing the SECURE_PATH, unauthenticated (`subscription.ts:shareSettings`, `SharedSettings` includes chainProxyParams via KvSettings spread).
4. **Auth hardening gaps**: login/password compare not constant-time, no rate limiting/lockout on `/login/authenticate` or `resetPassword`; logout doesn't revoke JWT (stateless 24h, only secretKey rotation would kill sessions) — `auth/auth.ts`.
5. **WS path randomness is cosmetic** — `handleWebsocket` dispatches on first segment only (`/vl/*`, `/tr/*` accept ANY suffix) (`handlers/websocket.ts`); the random suffix exists purely in client configs. Rebuild should validate the configured path.
6. **Hard-coded DoH inside VLESS UDP handler** contradicts configurable remoteDNS (and validator bans CF DNS elsewhere): `vless.ts:handleUDPOutBound` fetches `https://cloudflare-dns.com/dns-query` unconditionally.
7. **Third-party calls over plain HTTP**: `getMyIP` → `http://ip-api.com/json/...` (`panel.ts:getMyIP`), `geoLookupBatch` → `http://ip-api.com/batch` (`proxy-ip.ts`) — cleartext + 45 req/min rate limit; also leaks lookup targets to ip-api.
8. **SSRF-ish, uncached external sub fetching** on every Raw-sub request with no timeout/size cap — `cores/common.ts:fetchCustomSubs`.
9. **Runtime supply-chain trust**: `update-panel` pulls `releases/latest/download/worker.js` unpinned (`main.ts:buildScript(!settings)` branch); version check fetches raw.githubusercontent package.json from browser (`panel/script.js:checkVersion`).
10. **Clash output is JSON, not YAML** (`application/json`, filename `-clash.json`) — works on mihomo but breaks strict YAML-only clients (`clash/configs.ts` responses).
11. **Error responses leak internals**: `renderError` injects `safeError(error)` message straight into HTML (`handlers/error.ts`); several handlers return raw error strings (`panel.ts:updateMainSettings catch`).
12. **KV read amplification**: every sub/telegram request runs `setSettings → getDataset` doing up to 3 KV reads (`proxySettings`, `warpAccounts`, `telegramBot`) with no isolate-level caching TTL (`kv.ts:getDataset`) — burns free-tier read quota; settings blob rewritten wholesale on each change (read-modify-write race between concurrent admin tabs).
13. **Minor logic smells**: `clash/outbounds.ts:buildOutbound` names param `isIPv6` while assigning `'ip-version': isIPv6 ? 'ipv4-prefer' : 'ipv4'` (inverted naming); duplicate ranges in `bestFragValues` (`xray/configs.ts`); `qrcode` called with POST from panel but GET from telegram (works, inconsistent); commented-out dead TUN inbound for xray (`xray/inbounds.ts`); hardcoded default Warp keys in repo (`settings.ts:warpAccounts`) — moot post-exclusion.
14. **No tests, no CI lint of runtime behavior** (repo has only tsc/eslint configs; workflows build docs/releases) — rebuild should add contract tests per core-output.
15. **UDP reality**: worker cannot relay UDP; VLESS DNS-over-DoH hack + blanket `NETWORK,udp REJECT` in non-warp subs (`xray/routing.ts`, `sing-box/routing.ts`, `clash/routing.ts`) — Telegram calls broken (documented limitation README §Limitations). Rebuild should surface this honestly and consider QUIC-block defaults.

---

### Quick reference — route map (`src/worker.ts`)
```
GET  /:sp/panel                 renderPanel          (JWT-gated*)
GET  /:sp/login                 renderLogin
POST /:sp/login/authenticate    generateJWTToken
PUT  /:sp/panel/settings        getPanelSettings*
PUT  /:sp/panel/update-settings updatePanelSettings*
POST /:sp/panel/reset-settings  resetPanelSettings*
POST /:sp/panel/reset-password  resetPassword        (open on first-run)
POST /:sp/panel/my-ip           getMyIP
POST /:sp/panel/update-warp     [EXCLUDED]
POST /:sp/panel/update-panel    updatePanel*
POST /:sp/panel/delete-panel    deletePanel*
GET  /:sp/panel/usage           getUsage*
GET  /:sp/panel/logout          logout
GET  /:sp/sub/:type             handleSubscriptions  (ungated; secret-path only)
GET  /:sp/share-settings        shareSettings        (via /sub/share-settings)
PUT  /:sp/telegram/setup        setupTelegramWebhook*
POST /:sp/telegram/remove       removeTelegramBot*
POST /:sp/telegram/webhook      handleTelegramWebhook
ANY  /:sp/dns-query             handleDoH            (private DoH)
GET  /:sp/proxy-ip[/get|test]   handleProxyIPs*      (page redirects to login if unauthenticated)
GET  /:sp/qrcode                generateQRCode
WS   /vl/* /tr/*                VLESS/Trojan handlers
ELSE                            fallback (camouflage/404)
```
