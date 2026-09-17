# Contract: WARP Endpoints (One Global Source)

**Feature**: `002-preset-custom-endpoints` | **Date**: 2026-09-17 (clarified: global source replaces per-account selection)

The preset store (default/iran/china seed + admin CRUD) and account
credentials/Amnezia are unchanged. Only the SELECTION is new and global.

## Selection

- `warpPresets: string[]` — enabled preset ids, default `["default"]`.
- `warpCustomEndpoints: string[]` — verbatim valid `endpoint:port` lines, default `[]`, same per-line discipline as endpoint-validation.md (named rejects, verbatim keeps, ≤64 lines).
- Effective endpoint set = resolved ticked presets + parsed custom lines, deduplicated by lowercased `ip:port`.

## Rules

1. The global selection governs EVERY account and ALL four output families, in every variant (normal, Amnezia). No per-variant, per-account splitting.
2. An empty global selection (nothing ticked, custom box empty) MUST resolve to the `default` preset — served WARP configs are never empty for this reason.
3. All families MUST render the resolved endpoints with account credentials and Amnezia values byte-identical to a preset-sourced render (only the endpoint changes).
4. Custom WARP endpoints are rendered into client configs only; the worker MUST NOT dial, probe, or resolve them server-side (no SSRF surface by construction).
5. Unknown preset ids resolve by ignoring them; if nothing remains, rule 2 applies. Per-account `endpoint_list` values stored before the cut are ignored, not migrated.
