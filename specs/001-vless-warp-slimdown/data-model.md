# Data Model: VLESS + WARP Slim-Down

**Feature**: `001-vless-warp-slimdown` | **Date**: 2026-09-16

This feature deletes entities and shrinks one. No new entities are
introduced. "Removed" means gone from type, storage, panel, outputs, and
tests — never merely hidden.

## Kept (unchanged shape, reduced company)

### AdminSettings (shrunk)

The single settings blob. Surviving fields keep their current meanings;
only the removed list below disappears.

- **Removed field families**: all VMess/Trojan/Shadowsocks credentials,
  paths, and toggles; Reality/Hy2 remote-node list; chain-proxy settings;
  TOTP block; speedtest flag; NAT64 prefixes; remote-DNS + url-test
  interval; remote-subscription URL list; camouflage-proxy target
  (mode reduces to off/static).
- **Version rule**: version 3+ is post-cut. Anything older is pre-cut
  (see Lifecycle).
- **Validation**: unknown keys never merged; import of a pre-cut backup
  is rejected whole (see contracts/settings-schema.md).

### SubscriptionOutputs (shrunk)

- **VLESS targets**: exactly `base64`, `singbox`. All other target names
  are invalid.
- **WARP families**: unchanged by this spec (spec 003 owns them).

### Counters / AuditLog (kept, untouched)

Running totals and the append-only audit record. Retained through boot
and backup round-trips. These are the only D1 residents after the cut
besides schema bookkeeping.

## Deleted (purged, never served)

### UserRecord

Former per-admin-managed subscriber: name, token, enabled flag, expiry,
protocol filter, daily request limit. **All rows purged on first
post-cut boot with a logged note. No API, panel, export, or bot surface
may reference this entity afterward.**

### UserUsage / UserActivity (aggregates)

Former per-day, per-token counters and activity rollups. **Purged in the
same boot pass as UserRecord. Daily totals for the single admin
(counters) are the only usage entity that survives.**

### Removed protocol credentials

VMess UUIDs, Trojan passwords, Shadowsocks passwords/methods, per-protocol
paths — deleted as settings fields (see AdminSettings) with no migration.

## Lifecycle / State transitions

| From | Event | To |
|------|-------|----|
| Pre-cut store (v<3, with user data) | First post-cut boot | Post-cut store (v3, user data purged, log note written) |
| Pre-cut backup file | Import attempt | Rejected, nothing applied, clear message shown |
| Post-cut settings | Export | File with surviving fields only, secrets stripped |
| Removed URL (tunnel/token/API) | Any request | Static camouflage page, identical to unknown URL |
| Deleted `?target=` value | Subscription fetch | Invalid-target refusal, no substitution |

## Volume / scale assumptions

Single admin, single settings blob, a handful of endpoints (bounded by
the node cap owned by spec 004). No per-user rows exist at any scale, so
no pagination, indexing, or quota-accounting design is needed.
