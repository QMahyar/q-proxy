# Contract: Served WARP Families (Post-Cut)

**Feature**: `003-warp-output-consolidation` | **Date**: 2026-09-17

## The four survivors

| Family (route name) | Content | Amnezia behavior |
|---------------------|---------|------------------|
| `wireguard-conf` | Zip bundle, official WireGuard app import | Toggle ON: Amnezia fields present; OFF: clean (byte-identical to today's plain zip) |
| `singbox` | JSON profile | Toggle ON: Amnezia values present; OFF: clean (byte-identical to today's plain JSON) |
| `v2rayn` | Base64 links | NEVER carries Amnezia values |
| `throne` | Links + Amnezia values (always) | ALWAYS carries Amnezia values, regardless of toggle |

## Rules

1. Exactly these four route names are served. Every other name — including
   yesterday's `-amnezia` twins, `wireguard-uri`, `singbox-legacy` twins,
   `xray`, `clash` twins, `surge`, `surfboard`, `loon`, `egern` — falls
   through to camouflage (see removed-warp-formats.md).
2. Toggle-OFF bytes for `wireguard-conf` and `singbox` MUST be byte-identical
   to the pre-cut plain outputs. Toggle-ON bytes MUST equal the pre-cut
   `-amnezia` twin bytes for the same account.
3. `throne` bytes MUST equal the pre-cut `throne-amnezia` bytes for the same
   account, in all toggle states.
4. All four families render the spec-002 global endpoints with account
   credentials intact; endpoint changes never alter Amnezia behavior and
   Amnezia changes never alter endpoints.
5. `emitWireguardUri` remains as an INTERNAL helper (v2rayn builds on it);
   it is not a served format.
