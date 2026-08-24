# edgetunnel — Exhaustive Capability Inventory

> Research target #2 of 3 for the unified-panel rebuild (BPB / edgetunnel / nahan comparison).
>
> **Repo analyzed:** https://github.com/cmliu/edgetunnel (shallow clone, `main` @ `Version = '2026-08-11 14:45:22'`, `wrangler.toml` name `v20251104`)
> **Original (history only):** https://github.com/zizifn/edgetunnel — not needed; cmliu v2.x is a near-total rewrite. The original was a minimal VLESS-over-WS demo; everything below describes the maintained fork.
> **Source:** single file `_worker.js`, ~6,630 lines, identifiers largely in Chinese. Plus `README.md`, `CHANGELOG` (mojibake but parseable), `wrangler.toml`.
> All citations: `_worker.js:<line>` + function name (Chinese names transliterated in parentheses).
>
> **WARP note:** zero WARP integration anywhere in the codebase (grep confirms). Everything below is directly relevant to the target architecture; no exclusions needed.

---

## A. Protocols & Transports

### A1. Protocol set
| Protocol | Inbound parse | Outbound link | Notes |
|---|---|---|---|
| VLESS | ✅ | ✅ default (`协议类型 = "vless"`, :5595) | Standard VLESS request frame |
| Trojan | ✅ | ✅ (via subconverter when `协议类型 != 'ss'`; Surge forced to trojan :349) | sha224-hex password = UUID |
| Shadowsocks (SS) | ✅ | ✅ opt-in (`SS.加密方式`, v2ray-plugin URI) | aes-128-gcm / aes-256-gcm AEAD |
| VMess | ❌ | ❌ | Not implemented |
| SOCKS5/HTTP(S)/TURN/SSTP | n/a | ✅ as egress (chained proxy) | See §C4 |

**Multi-protocol single-port sniffing:** the first inbound data chunk is classified at runtime — `处理WS入站数据` (:1651–1660): if URL has `enc=` param → SS; else if `bytes[56]==0x0D && bytes[57]==0x0A` → Trojan; else VLESS. Same sniffing duplicated in gRPC (:1177) and XHTTP (`读取叉HTTP首包` tries both parsers per accumulated chunk, :962–968). One endpoint serves all three protocols.

### A2. VLESS handshake details — `解析魏烈思请求` (:1964)
- `data[0]` = version byte; echo it back as response header `[version, 0]`.
- UUID raw 16 bytes at offset 1, compared via cached byte table `UUID字节匹配`/`获取UUID字节` (:1934–1962, LRU-ish cache capped 32).
- `data[17]` option length → cmd index `18+optLen`; cmd `1`=TCP, `2`=UDP.
- Address types: `1`=IPv4 (4B), `2`=domain (len-prefixed), `3`=IPv6 (16B) — standard numbering.
- Port big-endian after address-type byte.
- **UDP restriction:** only port 53 (DNS); anything else throws `UDP is not supported` (:1698).

### A3. Trojan handshake details — `解析木马请求` (:1858)
- First 56 bytes must equal ASCII hex of `sha224(password)` where password = the UUID string (pure-JS `sha224` impl :6392).
- Bytes 56/57 must be CRLF.
- Then SOCKS5-style: cmd `1`=CONNECT, `3`=UDP ASSOCIATE; atype `1`=IPv4, `3`=domain, `4`=IPv6 (SOCKS numbering); BE port; trailing CRLF delimiter before payload (:924 checks it in streaming parser).
- **Trojan UDP** has full packet framing support (`转发木马UDP数据` :2040 parses ATYP+port+2B-len+CRLF frames), but payload port must still be 53 unless a *trojan fallback* upstream is configured (§C5).

### A4. Shadowsocks implementation (over WebSocket only)
- Ciphers: `aes-128-gcm` (keyLen16/salt16), `aes-256-gcm` (32/32), maxChunk 0x3FFF (`SS支持加密配置` :2014).
- Key derivation: EVP_BytesToKey-style MD5 chain from password=UUID (`SS派生主密钥` :2119, uses `crypto.subtle.digest('MD5')`); HKDF-SHA1 subkey with info `"ss-subkey"` (`SS派生会话密钥` :2138); incrementing 12-byte nonce AES-GCM (`SSAEAD加密/解密` :2155/:2162).
- Inbound auto-negotiation: tries every candidate cipher AND scans up to 16B leading-noise offset to find valid salt+length-block (`初始化入站解密状态` :1409–1445) — tolerates clients that prepend junk or misreport `enc=`.
- Outbound: fresh random salt prefixed once, then [2B len|tag][payload|tag] chunks ≤32KB (`加密并发送` :1490).
- Selected by `?enc=<method>` path/query param; early-data is deliberately disabled in SS mode to avoid misparsing the WS subprotocol header as base64 payload (:1776 comment).
- Link format: `ss://btoa(cipher:uuid)@host:port?plugin=v2ray-plugin%3Bmode%3Dwebsocket...` (:442–450, :5779–5780).

