# Contract: Settings Schema (Post-Cut)

**Feature**: `001-vless-warp-slimdown` | **Date**: 2026-09-16

## Version rule

- Post-cut schema version is **3**. Any stored blob or backup with a
  version below 3 is **pre-cut** by definition.

## Removed families (never present in v3)

Protocol credentials/paths/toggles for VMess, Trojan, Shadowsocks;
remote-node list (Reality/Hy2); chain-proxy block; TOTP block;
speedtest flag; NAT64 prefixes; remote-DNS + url-test interval;
remote-subscription URL list; camouflage proxy target.

## Import rules

1. Import reads the backup's version first. Version < 3 → reject whole
   file with a clear pre-cut incompatibility message telling the admin
   to reconfigure. **Nothing is applied, nothing is merged, nothing is
   logged beyond the rejection.**
2. Unknown top-level keys in a v3 file are ignored, never merged.
3. Export emits surviving fields only, secrets always stripped.

## Boot rules

1. Boot with a store below v3 → run the user-data purge (all user
   records, usage/activity aggregates), write one log note of what was
   removed, stamp v3.
2. The purge is idempotent: re-running on a v3 store is a no-op.
3. Counters and audit log survive the purge untouched.
