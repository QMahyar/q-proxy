# Contract: Removed Routes

**Feature**: `001-vless-warp-slimdown` | **Date**: 2026-09-16

Closed list of URL shapes that stop existing. Every entry behaves
identically to a random unknown URL: static camouflage page, no upgrade,
no distinctive status, no identifying header.

## Deleted shapes

| Former shape | Served before | Serves after |
|--------------|---------------|--------------|
| Removed protocol tunnel paths (VMess, Trojan, Shadowsocks) | Protocol handshake over WebSocket | Camouflage (no upgrade attempted) |
| Per-user subscription URLs (any token, any target suffix) | Scoped subscription or status-coded refusal | Camouflage (tokens reveal nothing) |
| `my-ip` page/API | IP info (authed) | Camouflage |
| Version-check API | Upstream release info | Camouflage (route gone) |
| Deleted admin sub-APIs (users CRUD, TOTP, removed settings aliases) | JSON envelope | Camouflage for page routes; unknown-route handling for API routes — never a removal-specific code |

## Rules

1. No removed shape may produce a status, body, or header distinguishable
   from an unknown path.
2. The WebSocket upgrade MUST NOT be attempted for removed tunnel paths.
3. The kill-switch gate keeps running before upgrade for surviving
   routes only; it never applies to removed shapes (there is nothing to
   gate — they are unknown paths).
4. Panel deep-links to deleted views redirect to the home view
   (client-side unknown-view rule, documented once).
