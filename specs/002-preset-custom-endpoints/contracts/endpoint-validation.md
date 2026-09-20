# Contract: Custom Endpoint Validation (VLESS + WARP boxes)

**Feature**: `002-preset-custom-endpoints` | **Date**: 2026-09-17

Shared per-line discipline for both paste boxes (VLESS `ip:port` lines and
global WARP `endpoint:port` lines).

## Line grammar

One entry per line: `ip-or-host[:port]`, IPv6 in brackets (`[2a02:…]:443`).
An omitted port means `defaultPort`. Blank lines are ignored (not errors).

## Rules (VLESS boxes; WARP box differs only on rule 2)

1. Each non-blank line MUST parse via the shared `parseHostPort` helper. Unparsable lines reject the save.
2. VLESS boxes only: resolved ports MUST be in the CF families (see cdn-presets.md rule 1). Out-of-family lines reject the save — never silently converted or dropped. The WARP box allows any port 1–65535 (WireGuard ports like 2408/500/1701 are not CF ports).
3. Rejection messages MUST name every offending line (1-based line number + verbatim content, truncated to 64 chars).
4. The whole save is rejected when any line is bad; stored state is untouched, and valid lines are never silently lost (the panel keeps the admin's text for correction).
5. Stored lines are kept verbatim (trimmed). Dedupe happens at generation by `host:port` (case-insensitive), not at save — what the admin pasted is what export shows.
6. Custom lines are generation-only addresses. They MUST NOT be fetched, probed, or health-checked by the worker (no request-budget cost, no SSRF surface).
7. Max 64 stored lines. Longer boxes reject with a count message.