### A5. Transports
| Transport | Handler | Config emission |
|---|---|---|
| **WebSocket** | `处理WS请求` (:1290) | `type=ws&path=...&host=...` |
| **gRPC** (gun/multi) | `处理gRPC请求` (:979) | `type=grpc&mode=gun|multi&serviceName=...&authority=...` (`获取传输协议配置` :4783) |
| **XHTTP stream-one** ("叉HTTP") | `处理叉HTTP请求` (:595) | `type=xhttp&mode=stream-one&extra={"xPaddingObfsMode":true,"xPaddingMethod":"tokenish","xPaddingPlacement":"queryInHeader","xPaddingHeader":"<uuid-slice>","xPaddingKey":"<uuid-slice>"}` |

XHTTP specifics:
- Padding obfuscation derived from UUID: header name = uuid chars 1–7, query key = `_`+uuid chars 25–31 (`获取叉HTTPPadding标识` :551). Requests carry padding whose **HPACK-Huffman encoded length must be 98–1002 bytes** or rejected (`校验叉HTTPPadding` :578, huffman table :531); responses embed a random 100–999-char base62 padding in the mirrored header (:628–631). This defeats naive HTTP-fingerprint blocking and adds active-probe resistance.
- Full-duplex streaming: uplink reader → coalescing writer → socket.writable; downlink socket.readable → IdentityTransformStream → Response body (:662–708).
- UDP-over-XHTTP supported for trojan DNS framing (:711 `处理叉HTTPUDP请求`).
- gRPC downlink frames wrapped in protobuf varint envelope with microtask/timer-based batching queue (:1008–1079); uplink strips `0x0a` field headers (:1152–1166).

### A6. Early data (0-RTT)
- WS: `sec-websocket-protocol` header carries base64url-encoded first protocol payload; max 8KB (`WS早期数据最大字节` :6), decode `解码WS早期数据` (:1260, native `Uint8Array.fromBase64` fast-path + manual fallback), validated against UUID-or-trojan-hash before use (`是有效WS早期数据` :1248). Injected into the same ordered processing chain (:1777–1784).
- Links add `?ed=2560` when config `启用0RTT` is on (:400, :438, :5769).
- XHTTP/gRPC get their first payload straight off the request body reader.

---

## B. Core Data Path (WebSocket↔TCP relay)

### B1. Socket acquisition — `创建请求TCP连接器` (:3329)
Uses `request.fetcher.connect()` (not the global `connect()`), throwing if unavailable — this is the modern Workers/Pages-compatible TCP API.

### B2. Connection strategy — `forwardataTCP` (:2169)
Order of attempts:
1. **Direct connect** (`connectDirect` :2295) with **concurrent dial racing**: opens `TCP并发拨号数` sockets (default 2, env `TCP_CONCURRENT_DIAL`) simultaneously to host:port, `Promise.any` wins, losers closed (`并发打开候选连接` :2241). 1s open timeout (`等待连接建立` :2216).
   - Auto-degrades to 1 dial on China-Mobile client ASN (`识别运营商` :5833 returns `'cmcc'` → force 1, :42).
   - Optional **preload race dial** (`PRELOAD_RACE_DIAL`): DoH-resolve A+AAAA first, race up to N resolved IPs instead of hostname (`构建预加载竞速候选列表` :2264, IPv4 preferred then IPv6 fill).
   - First payload written into winning socket immediately (`写入首包` :2234).
2. On failure (or on empty downlink, see B5): **fallback through proxyIP pool** (`connecttoPry` :2351 → `connectProxyIP` :2318) — iterates resolved `[ip,port]` candidates in batches of `PROXY_CONCURRENT_DIAL` (default 1), round-robin start index persisted across calls (`反代数组索引` :2175), writing the original first packet through the tunnel. Falls back to direct if all proxies fail and `反代兜底=true`.
3. If chained-proxy type present (socks5/http/https/turn/sstp) or host matches GO2SOCKS5 whitelist → skip direct entirely (`:2432` regex-whitelist test).
4. **Trojan fallback**: if `/trojan=host:port` configured, relay raw trojan stream to that upstream instead (`连接木马反代` :1811, handshake/payload split via `提取木马反代握手数据` :1830).

