# Changelog

## Unreleased

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
