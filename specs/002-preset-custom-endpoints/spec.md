# Feature Specification: Preset + Custom Endpoints

**Feature Branch**: `002-preset-custom-endpoints`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Ship a small set of curated CDN ip:port presets in code plus a custom textarea where the admin pastes their own ip:port lines for VLESS; preset WARP endpoint:port list plus a custom endpoint:port paste box merged with the account credentials and Amnezia values at emit time. Drop NAT64, custom remote-DNS, and url-test knobs; keep proxyIP pool failover and the custom DoH box."

## Clarifications

### Session 2026-09-17

- Q: Should the new CDN presets and custom paste box add to the existing addresses list, or replace it? → A: Replace: presets + custom box become the only address sources, existing list is removed.
- Q: Should existing addresses-list entries be converted into custom paste lines on upgrade, or dropped? → A: Drop them, start fresh from hostname.
- Q: Should CDN preset endpoints get fragment variants like other TLS addresses, or be excluded? → A: Included — every variant uses the same endpoints; presets/custom apply uniformly, no per-variant splitting.
- Q: Is the WARP endpoint choice per-account or one global source for all accounts? → A: One global source (preset ticks + custom box) applying to every WARP account and output family.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin picks CDN presets (Priority: P1)

The admin opens the endpoint section, sees a short curated list of CDN
`ip:port` entries, ticks the ones to use, saves, and the generated VLESS
configs include exactly those endpoints — nothing else, no typing needed.

**Why this priority**: This is the 30-second happy path for every new
deployment. If presets don't work out of the box, the feature fails.

**Independent Test**: Can be fully tested by selecting only presets on a
clean deployment and confirming every generated config resolves to a
selected preset endpoint with a valid port.

**Acceptance Scenarios**:

1. **Given** a clean deployment, **When** the admin enables two preset
   endpoints and saves, **Then** all generated VLESS configs use only those
   two endpoints.
2. **Given** presets are enabled, **When** the admin views the subscription
   in both base64 and sing-box outputs, **Then** both outputs carry the same
   endpoint set.

---

### User Story 2 - Admin pastes custom endpoints (Priority: P1)

The admin pastes their own `ip:port` lines (one per line) into the custom
box, saves, and generated configs include those addresses. Malformed lines
and ports outside the allowed families are rejected with a clear per-line
message, and valid lines are never silently dropped.

**Why this priority**: Presets never cover every network. Custom paste is
the escape hatch that makes the preset list acceptable.

**Independent Test**: Can be fully tested by pasting a mix of valid,
malformed, and out-of-family lines and confirming exactly the valid ones
appear in configs plus a clear error naming each bad line.

**Acceptance Scenarios**:

1. **Given** the custom box contains three valid `ip:port` lines, **When**
   the admin saves, **Then** generated configs include all three addresses.
2. **Given** the box contains a malformed line and a valid line, **When**
   the admin saves, **Then** the save is rejected (or the bad line is
   flagged) with a message naming the offending line — the valid line is
   never silently lost.

---

### User Story 3 - Admin sets WARP endpoints (Priority: P2)

The admin picks from preset WARP `endpoint:port` entries or pastes custom
ones — once, for all accounts — and every served WARP config (WireGuard,
sing-box, v2rayn, Throne) connects through the chosen endpoints with the
account credentials and Amnezia values intact.

**Why this priority**: WARP without endpoint control breaks on networks
where the default endpoint is blocked; this is the WARP equivalent of the
CDN preset list.

**Independent Test**: Can be fully tested by setting a custom WARP endpoint
and confirming all four WARP output families carry that endpoint with
unchanged credentials.

**Acceptance Scenarios**:

1. **Given** a custom WARP endpoint is saved, **When** the admin downloads
   each WARP output family, **Then** every file shows the custom endpoint
   and the account still authenticates.
2. **Given** no custom endpoint is set, **When** WARP configs are served,
   **Then** they use the preset default endpoint.

---

### User Story 4 - Failover survives a blocked origin (Priority: P2)

When the direct route to a destination fails, the worker retries through
the proxyIP pool and the connection still succeeds — the admin configured
nothing beyond the pool list.

**Why this priority**: This is the reliability story that justifies keeping
the proxyIP pool while NAT64 and other knobs are deleted.

