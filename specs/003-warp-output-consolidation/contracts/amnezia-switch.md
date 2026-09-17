# Contract: Global Amnezia Switch

**Feature**: `003-warp-output-consolidation` | **Date**: 2026-09-17

## Shape

- Stored as `amneziaEnabled: boolean` (default `false`) in the existing WARP
  global-settings KV record, alongside the Amnezia values.
- Read at render time for every account; written through the existing
  `amnezia` PUT endpoint (values + switch in one call).
- Panel offers exactly one switch in the WARP section, in both languages.
  No per-account Amnezia controls exist anywhere.

## Rules

1. One switch governs every account. There is no per-account on/off, and
   stored per-account `amnezia_overrides` are ignored at render and ignored
   on write (never error, never migrate).
2. Flipping the switch MUST purge served WARP copies (existing purge path)
   so the next fetch in every family reflects the new state — no stale mix.
3. Toggling MUST NOT alter endpoints, credentials, or DNS in any output;
   it changes only the presence of Amnezia values where the family matrix
   (warp-families.md) says it applies.
4. Previously shared files are snapshots: toggling never rewrites already
   downloaded files. The panel MUST tell the admin that clients need a
   fresh download after a flip.
