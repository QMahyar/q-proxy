# Changelog

## Unreleased

### Added (B5 — edgetunnel parity: protocols/transports, flag-gated)
- New settings, all default-off (defaults = ws-only vless, zero behavior
  change): `trojanEnabled/trojanPassword/trojanPath`,
  `ssEnabled/ssMethod(aes-128-gcm|aes-256-gcm|chacha20-ietf-poly1305)/ssTls`,
  `transport(ws|grpc|xhttp)`, `grpcMode(gun|multi)`, `grpcUserAgent`,
  `tlsFragment(off|shadowrocket|happ)`, `zeroRtt`, `randomPath`.
  Cross-field rules: trojan needs a password and a path distinct from
  `vlessPath`; `trojanPassword` is masked on read/export like `botToken`.
- Trojan inbound (SHA-224 password check via vendored pure-JS hash,
  TCP + DNS-only UDP) on its own path; shadowsocks AEAD inbound
  (AES-GCM via WebCrypto, chacha handshakes cleanly rejected) sharing the
  vless path via vless-first handshake racing. `transport=grpc|xhttp`
  switches the WebSocket framing (length-prefix / HTTP-chunk codecs);
  `transport=ws` runs the byte-identical legacy path. `zeroRtt` forces
  `?ed=2560` in tunnel paths; `randomPath` randomizes suffixes.
- Additive emitters: `trojan://` + `ss://` share URIs, trojan/ss outbounds
  in sing-box/Clash/Xray profiles, TLS-fragment blocks in sing-box
  (`fragment` + preset fallback delay) and Xray (`tcpFragment` sockopt)
  only when the preset is on. GOLDENS: no existing vless emitter output
  changed — full golden suites pass byte-identical.
- Panel Protocols: trojan/ss cards, 0-RTT + random-path toggles, transport
  card (transport select, grpc fields, fragment chips) (en + fa).
- Documented limits: ss password reuses the vless UUID (no separate
  setting); ss serves TCP only (no UDP associate marker on this path —
  DNS still flows over vless/trojan UDP or DoH); chacha20 inbound
  handshakes are rejected (labels retained for client configs);
  `grpcMode: multi` uses gun framing; `grpcUserAgent` is stored, not
  enforced; fragment blocks are client hints (Clash gets none — no
  standard slot); emitted profiles stay `ws` transport.

### Added (B5b — edgetunnel parity: camouflage modes)
- `camouflage.mode` gains `nginx` (serves the default static page),
  `minimal` (tiny `1101`-style page, `no-store`), and `reverse` (mirrors an
  `https://` origin: upstream origin+request path, text-only host rewrite to
  this worker, `Cache-Control: no-store`, 8s timeout, 2MB cap, non-text
  passthrough). `off` still 404s.
- New `camouflage.reverseUrl` setting: `reverse` mode requires an `https://`
  URL at save time (plain `http` rejected, local/private rejected); the
  handler additionally upgrades a legacy `http` store instead of failing,
  and refuses local targets without fetching. Invalid stored configs
  self-heal to the static page on load.
- Panel Advanced: mode select with all five options + a reverse-URL field
  shown only for `reverse` (existing `showIf` machinery, `url` validation)
  (en + fa).

### Added (B4 — edgetunnel parity: CF usage + access log + TG events)
- New settings `cf { email, globalApiKey, accountId, apiToken, usageApiUrl }`
  (keys masked on read like `botToken`) and server-written `cfUsage
  { success, pages, workers, total, max, updatedAt }` snapshot (read-only
  panel state, zero snapshot = never refreshed).
- New authed `GET/POST api/cf-usage` (`auth: write`): GET reads the cached
  snapshot; POST optionally applies a validated `cf` patch then refreshes —
  `usageApiUrl` JSON wins over keys, else a minimal documented GraphQL
  workers-requests query fills `total` only (use the JSON feed for the full
  breakdown). Unconfigured/failed refreshes answer 200 with
  `refreshed: false`; keys never reach logs or responses.
- New authed `GET api/access-log` (`auth: read`): paginated
  `?page&limit` (limit max 100) read of served-subscription events.
  Storage reuses the D1 `audit_log` table when present (rows namespaced
  `sub:<format>`, admin-audit reads unaffected), else a KV ring (200
  entries, 30min per-format dedup); writes are non-blocking and never throw.
- Telegram per-event toggles (`onSubscribe, onSaveConfig, onAdminLogin`,
  default on) plus `silent` master switch (OFF_LOG-equivalent): the
  subscribe/save/login senders honor them, never throw, and never send
  secrets/UUIDs/paths.
