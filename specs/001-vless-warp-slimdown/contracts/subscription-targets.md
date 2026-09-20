# Contract: Subscription Targets (Post-Cut)

**Feature**: `001-vless-warp-slimdown` | **Date**: 2026-09-16

## Valid VLESS targets

| Target value | Output |
|--------------|--------|
| `base64` | Newline-joined share URIs, base64 rendered (v2rayNG-style clients) |
| `singbox` | sing-box JSON profile |

## Rules

1. Any other `?target=` value (including all deleted format names) is an
   **invalid target** refusal. No fallback, no substitution, no warning
   header with content.
2. Target detection order is unchanged: explicit `?target=` first, then
   client sniffing over the surviving two, then the default.
3. Sniffing MUST never resolve to a deleted format for any input.
4. Browser user-agents keep receiving the info page, not configs.
5. WARP target/format behavior is unchanged by this spec (spec 003).