Connection generations prevent stale writes across re-dials: `开始TCP连接世代`/:799, `失效TCP连接世代`/:789 bump a generation counter; installs verify `remoteConnWrapper.generation === generation && remoteConnWrapper.socket === socket` before wiring streams (:2199–2205).

### B3. Uplink (client→remote)
- WS messages queued on an explicit serial task chain with hard caps 16 MiB / 4096 items (`入队WS显式传输` :1733, overflow ⇒ close :1738).
- `创建上行写入队列` (:2682): coalesces queued chunks into ≤20KB bundles (`上行合包目标字节` :7), tracks per-item write-completion promises, awaits connection promise before writing, transparently retries failed writes through `retryConnect` reusing already-queued data (:2748–2759).
- `创建上行Grain合包流` (:2601): timer/microtask-driven coalescing buffer used by XHTTP uplink.

### B4. Downlink (remote→client)
- `connectStreams` (:3026) reads remote socket with **BYOB reader** (64KB reads, graceful default-reader fallback :3036).
- `创建下行Grain发送器` (:2826) batches into 32KB WS frames (`下行Grain包字节` :8): flush when full or within 512B of full (tail threshold), otherwise wait up to 4 rounds of 1ms for low-watermark accumulation (`下行Grain低水位字节`); chunks ≥32KB bypass batching (`直接发送`). Guarantees header injection exactly once (`附加响应头` :2886). Draining on reconnect awaited before new install (`停止并刷新` :3006, consumed by generation logic :808).
- `WebSocket发送并等待` (:2520) awaits send() if promise-returning (new WS semantics).

### B5. Dead-direct detection & silent retry
`connectStreams` records whether any byte ever arrived; if **zero data** came back from a direct connection and a retry function exists, it transparently redials via `connecttoPry` (through proxyIP/chained proxy) without closing the client socket (:3083–3090). This is the mechanism that makes blocked direct routes self-heal mid-session.

### B6. UDP / DNS handling — `forwardataudp` (:2467)
All UDP (VLESS cmd=2, trojan cmd=3, XHTTP UDP) is DNS-only: payload written over **TCP to 8.8.4.4:53** (DNS-over-TCP length-prefix added for trojan frames :2077–2083), response streamed back with optional re-framing callback for trojan UDP envelopes (:2086–2109). No general UDP relay.

### B7. Speed-test interception — `isSpeedTestSite` (:3096)
Requests to `speed.cloudflare.com` / `cp.cloudflare.com` are answered locally with a hand-built `HTTP/1.1 204` inside the tunnel stream (`构造本地204响应` :3102 / WS variant :3118, buffered multi-request state machine :1328–1354). Saves egress quota and makes client latency tests reflect edge-only RTT.

---

## C. ProxyIP & Egress Logic

### C1. Default proxyIP derivation — anti-tarpit string obfuscation
`特征码字典` (:11–15) builds three strings at runtime so GitHub code-search/tar-pit scanners don't index them:
- `"PROXYIP"` (from `Proxy.name`),
- `"cmliu"` (from char codes + `URL.name`),
- `"090027"`-style digit string (2407*300−10 reversed).
Default proxyIP = `{request.cf.colo}.proxyip.cmliussss.net`-equivalent (:43); final last-resort proxyIP host = `proxyip.tp1.<dict[2]>.xyz` (:2407). ⚠️ Trust implication: with no PROXYIP env set, egress flows through author-controlled infrastructure.

### C2. Resolution order (`反代参数获取` :6159)
Per-request override resolution, highest priority first:
1. `/video/<xor-base64>` path → full chained-proxy JSON (type/username/password/hostname/port), XOR-keyed with UUID (`base64SecretDecode` :4764) — generated by subscription builder from node remarks `$socks5://user:pass@h:p` (:426–435). Sets global mode, disables fallback.
2. `?socks5=` / `?http=` / `?https=` / `?turn=` / `?sstp=` query params (per-request, non-global unless `?globalproxy` also present).
3. `?proxyip=<value>` — plain value sets proxyIP (no global proxy); if value is a URL form it becomes a global chained proxy (:6244–6249).
4. Path forms: `/socks5://...` `/http://...` (URL style ⇒ global), `/(g)s5=` `/(g)http=` `(g)` prefix ⇒ global (:6252–6262), `/proxyip=` `/pyip=` `/ip=` (:6263).
5. `/trojan=<host>:port` → trojan fallback target (:6234, parser `解析木马反代地址` :1791, strict host:port incl. bracketed IPv6).
6. Else: env `PROXYIP` (comma list ⇒ random pick each isolate boot :44–48) else colo-derived default.