- Panel Home: usage progress bar (`used/max %`) + userinfo-style
  upload/download hint + refresh button in the Status card, and a paginated
  access-log viewer; Advanced: Cloudflare usage card + TG event toggles
  (en + fa). Telegram event notifications default on — turn them off per
  event or via silent mode.

### Added (B3 — edgetunnel parity: proxy check + locations)
- New authed `POST api/proxy-check` (`auth: write`): input
  `{protocol: socks5|http|https|turn|sstp, param: user:pass@host:port}` →
  dials the proxy via the existing egress dialer (10s total budget), tunnels
  SOCKS5 or HTTP CONNECT to `cloudflare.com:80`, `GET /cdn-cgi/trace`, and
  returns `{ok, ip, loc, responseTimeMs}`. Credentials are redacted from all
  errors and logs (host-only); local/private proxy hosts are rejected.
  `https`/`turn`/`sstp` checks answer `501` (not supported yet); note the
  trace runs over port-80 plain HTTP because workerd sockets cannot
  originate TLS — the egress `ip`/`loc` signal is identical.
- New authed `GET api/locations` (`auth: read`): proxies
  `https://speed.cloudflare.com/locations` with edge-cache 1h
  (`public, max-age=3600`), 10s timeout, and 1MB cap; non-array payloads map
  to 502.
- Panel Subs utils: single-proxy check form (protocol select + address
  input) with `aria-live` result, and a locations browser (details table up
  to 500 rows plus an on-demand map). The map injects Leaflet from CDN only
  on explicit user tap — the single documented runtime-CDN exception — with
  the table as the offline fallback (en + fa).

### Added (B2 — edgetunnel parity: preferred-IP syntax + validator)
- Preferred-list line syntax for `customEndpoints` (additive, never-throw):
  `IP:port#remark` labels, `sub://…[#remark][?proxyip=true]`,
  `https://…` remote lists, `*` wildcard segments, `$socks5|http|https|
  turn|sstp://…` chain suffixes, and `?proxyip=true` flags. Invalid lines
  are reported with reasons; explicit ports must still be Cloudflare-proxied.
- New settings `preferredLocal` (default true), `preferredCount` 1–2000
  (default 16, caps consumed entries), `preferredPort` (-1 = random
  Cloudflare TLS port for port-less new-syntax lines, else explicit;
  bare `host` lines still use `defaultPort`), and `preferredRemoteUrl`
  (SUB-generator hostname override, empty = worker hostname).
- `proxyip=true` entries are tagged `proxy-ip` on nodes and feed the egress
  relay pool as candidates.
- New authed `GET/POST api/preferred-validate` (`{url?, text?}`): validates
  posted text, a fetched remote list (8s timeout, 256KB cap, local/private
  targets rejected, URL never logged), or the stored list; answers
  `{source, valid[], invalid[{line, reason}]}` with no secrets.
- Panel: preferred count/port/remote controls in the endpoints card,
  `preferred_line` live validation, a preferred-list validator button with
  valid/invalid grouping and `proxyip` badges in the Subs import card
  (en + fa).
### Added (B1 — edgetunnel parity: subscription targets + converter)
- Additive `?target=` values `surge`, `quanx`, `loon` alongside
  `base64/singbox/clash/xray` (plus `mixed` alias, `?b64`/`?clash`/`?sb`/
  `?surge`/`?quanx`/`?loon` flags and Surge/Quantumult/Loon UA sniffing).
  Converter targets fetch a configured subconverter (8s timeout, 2MB cap)
  and hot-patch Surge configs; existing format bytes are unchanged.
- New settings `subName` (download filename), `skipCertVerify`, and
  `subConverter { api, config, emoji, list, udp, xudp, tls13, appendType,
  sort, expand }` with validation, `3→4` migration, and public-view masking.
  Settings version is now 4.
- Quick-sub alias `GET /{securePath}/q` → `302 /{securePath}/sub`.
- `cnIspCode` passthrough on `/sub` (forwarded into the converter's wrapped
  mixed URL only).
- `Content-Disposition: attachment; filename=subName…` (falls back to
  `profileTitle`) and `Profile-Update-Interval` from
  `subUpdateIntervalHours`.
- Panel: per-target Subs rows (copy/QR/download) with via-converter badges,
  converter status hint, and a Subscription-converter card in Advanced with
  URL validation and a test button (en + fa).

## 1.6.0 - 2026-09-19

### Added
- Clash/Mihomo YAML and Xray-core JSON subscriptions end to end
  (`?target=clash`, `?target=xray` alongside `?target=base64` and
  `?target=singbox`).
- Optimistic settings concurrency (`rev` / `baseRev`, `409 CONFLICT`).
- Deploy Button + five-minute quickstart (`docs/QUICKSTART.md`).
