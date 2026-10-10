# Changelog

## Unreleased

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
