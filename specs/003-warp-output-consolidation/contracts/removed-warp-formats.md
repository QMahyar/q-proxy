# Contract: Removed WARP Formats

**Feature**: `003-warp-output-consolidation` | **Date**: 2026-09-17

Closed list of route names that stop existing. Every entry behaves
identically to a random unknown URL: static camouflage page, no
distinctive status, no identifying header — the same doctrine as
spec 001's removed-routes contract.

## Deleted names

`wireguard-conf-amnezia`, `throne-amnezia`, `wireguard-uri`,
`singbox-amnezia`, `singbox-legacy`, `singbox-legacy-amnezia`, `xray`,
`clash`, `clash-amnezia`, `surge`, `surfboard`, `loon`, `egern`.

## Rules

1. No deleted name may produce a status, body, or header distinguishable
   from an unknown path (this replaces today's distinct 404 — a deliberate,
   clarified behavior change).
2. Invalid account tokens keep their existing handling; this contract covers
   format names only.
3. Panel deep-links or bookmarks to deleted formats land on a valid view,
   never a blank page (client-side unknown-view rule, documented once —
   same rule as spec 001).
4. The WARP panel section offers exactly the four surviving families plus
   the Amnezia switch, in either language, with no references to deleted
   names.