**Independent Test**: Can be fully tested by simulating a dead direct route
and confirming the connection succeeds via a pool entry with no admin
intervention.

**Acceptance Scenarios**:

1. **Given** a configured proxyIP pool and a blocked direct route, **When**
   a client connects, **Then** the connection succeeds through the pool.
2. **Given** an empty proxyIP pool, **When** the direct route works, **Then**
   connections succeed directly with no behavior change.

### Edge Cases

- What happens when the custom box is completely empty and no preset is
  ticked? The worker hostname MUST remain as the fallback address so
  subscriptions are never empty.
- What happens when a pasted line uses a port outside the allowed families?
  It MUST be rejected with a message, never silently converted.
- What happens when duplicate addresses are pasted (different case or
  formatting)? They MUST be deduplicated to one node each.
- What happens when the same endpoint is both ticked as a preset and pasted
  as a custom line? It MUST appear once (deduplicated by host and port
  across both sources).
- What happens when the proxyIP pool list itself contains a dead entry?
  Failover MUST skip it and try the next entry.
- What happens to addresses configured before the cut? They are dropped,
  not migrated: after upgrade the admin re-ticks presets or re-pastes
  lines, and until then subscriptions serve the worker-hostname fallback.
- What happens when the global WARP selection is empty (nothing ticked,
  custom box empty)? The `default` preset applies — WARP configs are never
  empty for this reason.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Panel MUST present a curated CDN `ip:port` preset list with
  per-entry enable toggles; only Cloudflare-family ports are eligible.
- **FR-002**: Panel MUST provide a custom `ip:port` paste box (one entry
  per line) validated per line with messages naming offending lines.
- **FR-003**: Generation MUST use only enabled presets plus valid custom
  entries plus the worker-hostname fallback, across every output variant
  (normal and fragment alike); the previous `addresses` list
  (with per-address host/SNI overrides and country tags) is REMOVED, along
  with the `?country=` subscription filter that read those tags.
  `defaultPort` stays as the fallback port for pasted lines without one.
- **FR-004**: Panel MUST present ONE global WARP `endpoint:port` preset list
  plus a custom paste box with the same per-line validation discipline;
  this single choice governs every WARP account and output family.
  Per-account endpoint selection is retired (stored per-account lists are
  ignored, not migrated).
- **FR-005**: All served WARP outputs MUST carry the globally selected WARP
  endpoints with account credentials and Amnezia values unchanged.
- **FR-006**: ProxyIP pool failover MUST retry failed direct routes through
  pool entries in order, skipping dead entries.
- **FR-007**: Panel MUST provide a single custom DoH address box; the
  previous remote-DNS, NAT64-prefix, and url-test-interval controls MUST
  be gone.
- **FR-008**: Fragment presets plus custom fragment box and
  fingerprint/SNI controls MUST continue to apply to generated nodes
  unchanged by the endpoint rework — including preset endpoints, which get
  fragment variants like any other TLS address (no per-variant endpoint
  splitting).

### Key Entities

- **CDN preset**: a curated `ip:port` entry shipped with the panel,
  individually enable-able by the admin.
- **Custom endpoint line**: one admin-pasted `ip:port` (VLESS) or
  `endpoint:port` (WARP) entry; validated, deduplicated, preserved verbatim.
- **ProxyIP pool**: the admin's list of egress fallback addresses used only
  when the direct route fails.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admin enables presets only and gets working VLESS configs in
  under 2 minutes with zero typing.
- **SC-002**: A paste box containing 5 valid and 2 invalid lines yields
  exactly the 5 valid endpoints in configs plus errors naming both bad
  lines.
- **SC-003**: A custom WARP endpoint appears in all four WARP output
  families with working authentication.
- **SC-004**: With the direct route blocked, connections succeed through
  the pool with no admin action.
- **SC-005**: No NAT64, remote-DNS, or url-test controls remain visible in
  either language, and subscriptions are never empty (hostname fallback).

## Assumptions

- Spec 001 is implemented first; this spec builds on the trimmed codebase.
- Allowed port families are fixed policy (TLS vs plain sets), not admin
  configuration.
- Preset list contents (which IPs ship) are chosen at plan time from the
  operator's known-good set; the mechanism matters more than the entries.
- WARP output family consolidation itself is spec 003; this spec only
  governs which endpoints those outputs carry.
