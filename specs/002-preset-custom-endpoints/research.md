# Research: Preset + Custom Endpoints

**Feature**: `002-preset-custom-endpoints` | **Date**: 2026-09-17

Technical Context contained zero `NEEDS CLARIFICATION` markers — the spec
delegates the preset contents to plan time (a data choice, made below as
Decision 4) and everything else is fixed by the repo, the 001 baseline, and
constitution v1.2.0. Code survey (2026-09-17) confirmed: WARP preset+custom
per-account lists exist end-to-end (`warp/store.ts` DEFAULT_PRESETS,
`endpoint_list` preset|custom, `expand.ts` merge, `api/warp.ts` validation,
panel preset select + custom box); proxyIP failover, single DoH box, and
fragment/fingerprint/SNI paths are built and covered by 001 tests. This
Phase 0 records the design decisions so Phase 2 follows one playbook.

## Decision 1: Presets + custom box REPLACE the addresses list (clarified 2026-09-17)

- **Decision**: Ship `src/nodes/cdn-presets.ts` (array of `{id, label, ip, port}`, no imports). Store admin choice as `cdnPresets: string[]` (enabled ids) plus `customEndpoints: string[]` (verbatim valid lines). `collectAddresses` is rebuilt around these two sources plus hostname fallback; the `addresses[]` list (`AddressSetting` with host/SNI/country overrides), the `?country=` filter, and the hostname-picking use in `resolveHostname` are deleted. Pre-cut `addresses[]` data is dropped on upgrade, not migrated (clarified); until the admin re-ticks/re-pastes, the hostname fallback keeps subscriptions non-empty.
- **Rationale**: One address source for all VLESS outputs, applied uniformly to every variant — the operator's explicit verdict. No per-variant splitting, no three-way merge matrix, no metadata the paste box cannot carry.
- **Alternatives considered**: Merging alongside `addresses[]` — rejected by the operator: replacement, clean break.

## Decision 2: Settings version stays 3 (no bump, no migration step)

- **Decision**: New fields default-fill via `deepMergeDefaults`; `SETTINGS_VERSION` remains 3; no `MIGRATIONS[3]`; the import-reject rule (`version < 3`) is untouched.
- **Rationale**: 001 defined pre-cut as `version < SETTINGS_VERSION`. Bumping to 4 would reclassify every v3 backup (including post-cut production backups) as pre-cut and brick their imports — the exact data-loss scenario FR-009 exists to prevent.
- **Alternatives considered**: Bump + carve-out (`< 3` reject instead of `< SETTINGS_VERSION`) — rejected: two version constants telling different stories rots within one release cycle.

## Decision 3: Dedupe by host:port (change from host-only)

- **Decision**: `collectAddresses` dedupe key becomes `` `${host}:${port}` `` (lowercased host). Formatting/case variants of the same endpoint collapse; same IP on different ports stays distinct.
- **Rationale**: The current host-only key would silently drop preset entries sharing an IP across ports (the file reuses Cloudflare IPs on 443/2053/2083/… by design). Spec edge case demands formatting-duplicates collapse to one node each — host:port is exactly that rule.
- **Alternatives considered**: Keep host-only dedupe — rejected: it would eat legitimate preset entries with zero diagnostic.

## Decision 4: Shipped preset contents (operator-confirmable data)

- **Decision**: 8 entries, all default-disabled (clean installs behave exactly as today via hostname fallback):
  - TLS 443: `104.17.0.0`, `104.18.0.0`, `104.19.0.0`
  - TLS 2053: `104.21.0.0`; TLS 2083: `172.64.32.1`; TLS 2096: `188.114.96.1`
  - Plain 80: `104.17.0.0`; plain 8080: `172.64.32.1`
  - A unit test pins every preset port inside the CF families, so a bad entry fails CI instead of shipping.
- **Rationale**: Public Cloudflare anycast IPs from the ranges the BPB/Edge community has used for years; spread across port families so TLS-only fragments and plain fallback both have options. Disabled-by-default preserves current behavior until the admin opts in (spec US1 ticks them explicitly).
- **Alternatives considered**: Enabled-by-default presets — rejected: changes every existing deployment's subscription output on upgrade with no admin action. Larger list (20+) — rejected: YAGNI; the custom box covers the long tail.

## Decision 5: WARP gets ONE global endpoint source (clarified 2026-09-17)

- **Decision**: New global settings `warpPresets: string[]` (default `["default"]`, ids into the existing KV preset store) + `warpCustomEndpoints: string[]` (default `[]`, same per-line discipline as VLESS). `expandAccount` renders every account from the global selection; an empty global selection resolves to the `default` preset, never an empty config. Per-account `endpoint_list` selection is retired: stored per-account lists are ignored, not migrated (same clean-break rule as VLESS).
- **Rationale**: Operator verdict — one option for all WARP configs, applied uniformly to every output family in every variant (normal, Amnezia). The existing preset store (default/iran/china + admin CRUD) is reused as the id registry; only the selection moves from per-account to global.
- **Alternatives considered**: Keeping per-account selection — rejected by the operator: one global choice.

## Decision 6: US4, FR-007, FR-008 are verify-only (already built under 001)

- **Decision**: No source changes for proxyIP failover ordering, the single DoH box, or fragment/fingerprint/SNI application. Phase 2 carries regression tasks (existing suites stay green) plus one workers-level assertion where cheap; quickstart re-validates behavior manually.
- **Rationale**: `egress.spec.ts` (17 tests: ordering, deterministic shuffle, cap, dedupe, speculative direct, failover-including-retry) plus the 1011-bytes e2e already prove FR-006; fields/panel/drift suites prove FR-007; fragment/generate suites prove FR-008. Rebuilding them would be change for its own sake.
- **Alternatives considered**: A workers-e2e pool-failover test with a dead direct route — rejected: it needs real blocked-origin dials, nondeterministic in CI; the unit seam plus manual quickstart step is the honest coverage.

## Decision 7: Invariant-X reconciliation (preset file is the single blessed exception)

- **Decision**: Address-composition tests (`test/nodes/generate.spec.ts` guarantee + any panel invariant) are updated to allow preset-file entries as generation sources alongside hostname/`addresses[]`/custom lines — and nothing else. The preset module carries a header comment citing constitution Principle IV.
- **Rationale**: Principle IV explicitly authorizes "nothing hard-coded into generation beyond the shipped preset file"; invariant X's test enforcement predates that exception. Updating the tests (not weakening them — the allowed-source set stays closed) keeps the guard meaningful.
- **Alternatives considered**: Leaving the old tests to fail — rejected: red guards teach contributors to ignore guards.
