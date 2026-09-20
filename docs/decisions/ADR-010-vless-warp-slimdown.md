# ADR-010: VLESS+WARP slim-down (single-admin cut)

## Status
Accepted

## Date
2026-09-16

## Context
Q Proxy grew VMess/Trojan/Shadowsocks inbounds, Reality/Hy2 remote nodes, chain proxies, a ≤50-user system with quotas/expiry, TOTP, speedtest intercept, my-ip/version-check probes, remote-sub merging, NAT64, camouflage-proxy mode, and six VLESS + seventeen WARP output variants. Constitution v1.2.0 (triaged 2026-09-16 against BPB/Nahan/Edge parity) locks the product as single-admin VLESS-over-WebSocket + WARP only: every extra inbound doubles the handshake audit surface, every extra emitter doubles golden-test load, and proxy traffic spends the 100k req/day free-tier budget. Spec `001-vless-warp-slimdown` is the execution plan; this ADR records the why.

## Decision
Delete with the schema-first order (Settings type → descriptors/validation → panel → routes/handlers → node/emitter code → tests/goldens → docs), so the repo's own drift guards fail fast on any missed step:
- Protocols: VMess/Trojan/Shadowsocks inbounds (files, credentials, paths, toggles), Reality/Hy2 remote nodes, chain proxies, gRPC/xhttp (never existed — stays out). `TunnelKind` is `"vless"`; generation, share-URIs and naming are VLESS-only.
- Outputs: VLESS `base64` + `singbox` only (clash/surge/loon/quantumult emitters, registry entries, UA branches, labels and goldens deleted; deleted `?target=` values are 400 invalid, never remapped). Remote-sub merging deleted (single admin serves own nodes). WARP families untouched here (spec 003 owns them).
- Users system deleted whole: `src/users/`, per-user token subs, quotas, expiry, 410/429 user flows, D1 user tables (`migrations/0002_drop_users.sql`), KV user keys. Removed URLs (tunnel paths, dead token URLs, deleted APIs) fall through to static camouflage identical to unknown paths — no distinctive status.
- Settings cut + `SETTINGS_VERSION` 2→3 with `MIGRATIONS[2]` (strip removed keys, `camouflage.proxy→static`). Pre-cut backups are rejected whole at import (no silent migration); pre-cut user data is purged on first boot with a logged note (counters/audit survive).
- Egress is direct + proxyIP pool only (chain/NAT64/speedtest code deleted; `dialTcp` kept in `egress.ts`; per-IP ratelimit relocated to `src/tunnel/ratelimit.ts`). Custom DoH kept; remote-DNS/url-test knobs dropped (sing-box DNS/interval baked to previous defaults).
- Panel: users views, TOTP card, speedtest, my-ip, version-check, remote-subs, NAT64, camouflage-proxy controls deleted (dict 564→392 keys EN+FA parity kept); deleted views redirect home.
- Auth: password-only login (TOTP block, pre-auth cookie, recovery codes deleted). Telegram: status/sub-links/kill on-off + rewritten help only (usage/expiry/sweep deleted). Camouflage static-only (proxy fetch + SSRF surface deleted). my-ip/version-check handlers deleted.

## Consequences
- Request surface strictly shrinks (no remote fetches, no proxy camouflage fetches, fewer/smaller sub variants) — positive for the 100k/day budget (spec 004 enforces it).
- Pre-cut backups do not import (reject with a clear message); pre-cut user data is unrecoverable after first boot — both intentional, covered by `test/workers/settings-cut.spec.ts`.
- Re-adding anything on this list is a MAJOR governance decision (ADR + frozen-contract Rev + major version bump).
- Golden moves in this change are pre-authorized by the v1.2.0 triage (old→new recorded in the change report, not repeated here).
