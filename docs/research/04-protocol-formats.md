# Protocol Wire Formats & Schemas — Reference for the Unified Panel

> Research target #4 for the unified-panel rebuild (companion to `01-bpb-panel.md`, `02-edgetunnel.md`, `03-nahan.md`).
>
> **Purpose:** the exact share-URI grammars, subscription container formats, and client-config schemas (Clash/mihomo YAML, sing-box JSON) that a TypeScript Cloudflare Worker panel must *emit*, plus the Cloudflare-specific transport facts that constrain what can be emitted.
>
> **Method:** primary sources only — XTLS/Xray-core spec issue, shadowsocks.org SIP002, sing-box.sagernet.org, wiki.metacubex.one (MetaCubeX/Meta-Docs), developers.cloudflare.com. Where no formal spec exists (Trojan URI, VMess base64-JSON), the de-facto reference implementation is cited and labeled as such. Cross-references into sibling docs cite their source-line conventions.

---

## Table of contents

1. [Share-URI formats](#1-share-uri-formats) — 1.1 VLESS · 1.2 Trojan · 1.3 VMess · 1.4 Shadowsocks
2. [Subscription formats](#2-subscription-formats) — 2.1 URI list/base64 + headers + UA negotiation · 2.2 Clash/mihomo YAML · 2.3 sing-box JSON
3. [Cloudflare specifics](#3-cloudflare-specifics) — 3.1 Ports · 3.2 WS architecture · 3.3 Early data · 3.4 Runtime constraints
4. [Gotchas checklist](#4-gotchas-checklist)

---

## 1. Share-URI formats

### 1.0 Common grammar rules (Xray #91 conventions)

Canonical proposal for VMess-AEAD/VLESS links: [XTLS/Xray-core#91 "VMessAEAD / VLESS 分享链接标准提案"](https://github.com/XTLS/Xray-core/issues/91) (DuckSoft, Dec 2020; reviewed by RPRX). Binding rules real clients still follow:

- Must be a valid URL; parameter **order insignificant**, parameter **repetition forbidden**.
- All values `encodeURIComponent`-escaped; **names and constant strings case-sensitive** (`security=tls`, not `TLS`).
- Shape:

```
protocol://$(uuid|password)@remote-host:remote-port?<params>#$(descriptive-text)
```

- `$()` = percent-encode this value. IPv6 host bracketed. IDN → punycode (`xn--…`). Port ∈ [1,65535]. Fragment = display name in client UI.
- Note `security=xtls` from #91 is legacy/deprecated; modern links use `security=tls|reality`.

Parser warnings from field experience ([V2RayGCon share-links notes](https://vrnobody.github.io/V2RayGCon/01-usage/share-links)): never `split(":")` on the whole link (IPv6), expect both `?` and `/?` before query, tolerate unescaped commas inside `alpn`.

### 1.1 VLESS URI

Scheme: `vless://<uuid>@<host>:<port>?<params>#<name>`

VLESS has **no encryption layer** — `encryption=none` is the only legal value today (omittable per #91; must never be empty string). Security comes entirely from transport (`security=`).

Parameter table (union of Xray #91 §4 and current client practice incl. REALITY):

| Param | Values | Default when omitted | Notes |
|---|---|---|---|
| `encryption` | `none` | `none` | Only legal VLESS value; emit explicitly |
| `type` | `tcp` `ws` `httpupgrade` `xhttp` `grpc` `http`/`h2` `kcp` `quic` | `tcp` | Transport; CF panels emit `ws` |
| `security` | `none` `tls` `reality` (`xtls` legacy) | `none` | Never an empty string |
| `sni` | hostname | falls back to remote-host | TLS ServerName / REALITY target name |
| `host` | hostname(s), comma-separated | remote-host | HTTP `Host` header value (ws/h2/httpupgrade) |
| `path` | path (+query) | `/` | Percent-encoded; WS early-data hint `?ed=N` rides here |
| `alpn` | comma list, e.g. `h2,http/1.1` | kernel decides | Percent-encoded |
| `fp` | uTLS fingerprint: `chrome` `firefox` `safari` `ios` `android` `edge` `360` `qq` `random` `randomized` | client default | ClientHello imitation; maps to sing-box `utls.fingerprint`. Legacy chrome subvariants removed since sing-box 1.10 |
| `flow` | `xtls-rprx-vision` (current) | empty | **tcp only** — MUST NOT be set on ws/grpc; `-udp443` variants are client-side choices per RPRX (#91 comment) |
| `pbk` | base64url X25519 public key | required if reality | Server's REALITY public key |
| `sid` | hex, ≤8 chars | optional | REALITY short ID (sing-box: "zero to eight hexadecimal digits") |
| `spx` | path, usually `/` | — | SpiderX; percent-encoded (`spx=%2F`) |
| `headerType` | `none` `http` `srtp` `utp` `wechat-video` `dtls` `wireguard` | `none` | Obfs header (tcp/kcp/quic) |
| `serviceName` | string | — | gRPC ServiceName |
| `mode` | `gun` (default) `multi` `guna` | `gun` | gRPC framing (#91 §4.3.12) |
| `seed` | string | none | mKCP seed |

Copy-pasteable examples:

```text
# VLESS + WS + TLS  <- the Cloudflare-Workers profile (NO flow!)
vless://d342d11e-d424-4583-b36e-524ab1f0afa4@example.com:443?encryption=none&security=tls&sni=example.com&fp=chrome&alpn=http%2F1.1&type=ws&host=example.com&path=%2Fvl%3Fed%3D2560#CF-WS-TLS

# VLESS + TCP + REALITY + Vision  <- direct-to-VPS profile, NOT usable behind CF
vless://d342d11e-d424-4583-b36e-524ab1f0afa4@1.2.3.4:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0&sid=6ba85179&type=tcp&flow=xtls-rprx-vision&spx=%2F#Reality-Vision
```

REALITY param names (`security=reality&pbk=&sid=&sni=&fp=`) postdate #91 and live only as de-facto format; observable ecosystem output confirms them — e.g. 3x-ui generates `vless://uuid@host:443?type=tcp&encryption=none&security=reality&pbk=PUBLIC_KEY&fp=chrome&sni=SNI&sid=SHORT_ID&spx=%2F` ([MHSanaei/3x-ui#4137](https://github.com/MHSanaei/3x-ui/issues/4137)).

### 1.2 Trojan URI

Scheme: `trojan://<password>@<host>:<port>?<params>#<name>`

**No formal spec exists** — trojan-gfw never documented a URI scheme; this is a client-created convention (Shadowrocket, then v2rayN/v2rayNG/NekoBox/mihomo importers). Reliable behavior:

- Password sits in the userinfo slot, **percent-encoded** (may contain any characters).
- Query mirrors the VLESS/TLS parameter set:

| Param | Meaning | Notes |
|---|---|---|
| `sni` / `peer` | TLS SNI | `peer` = older Shadowrocket spelling; emit `sni` |
| `allowInsecure` | skip cert verify (`allowInsecure=1`) | some clients also accept explicit `security=tls` |
| `type` | `tcp` `ws` `grpc` | transport |
| `host` | Host header (ws) | |
| `path` | WS path | may carry `?ed=N` |
| `serviceName` | gRPC service name | |
| `alpn` | comma list | |
| `fp` | uTLS fingerprint | maps to `client-fingerprint` / `utls` |
| `security` | `tls` \| `reality` | newer clients; reality adds `pbk`,`sid`,`spx` like VLESS |

```text
# Trojan + WS + TLS (the CF-Workers-compatible trojan profile)
trojan://secretpassword123@example.com:443?security=tls&sni=example.com&alpn=http%2F1.1&type=ws&host=example.com&path=%2Ftr%3Fed%3D2560&fp=chrome#CF-Trojan-WS
```

Panel note: edgetunnel derives the trojan password from UUID as `sha224(uuid)` hex (`02-edgetunnel.md` §A3); password policy lives in the panel, not in the URI format.

### 1.3 VMess URI (base64-JSON form)

Scheme: `vmess://base64( JSON object )` — standard alphabet, no line breaks.

⚠️ Xray #91 proposed a URL-style `vmess://uuid@host:port?…` for VMessAEAD but it was **never widely adopted**. What panels must emit is the older **v2rayN "ver 2" JSON-in-base64** link. Reference: [2dust/v2rayN wiki — Description of VMess share link](https://github.com/2dust/v2rayN/wiki/Description-of-VMess-share-link).

Canonical JSON (order irrelevant):

```json
{
  "v": "2",
  "ps": "remark-or-alias",
  "add": "example.com",
  "port": "443",
  "id": "1386f85e-657b-4d6e-9d56-78badb75e1fd",
  "aid": "0",
  "scy": "auto",
  "net": "ws",
  "type": "none",
  "host": "example.com",
  "path": "/vm?ed=2560",
  "tls": "tls",
  "sni": "example.com",
  "alpn": "h2,http/1.1",
  "fp": "chrome"
}
```

Field semantics (v2rayN wiki):

| Field | Meaning | Values / notes |
|---|---|---|
| `v` | config version marker | always `"2"` |
| `ps` | display name | free text |
| `add` | server address | IP or domain |
| `port` | port | wiki uses **string**; parsers accept number too — emit string to match reference |
| `id` | UUID | |
| `aid` | alterId | `"0"` ⇒ AEAD protocol; AEAD-era servers require `0` |
| `scy` | inner encryption | default `auto`; `none` `zero` `aes-128-gcm` `chacha20-poly1305` |
| `net` | transport | `tcp` `kcp` `ws` `h2` `quic` (newer clients also grpc/xhttp) |
| `type` | camouflage header | `none` `http` `srtp` `utp` `wechat-video` (tcp/kcp/quic only) |
| `host` | camouflage domain | http(tcp)→comma-separated hosts; ws/h2→Host header |
| `path` | path | ws/h2→path; kcp→seed; quic→key; grpc→serviceName |
| `tls` | outer TLS flag | `"tls"` or `""` |
| `sni` | TLS ServerName | |
| `alpn` | ALPN list | e.g. `h2,http/1.1` |
| `fp` | uTLS fingerprint | `chrome` etc. |

Gotchas: all fields nominally strings; base64 standard alphabet without newlines (tolerate URL-safe/unpadded when *parsing*); no way to express REALITY in this format.

### 1.4 Shadowsocks URI (SIP002)

Primary source: [shadowsocks.org — SIP002 URI scheme](https://shadowsocks.org/doc/sip002.html).

```
SS-URI = "ss://" userinfo "@" hostname ":" port [ "/" ] [ "?" plugin ] [ "#" tag ]
userinfo = websafe-base64-encode-utf8(method  ":" password)
         | method ":" password                ; unencoded alternative
```

Rules easy to get wrong:

1. Base64URL userinfo is **recommended but optional** for Stream/AEAD ciphers ("we never try to encrypt your key").
2. **AEAD-2022 ciphers (`2022-blake3-*`, SIP022): userinfo MUST NOT be base64-encoded** — method/password must appear plain, percent-encoded: `ss://2022-blake3-aes-256-gcm:YctPZ6U7xPPcU%2Bgp3u%2B0tx%2FtRizJN9K8y%2BuKlW2qjlI%3D@203.0.113.10:8888#Example3`.
3. Unencoded ⇒ method AND password MUST be percent-encoded.
4. Trailing `/` should be appended when `plugin=` present. Plugin args use `simple-obfs;obfs=http;obfs-host=example.com` where `:` `;` `=` `\` are backslash-escaped before URL-encoding the whole value.
5. Spaces in tags illegal — escape as `%20`.
6. **Legacy pre-SIP002 form**, still parsed nearly everywhere: `ss://base64(method:password@host:port)#tag` — entire authority is one blob. Emit SIP002; parse both (detect: does text after `ss://` decode as `method:…@host:port`?).

```text
ss://YWVzLTEyOC1nY206cGFzc3dvcmQ=@203.0.113.10:8388#SS-SIP002
ss://aes-128-gcm:password@203.0.113.10:8388#SS-Plain
ss://YWVzLTEyOC1nY206cGFzc3dvcmQ=@203.0.113.10:8388/?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dexample.com#SS-Obfs
```

## 2. Subscription formats

### 2.1 URI list / base64 convention ("mixed" subscriptions)

De-facto convention, not a spec. Client behavior:

1. Fetch the subscription URL over HTTPS.
2. If the body already starts with a known scheme (`vless://`, `vmess://`, `trojan://`, `ss://`, `hysteria2://`, …) → each line is one node.
3. Else attempt base64 decode (accept standard **and** URL-safe alphabets, padded or not); if result contains known schemes → split lines and parse.
4. Garbage → error/ignore.

So: **emit plaintext lines OR base64-of-the-lines; both must work.** Base64 hides nodes from scrapers; most panels ship it by default.

Response headers recognized by mainstream clients (observed in BPB/edgetunnel, see `01-bpb-panel.md` §raw row, `02-edgetunnel.md` §D6):

| Header | Purpose | Example |
|---|---|---|
| `Content-Type` | `text/plain; charset=utf-8` for URI lists | |
| `Profile-Title` | profile display name | plain text or `base64:<b64name>` |
| `Subscription-Userinfo` | traffic bar | `upload=123; download=456; total=107374182400; expire=1755000000` (bytes; expire = unix seconds) |
| `Profile-Update-Interval` | hours between auto-refreshes | `12` |
| `profile-web-page-url` | panel landing page link | |
| `Content-Disposition: attachment; filename*=UTF-8''…` | filename when saved | set for non-browser UAs |
| `DNS` / `Routing` | Stash / Shadowrocket hints | optional |

**UA-based content negotiation** — ground truth from a working implementation (edgetunnel, `02-edgetunnel.md` §D3): priority is explicit `target=` query param → UA contains `clash|meta|mihomo` → `sb|singbox|sing-box` → `surge` → `quanx|quantumult` → `loon` → else mixed/base64; `subconverter-request`/`subconverter-version` headers or UA containing `subconverter` force subconverter passthrough; non-browser UAs get `Content-Disposition: attachment`. UAs to classify: `v2rayNG/<ver>`, `SagerNet/sing-box/<ver>` + NekoBox variants, `HiddifyNext/<ver>`, `clash-verge/v<ver>`, `ClashforWindows/<ver>`, `mihomo/<ver>`, `ShadowRocket/<ver>`, browsers (`Mozilla/5.0 …`) → landing page.

### 2.2 Clash / mihomo YAML schema

Sources: [wiki.metacubex.one/config/proxies/](https://wiki.metacubex.one/config/proxies/) pages for [VLESS](https://wiki.metacubex.one/en/config/proxies/vless/), [VMess](https://wiki.metacubex.one/en/config/proxies/vmess/), [Trojan](https://wiki.metacubex.one/en/config/proxies/trojan/), [SS](https://wiki.metacubex.one/en/config/proxies/ss/) plus shared [TLS](https://wiki.metacubex.one/en/config/proxies/tls/) and [transport](https://wiki.metacubex.one/en/config/proxies/transport/) configuration. Field spellings verbatim from those pages.

Common per-proxy fields: `name` (unique), `type`, `server`, `port`, `udp` (bool), `ip-version`. Shared TLS fields: `client-fingerprint` (uTLS: `chrome`…), `skip-cert-verify` (bool), `fingerprint` (**certificate** SHA-256 pinning — different from client-fingerprint!), `alpn` (list), `reality-opts: {public-key, short-id}`.

Type-specific required fields:

| Type | Required extra | Notes |
|---|---|---|
| `vless` | `uuid` | `flow: xtls-rprx-vision` (tcp only); `packet-encoding: xudp\|packetaddr`; TLS SNI key = **`servername:`** |
| `vmess` | `uuid`, `alterId`, `cipher` | cipher ∈ `auto/none/zero/aes-128-gcm/chacha20-poly1305`; `alterId: 0` ⇒ AEAD; SNI key = **`servername:`** |
| `trojan` | `password` | SNI key = **`sni:`** (not servername!); `network: ws\|grpc` only |
| `ss` | `cipher`, `password` | AEAD + `2022-blake3-*` ciphers; `plugin: obfs\|v2ray-plugin\|shadow-tls\|restls\|gost-plugin\|kcptun\|jls` + `plugin-opts` |

Transport options: `ws-opts: {path, headers: {Host}, max-early-data, early-data-header-name, v2ray-http-upgrade, v2ray-http-upgrade-fast-open}`; `grpc-opts: {grpc-service-name, …}`; `h2-opts: {host[], path}`; `xhttp-opts` (vless only).

Minimal-but-complete config a panel can emit for CF-Worker nodes:

```yaml
mixed-port: 7890
allow-lan: false
mode: rule
log-level: info

proxies:
  - name: "CF-VLESS"
    type: vless
    server: example.com
    port: 443
    udp: true
    uuid: d342d11e-d424-4583-b36e-524ab1f0afa4
    tls: true
    servername: example.com
    client-fingerprint: chrome
    skip-cert-verify: false
    network: ws
    ws-opts:
      path: "/vl?ed=2560"
      headers:
        Host: example.com
      max-early-data: 2048
      early-data-header-name: Sec-WebSocket-Protocol

  - name: "CF-TROJAN"
    type: trojan
    server: example.com
    port: 443
    udp: true
    password: secretpassword123
    sni: example.com            # trojan uses sni, NOT servername
    alpn: [h2, http/1.1]
    client-fingerprint: chrome
    network: ws
    ws-opts:
      path: "/tr?ed=2560"
      headers:
        Host: example.com

  - name: "CF-VMESS"
    type: vmess
    server: example.com
    port: 443
    udp: true
    uuid: 1386f85e-657b-4d6e-9d56-78badb75e1fd
    alterId: 0
    cipher: auto
    tls: true
    servername: example.com
    network: ws
    ws-opts:
      path: "/vm?ed=2560"
      headers:
        Host: example.com

proxy-groups:
  - name: PROXY
    type: select
    proxies: [AUTO, CF-VLESS, CF-TROJAN, CF-VMESS, DIRECT]
  - name: AUTO
    type: url-test
    url: https://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    proxies: [CF-VLESS, CF-TROJAN, CF-VMESS]

rules:
  - GEOIP,CN,DIRECT
  - MATCH,PROXY
```

Notes: `rules` must end with a catch-all (`MATCH,…`); every group/node referenced by name must exist; a Reality-over-TCP node would use `network: tcp` + `flow: xtls-rprx-vision` + `reality-opts`.

### 2.3 sing-box outbound JSON schema

Sources: [sing-box outbounds](https://sing-box.sagernet.org/configuration/outbound/) — vless / vmess / trojan / shadowsocks pages — plus shared [TLS outbound object](https://sing-box.sagernet.org/configuration/shared/tls/#outbound) and [V2Ray Transport](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/).

Shared outbound TLS object (client side):

```jsonc
{
  "enabled": true,
  "server_name": "example.com",
  "insecure": false,
  "alpn": ["h2", "http/1.1"],
  "utls": { "enabled": true, "fingerprint": "chrome" },
  "reality": {
    "enabled": true,
    "public_key": "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0",
    "short_id": "6ba85179"   // hex, zero to eight digits
  }
}
```

Shared WebSocket transport (used by vless/vmess/trojan):

```jsonc
{
  "type": "ws",
  "path": "/vl?ed=2560",
  "headers": { "Host": "example.com" },
  "max_early_data": 2048,
  "early_data_header_name": "Sec-WebSocket-Protocol"
}
```

Outbound skeletons (required fields listed):

- **vless**: `type/tag/server/server_port/uuid` + optional `flow` (`xtls-rprx-vision`, tcp only), `packet_encoding` (xudp default), `tls`, `transport`.
- **vmess**: same + `security` (`auto` default; `none/zero/aes-128-gcm/chacha20-poly1305`) + `alter_id` (`0` ⇒ AEAD, ≥1 ⇒ legacy), optional `global_padding`, `authenticated_length`.
- **trojan**: `password` + `tls` (+ transport); TLS effectively mandatory.
- **shadowsocks**: `method` (`2022-blake3-*`, `aes-128-gcm`, `chacha20-ietf-poly1305`, …) + `password`; optional built-in `plugin`: only `obfs-local` and `v2ray-plugin`. No tls/transport objects (SS has its own obfuscation).

Minimal valid sfa-ready config (Android tun profile):

```json
{
  "log": { "level": "info", "timestamp": true },
  "dns": {
    "servers": [
      { "tag": "proxy-dns", "address": "https://1.1.1.1/dns-query", "detour": "PROXY" },
      { "tag": "local-dns", "address": "local" }
    ],
    "rules": [{ "outbound": "any", "server": "local-dns" }],
    "final": "proxy-dns"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "address": ["172.18.0.1/30", "fdfe:dcba:9876::1/126"],
      "auto_route": true,
      "strict_route": true
    }
  ],
  "outbounds": [
    {
      "type": "vless",
      "tag": "PROXY",
      "server": "example.com",
      "server_port": 443,
      "uuid": "d342d11e-d424-4583-b36e-524ab1f0afa4",
      "packet_encoding": "xudp",
      "tls": {
        "enabled": true,
        "server_name": "example.com",
        "utls": { "enabled": true, "fingerprint": "chrome" }
      },
      "transport": {
        "type": "ws",
        "path": "/vl?ed=2560",
        "headers": { "Host": "example.com" },
        "max_early_data": 2048,
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    },
    { "type": "direct", "tag": "DIRECT" }
  ],
  "route": {
    "rules": [
      { "protocol": "dns", "action": "hijack-dns" },
      { "ip_is_private": true, "outbound": "DIRECT" }
    ],
    "final": "PROXY",
    "auto_detect_interface": true
  }
}
```

Swap the single outbound for vmess (`security:"auto"`, `alter_id:0`), trojan (`password`), or shadowsocks (`method`,`password`, drop `tls`). Desktop/non-VPN variant: replace tun inbound with `{"type":"mixed","tag":"mixed-in","listen":"127.0.0.1","listen_port":2080}`. Note sing-box docs warn that uTLS fingerprints have known imitation weaknesses (sing-box ≥1.10 removed legacy chrome variants; they fall back to `chrome`).

## 3. Cloudflare specifics

### 3.1 Proxied ports

Source: [developers.cloudflare.com/fundamentals/reference/network-ports/](https://developers.cloudflare.com/fundamentals/reference/network-ports/) (Apr 2026 revision).

| Family | Ports | Panel usage |
|---|---|---|
| HTTP (proxied) | **80, 8080, 8880, 2052, 2082, 2086, 2095** | `ws://` plaintext transports (`security=none`) |
| HTTPS (proxied) | **443, 2053, 2083, 2087, 2096, 8443** | `wss://` TLS transports (`security=tls`) |
| Caching disabled on | 2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096, 8880, 8443 | good for streaming; irrelevant to auth |

Generator facts:

- Any orange-clouded hostname serves the Worker on **all twelve ports**. On the HTTPS family the edge terminates TLS with Cloudflare's own certificate ⇒ emitted `sni`/`host` = worker hostname; `allowInsecure` must stay false.
- Port↔security pairing must be consistent in emitted links: `security=tls` ⇒ HTTPS set; `security=none` ⇒ HTTP set. Mismatched combos fail.
- edgetunnel keeps exactly this mapping `[443,2053,2083,2087,2096,8443] ↔ [80,8080,2052,2082,2086,2095]` when generating noTLS SS variants (`02-edgetunnel.md` §D6).
- China Network: only 80/443.
- Non-listed ports are open on CF anycast IPs but never reach your origin/worker.

WebSockets ride the HTTP upgrade mechanism and work through the CF proxy on **every listed port** (both families), all plans — this is why panels can offer six TLS and six plaintext node variants of one Worker. gRPC through CF's proxy targets *origins* (requires enabling gRPC); arbitrary Workers cannot terminate standard h2/gRPC streams reliably — emit `ws` (or `httpupgrade`) for Worker nodes.

### 3.2 VLESS-over-WS on Workers: architecture

```
client (v2rayNG/sing-box…)                    CF edge                    Worker                destination
   |--- TCP+TLS :443 (SNI=worker.host) --->  edge terminates TLS
   |--- GET /vl?ed=2560  Upgrade: websocket --->  routes to Worker
   |    [Sec-WebSocket-Protocol: <b64url(VLESS frame)>]      (early data)
   |                                             new WebSocketPair(); server.accept()
   |                                             parse VLESS frame from first chunk
   |                                                 |-- connect(destHost, destPort)
   |                                                 |     'import { connect } from "cloudflare:sockets"'
   |<==== WS binary frames === server.readable pipe ===>|== raw TCP ==>
```

Key mechanics (from [Workers WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/) + [TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) docs):

- Server side is created via `new WebSocketPair()`; call `server.accept()` on the pair member returned to the runtime. The client-side WS of the pair is what you read/write.
- VLESS request frame arrives as the first data chunk(s): `[ver(1)][uuid(16)][optLen(1)][opt][cmd(1)][port(2 BE)][atype(1)][addr][payload]`, atype 1=IPv4 / 2=domain(len-prefixed) / 3=IPv6 (`02-edgetunnel.md` §A2). Response header back to client is two bytes `[version, 0]`.
- The Worker then opens the destination TCP connection with `connect(address, { secureTransport: "off"|"on"|"starttls" })` imported from `cloudflare:sockets`, and pipes `socket.readable ⇄ ws stream`. For plain destinations (most traffic) TLS stays off; the outer wss already protects client→edge.
- Runtime constraints that shape code: sockets must be created per-request inside handlers; connections to Cloudflare IP ranges/localhost/private IPs are blocked; port 25 blocked; "TCP Loop detected" if connecting back to yourself; each socket counts against open-connection limits.
- WebSocket message size cap: 32 MiB per frame (1009 close beyond). Binary frames default to Blob delivery since compat date `2026-03-17` (`websocket_standard_binary_type`) — set `binaryType = "arraybuffer"` before `accept()` if you need synchronous byte access. Close handling changed at compat date `2026-04-07`: auto reciprocal close unless `accept({ allowHalfOpen: true })` — relevant when piping close between WS and TCP socket.

### 3.3 Early data via `Sec-WebSocket-Protocol`

Problem: without help, the VLESS frame waits for a second round trip after the WS handshake (client must await `open` before sending).

Mechanism (v2ray/Xray ws early-data convention):

1. Emitted configs advertise support by appending `?ed=<max-bytes>` (panels use 2048 or 2560) to the WS **path**, plus naming the carrier header.
2. The client base64url-encodes its first protocol payload into the **`Sec-WebSocket-Protocol`** header of the upgrade request (browser APIs forbid custom headers on `new WebSocket()`, but this subprotocol header is settable — hence the choice).
3. The server reads `request.headers.get("sec-websocket-protocol")`, decodes base64url, and prepends those bytes to the stream as if they arrived as the first WS message.

sing-box documents the exact contract ([V2Ray Transport](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/)): *"Early data is sent in path instead of header by default. To be compatible with Xray-core, set this to `Sec-WebSocket-Protocol`."* i.e. default carrier is an `ed=`-style path/query mechanism; `early_data_header_name: "Sec-WebSocket-Protocol"` + `max_early_data` switches to header mode. mihomo exposes the same pair as `ws-opts.max-early-data` / `ws-opts.early-data-header-name`.

Verified panel behavior: BPB decodes `sec-websocket-protocol` via `base64ToArrayBuffer` and emits sing-box/clash builders with `max_early_data: 2560, early_data_header_name: "Sec-WebSocket-Protocol"` while xray-style URIs carry `?ed=2560` in path (`01-bpb-panel.md` §raw row); edgetunnel caps it at 8 KB and validates the decoded blob against UUID/trojan-hash before trusting it, and deliberately disables SS early-data because the subprotocol header would be misparsed as payload (`02-edgetunnel.md` §A6).

Server-side gotchas: the header may be absent (normal flow), may contain multiple comma-separated protocols, and base64url here is unpadded — decode tolerantly; treat decoded content as untrusted input like any first chunk.

### 3.4 Runtime constraints that shape emitted configs

- **No inbound TCP**: Workers only accept HTTP(S)+WS — so no Reality/Trojan-over-raw-TCP profiles pointing at a Worker; only ws/httpupgrade/xhttp-style HTTP transports make sense.
- **No UDP** through `connect()`: VLESS UDP-over-WS implementations fake DNS-only UDP (edgetunnel allows port 53 only); don't advertise full UDP relay.
- **Egress IP = Cloudflare's** (a non-`www.cloudflare.com/ips` prefix): geo-location of nodes is wherever CF pops the connection; panels add "preferred IP"/custom SNI tricks to steer colo selection (see `02-edgetunnel.md` §D4) — encoded purely in `server:` address and `sni/host/path` of emitted links, never in protocol state.
- **Worker domain TLS**: edge certs are valid for `*.<zone>` — clients should not need `insecure:true`; emitting `allowInsecure=1`/`skip-cert-verify: true` is a smell except for third-party upstream nodes.

---

## 4. Gotchas checklist

1. VMess links are base64-JSON, not URL params (#91's URL form never shipped); `aid:"0"` mandatory for AEAD servers.
2. `flow=xtls-rprx-vision` only with `type=tcp`; setting it on ws/grpc breaks the connection.
3. Trojan YAML uses `sni:`; vless/vmess YAML use `servername:` — swapping them silently disables SNI.
4. Clash key `fingerprint` = cert pinning; `client-fingerprint` = uTLS. Different things.
5. SIP022 SS passwords must NOT be base64'd in URIs; classic ciphers should be (base64**URL**, unpadded ok).
6. Legacy `ss://base64(all)` form still circulates — importers must try both.
7. Port family must match `security`: tls ⇒ {443,2053,2083,2087,2096,8443}, none ⇒ {80,8080,8880,2052,2082,2086,2095}.
8. Early-data carrier mismatch (`Sec-WebSocket-Protocol` vs path) silently kills first-byte routing — keep `ed=N`, `max_early_data` and `early_data_header_name` mutually consistent across all three config formats.
9. Base64 subscriptions must tolerate both alphabets/padding when parsing; when emitting, prefer standard padded.
10. `Subscription-Userinfo` values are bytes and unix-seconds; wrong units show garbage traffic bars.
11. UA negotiation order matters (clash → sing-box → surge → … → base64 fallback) and browsers must get HTML, not node soup.
12. IPv6 hosts break naive `split(":")` URI parsers; bracket them when emitting.
13. Percent-encode everything per #91 (`alpn=h2%2Chttp%2F1.1`, `spx=%2F`) but *parse* unescaped input defensively.
14. sing-box reality `short_id` is hex ≤8 chars; empty string allowed; wrong length = config reject.
15. WS binary frames arrive as Blob by default on compat dates ≥2026-03-17 — set `binaryType="arraybuffer"` or handlers must be async.

---

### Source index

- XTLS/Xray-core#91 — VLESS/VMessAEAD share-link proposal (grammar, escaping, param defaults): https://github.com/XTLS/Xray-core/issues/91
- shadowsocks.org SIP002 (+SIP022 note): https://shadowsocks.org/doc/sip002.html
- 2dust/v2rayN wiki — VMess share-link JSON fields: https://github.com/2dust/v2rayN/wiki/Description-of-VMess-share-link
- sing-box docs — outbounds vless/vmess/trojan/shadowsocks, shared TLS, V2Ray transport: https://sing-box.sagernet.org/configuration/outbound/
- MetaCubeX Meta-Docs (mihomo) — proxies vless/vmess/trojan/ss + transport/TLS configuration: https://wiki.metacubex.one/config/proxies/
- Cloudflare — network ports: https://developers.cloudflare.com/fundamentals/reference/network-ports/
- Cloudflare — Workers TCP sockets (`connect()`): https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Cloudflare — Workers WebSockets: https://developers.cloudflare.com/workers/runtime-apis/websockets/
- Local corroboration: `01-bpb-panel.md` (raw-sub row, early-data decode), `02-edgetunnel.md` (§A2/A6/D3/D6), `03-nahan.md` (subscription headers)