Global-vs-per-request: `代理全局` flag decides whether ALL destinations route through the chained proxy, or only hosts matching the whitelist (`forwardataTCP` :2432).

### C3. ProxyIP pool expansion — `解析地址端口` (:6425)
A proxyIP entry can be:
- literal IPv4 / bracketed IPv6 (+ optional `:port`);
- domain with `.tpNNN` suffix meaning port NNN (:6457);
- **domain backed by DNS TXT records containing bulk IP lists** (`\010` or newline separated, quotes stripped — `解析TXT反代记录` :6441) → expanded to many candidates;
- plain domain → DoH A records → AAAA records (DoH resolver with TTL-aware cache, max 256 entries, `DoH查询` :5427).
Final candidate list deterministically shuffled with seed = sum(charCodes(target-root-domain + UUID)) (stable per destination, load-spreading across workers), top **8** kept (:6499–6505).

### C4. Chained-proxy client implementations (all pure JS over `fetcher.connect`)
- **SOCKS5** `socks5Connect` (:3134): method negotiation, optional user/pass auth (RFC1929), CONNECT with domain atype.
- **HTTP CONNECT** `httpConnect` (:3170): Basic auth optional; handles tunneled bytes pipelined after the 2xx response by re-injecting them into a TransformStream front (:3209–3217).
- **HTTPS CONNECT** `httpsConnect` (:3228): custom TLS client over raw socket; AES-GCM first, ChaCha20 fallback retry (:3247–3254).
- **Custom TLS 1.2/1.3 client** `TlsClient` (:3686, credited "@Alexandre_Kojeve"): full ClientHello builder (X25519+P-256 key shares, ALPN, SNI), ServerHello/HRR detect (HRR unsupported), TLS1.3 HKDF key schedule + TLS1.2 PRF, AES-GCM via WebCrypto and **pure-JS ChaCha20-Poly1305** (:3434–3523). Used for HTTPS-proxy egress and the admin proxy-checker.
- **TURN/TCP** `turnConnect` (:4136): STUN Allocate → 401 challenge → long-term-credential MD5 integrity key → CreatePermission → Connect → second TCP ConnectionBind; returns data-connection duplex streams. Target must resolve to IPv4 (DoH).
- **SSTP** `sstpConnect` (:4323): `SSTP_DUPLEX_POST /sra_{GUID}/` HTTPS upgrade + SSTP control/data packets + **PPP stack** (LCP negotiate, PAP auth, IPCP address acquisition) + hand-built TCP-over-PPP (SYN/ACK/FIN, seq tracking, checksums, MSS 1400 segmentation) — i.e., SoftEther VPN egress from a Worker.
- Credential parser `获取SOCKS5账号` (:6301): `user:pass@host:port`, base64 auth segment auto-decode, bracketed IPv6, scheme stripping; default ports map {socks5:1080, http:80, https:443, turn:3478, sstp:443} (:6295).
- Whitelist forcing: built-in domains (`*tapecontent.net`, `scholar.google.com`, … :3) + env `GO2SOCKS5` additions, wildcard→regex matching (:2432).

### C5. Trojan fallback (egress)
`/trojan=1.1.1.1:1234` relays the authenticated trojan stream verbatim to an upstream trojan server (same password, non-TLS, non-WS) — README documents it as high-performance full-feature mode incl. UDP passthrough (:README:163–166).

---

## D. Subscription Generation

### D1. Identity & token model
- Admin password aliases: `ADMIN|admin|PASSWORD|password|pswd|TOKEN|KEY|UUID|uuid` (:29).
- User UUID: env `UUID` if strict UUIDv4, else `MD5MD5(ADMIN+KEY)` formatted as v4 (:31–34). Changing password rotates identity.
- Double-MD5 token primitive `MD5MD5` (:5392): md5(hex(md5(x)[7..27])).
- Sub token: `token = MD5MD5(host + userID)` (:304, recomputed :5782). Quick-sub path: `GET /<KEY-value>` → 302 to `/sub?token=…` (:86–89).
- Subconverter backend gets a **daily-rotating token** `MD5MD5(XOR-base64(subToken,userID) + dayIndex)`, today+yesterday accepted (:307–313) — backend never sees the real sub token.

