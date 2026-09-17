# Quickstart: WARP Output Consolidation

**Feature**: `003-warp-output-consolidation` | **Date**: 2026-09-17

Validation guide proving the consolidation end-to-end. Run in order on a
deployment built from this branch. See [data-model.md](data-model.md) and
[contracts/](contracts/) for expected shapes (not duplicated here).

## Prerequisites

- Clean deployment of this branch; admin session; one registered WARP
  account with the global Amnezia values set.
- The official WireGuard app (or importer), a sing-box client, a v2rayn
  client, and the Throne app (or their import validators).

## Scenarios

### 1. Four families connect (10 min)

1. Download the WireGuard bundle, sing-box profile, v2rayn links, and
   Throne bundle for one account.
2. Import each into its target app.
3. **Expected**: all four connect with the same account identity
   (contracts/warp-families.md).

### 2. Toggle moves values, nothing else (5 min)

1. With the switch off, download the WG bundle and sing-box profile.
2. Flip the switch on; re-download both; diff against step 1.
3. **Expected**: only Amnezia values appear; endpoints, credentials, and DNS
   are byte-identical otherwise. Throne output is unchanged by the flip;
   v2rayn output never carries Amnezia values
   (contracts/amnezia-switch.md).

### 3. Deleted names look untouched (5 min)

1. Request each name in contracts/removed-warp-formats.md plus one random
   unknown URL.
2. **Expected**: every response is indistinguishable from the unknown-URL
   response; the survivor list is exactly four.

### 4. Rotation and flips stay fresh (5 min)

1. Share a config; flip the switch; rotate credentials.
2. **Expected**: previously shared files keep old values (snapshots — panel
   says to re-download); the next fetch of each family carries fresh
   credentials and current toggle state, never a stale mix.

### 5. Panel shows four plus a switch, both languages (5 min)

1. Walk the WARP section in English and Persian.
2. **Expected**: exactly four download families plus one Amnezia switch; no
   deleted names, no per-account Amnezia controls, no untranslated strings.

### 6. Verification loop green

1. Run type checks, the full test suite, build, and the UI walk.
2. **Expected**: all green; survivor plain goldens byte-identical to
   pre-cut; toggle-ON and camouflage-equivalence goldens added, none
   weakened.
