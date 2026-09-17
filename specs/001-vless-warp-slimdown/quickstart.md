# Quickstart: VLESS + WARP Slim-Down

**Feature**: `001-vless-warp-slimdown` | **Date**: 2026-09-16

Validation guide proving the cut end-to-end. Each scenario maps to spec
acceptance; run in order on a deployment built from this branch. See
[data-model.md](data-model.md) and [contracts/](contracts/) for expected
shapes (not duplicated here).

## Prerequisites

- Clean deployment of this branch; fresh settings ( Bos: first-run setup).
- A v2rayNG-style client (base64 links) and a sing-box client.
- A copy of a pre-cut settings backup and the pre-cut URL shapes
  (protocol paths, a user token URL, deleted `?target=` names).

## Scenarios

### 1. Clean setup serves VLESS + WARP only (10 min)

1. Complete first-run setup; configure VLESS + WARP.
2. Fetch every subscription link offered; import base64 into v2rayNG and
   sing-box output into the sing-box client.
3. **Expected**: both connect. No offered link, setting, or help text
   names a removed protocol or format (see contracts/subscription-targets.md).

### 2. Removed paths look untouched

1. Request each removed shape from contracts/removed-routes.md plus one
   random unknown URL.
2. **Expected**: every response is indistinguishable from the unknown-URL
   response; no WebSocket upgrade is ever established.

### 3. Deleted targets rejected

1. Fetch a subscription with `?target=` set to each deleted format name.
2. **Expected**: invalid-target refusal every time, no content served
   (contracts/subscription-targets.md rule 1).

### 4. Pre-cut backup rejected, post-cut round-trips

1. Import the pre-cut backup → **expected**: clear incompatibility
   message, zero settings changed.
2. Export settings → **expected**: no removed fields, no user records,
   no secrets; re-importing the export succeeds.

### 5. Boot purge (upgrade path)

1. Deploy over a pre-cut store containing user records.
2. **Expected**: first boot purges them with one log note; token URLs
   serve camouflage; counters/audit survive; re-boot is a no-op.

### 6. Panel walk, both languages

1. Walk every view in English and Persian.
2. **Expected**: no removed surface exists; deleted-view bookmarks land
   on home; no orphaned or untranslated strings.

### 7. Telegram trimmed set

1. Send each surviving command plus a former usage command plus gibberish.
2. **Expected**: behaviors per contracts/telegram-commands.md; help lists
   exactly three commands; nothing errors.

### 8. Verification loop green

1. Run type checks, the full test suite, build, and the UI walk.
2. **Expected**: all green with zero references to removed symbols in
   code, tests, dictionaries, or goldens.