### D2. Endpoints (non-KV deployments only get WS proxying; everything below requires KV binding except WS)
| Route | Purpose | Evidence |
|---|---|---|
| `/<KEY>` | quick-sub redirect → `/sub?token=` | :86–89 |
| `/login`, `/logout`, `/admin/*` | panel auth + management (§E3) | :90–302 |
| `/sub?token=` | subscription output (all formats) | :303–495 |
| `/version?uuid=` | build-version probe w/ fuzzy uuid checksum match | :54–66 |
| `/locations` | proxied speed.cloudflare.com/locations (auth'd) | :496–499 |
| `/robots.txt` | `Disallow: /` | :500 |

### D3. Format selection — UA sniffing + params (:332–346)
Priority: `target=` param → `clash|meta|mihomo` UA/param → `sb|singbox|sing-box` → `surge` (ver=4) → `quanx|quantumult` → `loon` → mixed(base64). `b64`/`base64` params or subconverter markers (`subconverter-request/-version` headers, UA contains `subconverter`/`CF-Workers-SUB`) force `mixed`. Non-browser UAs get `Content-Disposition: attachment`.

### D4. Node synthesis pipeline (mixed/local mode, :351–455)
1. Source list assembled from KV `ADD.txt`, or **random IPs generated from Cloudflare CIDR lists fetched per-ISP from GitHub** (`生成随机IP` :5863: files `CF-CIDR.txt` / `CF-CIDR/{ct,cu,cmcc,cf}.txt`, ISP chosen from client ASN/org `识别运营商` :5833 or `cnIspCode` param; names like `CF电信优选N`; ports drawn from TLS set).
2. Each list element classified (:362–387): `sub://…` or `https://…` → preferred-API fetchers; other `proto://` links → passed through verbatim (foreign-node injection); bare addresses → preferred-IP nodes. Wildcard `*` in address/remark expands to random 3–16 char strings (`替换星号为随机字符` :5414) — per-fetch randomized hostnames defeat static blocking.
3. Preferred APIs fetched concurrently (`请求优选API` :5955) supporting: b64/plain subscriptions, plain `ip[:port][#remark]` lists, **two CSV dialects** — CloudflareSpeedtest format (columns `IP地址/端口/数据中心/TLS`, rows filtered `TLS=true`) and delay/speed-test format (`IP/延迟/下载速度` → remark `CF优选 123ms 45MB/s`) — plus charset fallback utf-8↔gb2312, `#API备注名` suffix tagging, `proxyip=true` flag promoting fetched entries into a **reverse-proxy pool** reused for those nodes' paths (:392, :436–439).
4. Address parsing regex accepts domain / dotted-IPv4 / bracketed-IPv6 with optional `:port` and `#remark` (:404–422); default port 443.
5. Per-node path assembly: base PATH + proxyIP template (`proxyip=<ip>`), or XOR-encoded chained-proxy path from `$socks5://…` remarks (:426–435), `ed=2560` when 0-RTT, comma-encoding for Loon/Surge (:440).
6. **Placeholder scheme:** nodes are emitted with fixed fake credentials `00000000-0000-4000-8000-000000000000` and host `example.com`; after generation both (and their base64 form) are replaced with real UUID and a **randomized rotation of HOSTS entries** — every sni/host pair consistent, different per node pair (:469–483). Downstream converters never see the real domain.
7. Random path camouflage: optional `随机路径` prepends 1–3 plausible directory segments from a ~200-word list (`随机路径` :5406).
8. TLS fragmentation params injected per client: Shadowrocket `fragment=1,40-60,30-50,tlshello`, Happ `fragment=3,1,tlshello` (:352).
9. ECH parameter `ech=SNI+DoH-URL` appended when enabled (:400).

### D5. External formats via subconverter backend (:456–467)
Non-mixed targets are delegated: `GET {SUBAPI}/sub?target=…&url=/sub?target=mixed&token=<daily>&cnIspCode=<isp>&config={SUBCONFIG}&emoji&list&scv&xudp&udp&tls13&append_type&sort`. Defaults point at author-hosted converter + ACL4SSR_Online_Mini_MultiMode_CF.ini rules (:5626–5627). Response post-processing "hot patches":
- **Clash** `Clash订阅配置文件热补丁` (:4810): injects complete DNS block (nameservers/fallback/geoip-filter), `nameserver-policy` for HOSTS+ECH SNI, per-node `grpc-user-agent`, per-node `ech-opts {enable, query-server-name}` matched by UUID; flow/block YAML styles handled separately.
- **sing-box** `Singbox订阅配置文件热补丁` (:5027): large migration shim to sing-box 1.12+/1.13 schema — geoip/geosite→remote rule-set `.srs` URLs, legacy DNS server address syntax→typed servers, fakeip object migration, tun inet4/6_address→address/route_address, action-route/sniff/predefined rcode rules, REJECT→block outbound; adds per-node `tls.utls.fingerprint` and `tls.ech {enabled, query_server_name}` on UUID/password match (:5270–5298).
- **Surge** `Surge订阅配置文件热补丁` (:5307): rewrites trojan lines to ws transport with ws-path/ws-headers, prepends `#!MANAGED-CONFIG` interval line.

### D6. Port behavior matrix (:444–447)
TLS ports `[443,2053,2083,2087,2096,8443]` ↔ plain ports `[80,2052,2082,2086,2095,8080]` mapped 1:1 — applied when generating **SS links with `SS.TLS=false`** (noTLS variant swaps port accordingly and drops `;tls` plugin flag). For VLESS/trojan, node ports come straight from preferred-list entries; the worker itself is port-agnostic (CF edge terminates TLS).
Headers returned: `Profile-Update-Interval` (=SUBUpdateTime hours), `Profile-web-page-url`, `Subscription-Userinfo upload/download/total/expire` populated from live CF account usage (:325–330).

### D7. BEST_SUB generator mode (:304, :314–317)
With `BEST_SUB=true`, a request shaped `/sub?host=example.com&uuid=00000000-…&token=<any>` from a UA matching `tunnel (https://github.com/cmliu/edge…` is served as a **preferred-sub generator**: emits placeholder nodes for any caller's IPs. This lets one instance act as upstream IP-feeder for other workers (the `获取优选订阅生成器数据` consumer :5904 fetches exactly this shape and splits placeholder rows vs foreign links).

---

## E. Env Vars, KV, Deployment

### E1. Complete environment variables (source-verified)
| Var | Default | Purpose | Evidence |
|---|---|---|---|
| `ADMIN` (aliases `admin`,`PASSWORD`,`password`,`pswd`,`TOKEN`,`KEY`,`UUID`,`uuid`) | — required | admin password; seeds UUID+tokens | :29 |
| `KEY` | Chinese sentinel string | crypto salt for tokens/cookies + quick-sub path | :30, :86 |
| `UUID`/`uuid` | derived | pin UUID (must be v4) | :33–34 |
| `HOST` | url.hostname | one or more advertised domains (list) | :35, :5711 |
| `PATH` | `/` | base node path | :5716 |
| `PROXYIP` | colo-derived default | global reverse-IP list (comma sep, random pick) | :44–48 |
| `GO2SOCKS5` | built-in 5-domain list | hosts forced through socks5/chained egress | :50–53 |
| `URL` | `nginx` | disguise page: external URL (reverse-proxied w/ host rewriting), `1101` fake CF error page, or nginx default | :504–527 |
| `DEBUG` | false | console logging | :38 |
| `OFF_LOG` | false | disable KV log writes | :5358 |
| `BEST_SUB` | false | generator-service mode | :304 |
| `PRELOAD_RACE_DIAL` | false | DoH-preload race dialing | :39 |
| `TCP_CONCURRENT_DIAL` | 2 (auto→1 on CMCC ASN) | direct-connect race width | :41–42 |
| `PROXY_CONCURRENT_DIAL` | 1 | proxyIP batch width | :40 |
| `KV` binding | none | enables panel/sub/config persistence | :84 |

⚠️ **Legacy vars gone:** the well-known older edgetunnel vars `ADD`, `ADDAPI`, `ADDNOTLS`, `ADDCSV`, `SUB`, `SUBCONFIG`, etc. **no longer exist in v2.x** (grep confirms zero references). Their roles moved into KV-stored `config.json` edited via the admin panel; bulk preferred IPs now live in KV key `ADD.txt`; remote CSV/API ingestion URLs are stored in config/admin-validated (`admin/getADDAPI`). Rebuild should treat README's table as authoritative for env surface.

### E2. KV usage (single namespace, binding `KV`)
Keys: `config.json` (whole feature config, schema versioned w/ defaults merge `读取config_JSON` :5587), `cf.json` (Cloudflare Email+GlobalAPIKey or AccountID+APIToken or UsageAPI), `tg.json` (BotToken/ChatID), `ADD.txt` (custom preferred IP text), `log.json` (access log array, 4 MB cap w/ shift-eviction, 30-min dedup for non-sub events :5360–5377). Config reset endpoint re-seeds defaults (:209–218). Without KV: WS proxy still works if env UUID set; sub/panel return explanatory 404 pages (`/noKV` :501).

### E3. Admin panel & auxiliary endpoints
- Static UI served from **external Pages site** `https://edt-pages.github.io` (:4) — worker only implements JSON APIs behind cookie auth.
- Auth: POST /login password check → cookie `auth=MD5MD5(UA+KEY+ADMIN)` HttpOnly Secure SameSite=Lax, 24h (:94–104). Cookie bound to User-Agent.
- APIs: GET/POST `admin/config.json`; `admin/cf.json` (creds masked in reads `掩码敏感信息` :5381); `admin/tg.json`; `admin/ADD.txt`; `admin/log.json`; `admin/init` reset; `admin/getCloudflareUsage` (GraphQL Workers+Pages daily invocation count :6334); `admin/getADDAPI` validate a preferred-source URL and preview parsed nodes (:122–136); **`admin/check` live egress tester** — dials `cloudflare.com:443/cdn-cgi/trace` through any provided socks5/http/https/turn/sstp proxy and reports exit ip/loc/responseTime (:137–204).
- Telegram notifications on login/config/sub events with rich HTML message incl. usage percent (:5326–5356).
- `admin/cf.json` GET echoes `request.cf` (debugging).
- Fallback/disguise pages: `/noADMIN`, `/noKV` static; reverse-proxy disguise with text content rewriting (:512–526); fake 1101 error page generator `html1101` (:6540).

### E4. Deployment modes
Dashboard paste of `_worker.js` (README primary), Pages direct-upload zip, Pages-Git; `wrangler.toml` provided (`keep_vars=true`, KV block commented). Custom domain required for TLS. No wrangler-specific features beyond main/kv.

---

## F. Unique / Differentiating Features Worth Copying

Ranked by rebuild value; all evidence in `_worker.js`:

1. **Runtime multi-protocol multiplexing on one endpoint** — VLESS/Trojan/SS sniffed from first bytes (:1651–1660, :1177, :962). Panel could expose "one link, any client".
2. **Self-healing egress**: direct-first dial → zero-data detection → transparent proxyIP retry mid-stream (:3083 retry hook, :2453 catch → `connecttoPry`). Users never see a dead node for CF-blocked destinations.
3. **Concurrent dial racing** with configurable widths and CMCC-aware degradation (:2241, :41–42) + optional **DoH preload race** resolving A/AAAA and racing IPs (:2264).
4. **TXT-record proxyIP pools**: a single domain in PROXYIP expands to dozens of exits via DNS TXT, deterministic per-target shuffle (:6441, :6499) — cheap distributed proxy-pool management without redeploy.
5. **Grain batch pipeline** (uplink 20KB coalesce w/ completion-tracked retries :2682; downlink 32KB frames, tail/watermark heuristics, BYOB reads :2826/:3036) — measurable CPU/quota efficiency pattern worth porting wholesale.
6. **Local speed-test interception** returning synthetic 204 for speed.cloudflare.com (:3096–3131).
7. **Chained egress zoo**: socks5/http/https(+own TLS stack)/TURN/SSTP(+PPP/TCP stack)/trojan-fallback, selectable per-request by path/query and globally by config, incl. GO2SOCKS5 domain routing (:2351–2432, :3134–4732).
8. **XHTTP transport with HPACK-length padding obfuscation** — active-probe resistance and DPI camouflage, padding validated 98–1002 huffman bytes (:551–593, :578).
9. **Subscription privacy design**: fake-credential placeholder nodes rewritten post-generation; daily-rotating converter token so backends never hold the real sub secret; per-fetch wildcard host randomization (:469–483, :307–313, :5414).
10. **CSV ingestion dialects** (CloudflareSpeedtest + latency/speed test formats) with TLS-column filtering and GBK fallback decoding (:6110–6151, :6008–6048).
11. **Client-format hot patches** rather than trusting converters: Clash DNS/ECH/grpc-UA injection, sing-box 1.13 schema migration + uTLS/ECH patch, Surge ws rewrite (:4810, :5027, :5307).
12. **ISP-aware preferred-IP generation**: client ASN→ISP→curated CIDR list→random IPs with localized names (:5833, :5863).
13. **Live egress checker API** usable from panel UI (`admin/check`, :137) — great fit for unified panel health dashboard.
14. **Usage accounting**: GraphQL Workers+Pages invocations surfaced as `Subscription-Userinfo` traffic bars in clients (:325–330, :6334).
15. **Generation-counter connection lifecycle** preventing cross-reconnect stream corruption (:789–816) — subtle correctness detail worth copying.
16. **ECH end-to-end** (links, Clash, sing-box) and TLS-fragment profiles per app (:352, :400, :4950–4953, :5289–5294).
17. **BEST_SUB feeder mode** turning any deployment into a shared preferred-IP service (:304).
18. Anti-scrape runtime string building to keep default infra hosts out of search indexes (:11–15).

---

## G. Weaknesses / Bugs Worth Fixing in the Rebuild

1. **Single-tenant identity**: exactly one UUID derived from `MD5MD5(password+KEY)`; no multi-user, no per-user quotas/expiry. Unified panel needs real user management — edgetunnel offers nothing here.
2. **Weak crypto for tokens/sessions**: double-MD5 token derivation (:5392), auth cookie = `MD5MD5(UA+KEY+ADMIN)` — unsalted, UA-bound (UA change logs you out; offline brute-force feasible given known KEY default sentence :30).
3. **Supply-chain trust**: default proxyIP hosts and admin UI come from author-controlled domains via obfuscated constants (:4, :11–15, :43, :2407); subconverter default SUBAPI likewise (:5626). A hardened rebuild should make every default overridable and auditable.
4. **No TLS verification on its own TLS client** (`insecure: true` always, :162/:3238) — HTTPS-proxy and SSTP egress vulnerable to MITM; cert validation absent from `TlsClient` (acceptCertificate is a no-op :3720).
5. **DNS-only UDP** (port 53 enforced, :1698, :2074): no QUIC/general UDP; clients advertising udp=true would break.
6. **Config read amplification**: `读取config_JSON` runs KV get + possible CF GraphQL call on every /sub and /admin hit (:315, :207); `生成随机IP` re-fetches CIDR lists from GitHub raw with **zero caching** per call (:5877) — latency + rate-limit exposure.
7. **Log flooding**: `Get_SUB` events bypass the 30-min dedupe (:5366) — every subscription update writes log.json; 4MB cap causes constant rewrite churn.
8. **Protocol-sniff fragility**: trojan-vs-VLESS detection relies on byte 56/57 == CRLF (:1656) — a short VLESS chunk (<58B) arriving first misroutes until later logic recovers; SS auto-align scan bounded to 16B noise (:1413).
9. **gRPC/XHTTP share the generic POST branch** (:71–80): any POST with grpc content-type or the padding header is treated as tunnel — collides with future HTTP APIs on same worker; also requires admin password set even for pure proxy use (:67).
10. **Hardcoded DNS 8.8.4.4** for all tunneled DNS queries (:2473) — no DoH upstream choice, no EDNS client-subnet considerations.
11. **HTTP→HTTPS 301 redirect** unconditional (:82) breaks plain-HTTP health checks/noTLS deployments.
12. **Maintainability**: ~6.6k-line single file, Chinese identifiers, dead code paths (`需要订阅转换订阅URLs` computed but unused :6051–6056), mojibake CHANGELOG, and large non-code "legitimacy boilerplate" comment blocks (:16, :6509) that read as anti-analysis padding — poor auditability; rebuild should enforce modular structure.
13. **`/version` oracle** (:54): leaks build number to anyone able to construct a uuid with matching prefix-sum+suffix — minor fingerprinting aid.
14. **Random-per-boot PROXYIP pick** (:46) means inconsistent egress across isolates — fine for spread, bad for sticky sessions; document or make deterministic.

---

## Appendix: Function Map (quick navigation)

| Area | Functions |
|---|---|
| Entry/routing | `export.default.fetch` :17 |
| Transports | `处理WS请求` :1290 · `处理gRPC请求` :979 · `处理叉HTTP请求` :595 |
| Parsers | `解析魏烈思请求` :1964 · `解析木马请求` :1858 · `读取叉HTTP首包` :818 · SS inbound `获取SS上下文` :1389 |
| Relay core | `forwardataTCP` :2169 · `connectStreams` :3026 · `创建下行Grain发送器` :2826 · `创建上行写入队列` :2682 · `创建上行Grain合包流` :2601 · `forwardataudp` :2467 |
| Egress | `socks5Connect` :3134 · `httpConnect` :3170 · `httpsConnect` :3228 · `TlsClient` :3686 · `turnConnect` :4136 · `sstpConnect` :4323 · `连接木马反代` :1811 |
| Proxy config | `反代参数获取` :6159 · `解析地址端口` :6425 · `获取SOCKS5账号` :6301 · `DoH查询` :5427 |
| Subscription | `/sub` block :303 · `读取config_JSON` :5587 · `请求优选API` :5955 · `生成随机IP` :5863 · `识别运营商` :5833 · hot-patches :4810/:5027/:5307 |
| Admin/KV | login/admin block :90–302 · `请求日志记录` :5326 · `getCloudflareUsage` :6334 |
| Crypto/util | `MD5MD5` :5392 · `sha224` :6392 · `base64SecretEncode/Decode` :4740/:4764 · SS-AEAD :2119–2167 · ChaCha/Poly :3434–3523 |
