# Data Model: Preset + Custom Endpoints

**Feature**: `002-preset-custom-endpoints` | **Date**: 2026-09-17

Builds on the 001 post-cut schema (version 3, unchanged). Two additive
settings fields; one shipped data list; one WARP fallback rule. No new
entities in KV/D1 beyond settings-blob fields.

## Added

### CdnPreset (shipped data, not stored per-admin)

Lives in `src/nodes/cdn-presets.ts`. The single blessed hard-coded-address
source per constitution Principle IV.

- `id: string` — stable key (`cf-443-a`, …); referenced by `Settings.cdnPresets`. Never renamed once shipped (admin blobs store ids).
- `label: string` — short human tag shown in the panel (e.g. `CF 104.17.0.0:443`).
- `ip: string` — IPv4 literal or hostname. No ports outside the CF families (pinned by unit test).
- `port: number` — CF-family port only.

### Settings.cdnPresets: string[]

Enabled preset ids for VLESS generation. Default `[]` (clean installs behave as today). Unknown ids (preset removed in a later release) are ignored at generation, never error — presets are data, admin choice survives data edits.

### Settings.customEndpoints: string[]

Verbatim valid `ip:port` lines from the admin paste box, one entry per line. Default `[]`. Stored only after per-line validation passes (see contracts/endpoint-validation.md); invalid lines reject the whole save with offending lines named. Max 64 lines.

## Removed (dropped, not migrated — clarified 2026-09-17)

### Settings.addresses (+ AddressSetting)

The whole list goes: per-address host/SNI overrides, labels, country tags, enabled toggles. The `?country=` subscription filter dies with it, and `resolveHostname` falls back to the request hostname. Pre-cut entries are dropped on upgrade (deep-merge ignores unknown keys); the hostname fallback keeps subscriptions non-empty until the admin re-ticks/re-pastes.

## Unchanged (extended in use, not in shape)

### WARP preset store / account credentials / Amnezia

Preset CRUD, account credentials, and Amnezia values are untouched. Only the SELECTION moves: new global `warpPresets: string[]` (default `["default"]`) + `warpCustomEndpoints: string[]` (default `[]`, same per-line discipline as VLESS custom lines). Per-account `endpoint_list` is retired — stored values ignored, not migrated.

### ProxyIP pool / DoH / fragment / fingerprint

No model changes (verify-only per research Decision 6).

## Lifecycle / State transitions

| From | Event | To |
|------|-------|----|
| Clean install (v3, `cdnPresets: []`, `customEndpoints: []`) | Admin ticks presets, saves | Generation includes exactly those preset endpoints |
| Custom box with bad line(s) | Save | Rejected whole, per-line messages, stored state untouched |
| Custom box emptied + no presets ticked | Generation | Worker-hostname fallback node(s); subscription never empty |
| Global WARP selection empty | Emit | `default` preset endpoints (never an empty config) |
| Preset id removed from shipped file / preset store | Generation / emit | Id ignored; everything else unaffected |

## Volume / scale assumptions

Single admin; ≤8 shipped presets; ≤64 custom lines; merged node set still bounded by `maxNodesPerFormat` (spec 004's cap governs output size, not this spec).
