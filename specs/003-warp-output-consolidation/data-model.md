# Data Model: WARP Output Consolidation

**Feature**: `003-warp-output-consolidation` | **Date**: 2026-09-17

Shrinks one registry, adds one boolean, retires two per-account fields to
inert status. No new KV keys, no D1 changes, no settings-schema changes.

## Added

### WarpGlobalSettings.amneziaEnabled: boolean

Global Amnezia switch, stored alongside the existing global Amnezia values
in the same KV record, accepted by the existing `amnezia` PUT endpoint.
Default `false` (clean standard outputs = today's plain-family bytes).
When ON, the WireGuard config and sing-box outputs render Amnezia values;
Throne and v2rayn are unaffected by it (always / never, respectively).

## Shrunk

### Served WARP families: 17 → 4

Survivors: `wireguard-conf` (zip bundle), `singbox` (JSON), `v2rayn`
(base64 links), `throne` (links + Amnezia values, always). Everything else
(`wireguard-conf-amnezia` twin, `throne-amnezia` twin, `wireguard-uri`
route, `singbox-legacy` twins, `singbox-amnezia` twin, `xray`, `clash`
twins, `surge`, `surfboard`, `loon`, `egern`) stops being served; requests
for those names fall through to camouflage.

## Retired (inert, not migrated)

### WarpAccount.amnezia_overrides

Render ignores it; update paths ignore writes to it; panel card deleted.
Stored values stay in blobs untouched.

### WarpAccount.endpoint_list (affirmed)

Retired under spec 002 (global selection governs); restated here because
the four families render exclusively from the global endpoints — no family
may consult per-account lists.

## Lifecycle / State transitions

| From | Event | To |
|------|-------|----|
| Any toggle state | Flip the global switch | Next fetch of WG conf / sing-box carries or drops Amnezia values; Throne unchanged; v2rayn unchanged; served copies purged |
| Deleted format URL (incl. old `-amnezia` twins) | Any request | Static camouflage page, identical to unknown URL |
| Credential rotation/regeneration | Next fetch per family | Fresh credentials in all four families; stale copies purged, never served |
| Pre-cut account with overrides | Render | Overrides ignored; global switch + global values apply |

## Volume / scale assumptions

Single admin, handful of accounts; four served families; one boolean. No
pagination, indexing, or quota design needed.
