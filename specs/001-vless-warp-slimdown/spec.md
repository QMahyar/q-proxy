# Feature Specification: VLESS + WARP Slim-Down

**Feature Branch**: `001-vless-warp-slimdown`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Remove every non-VLESS protocol inbound (VMess, Trojan, Shadowsocks), Reality/Hy2 remote nodes, chain proxies, and the multi-user system (scoped token subs, quotas, expiry); cull VLESS subscription outputs to base64 + sing-box; delete TOTP, speedtest intercept, my-ip checker, version-check, remote-sub merging, NAT64, and camouflage-proxy mode. Single-admin, VLESS-over-WebSocket + WARP only."

## Clarifications

### Session 2026-09-16

- Q: When an admin imports a pre-cut settings backup containing removed protocols, users, and fields, should the system migrate it or reject it? → A: Reject with a clear message naming the backup as pre-cut and telling the admin to reconfigure (no partial import).
- Q: Should pre-cut stored per-user data (user records, usage counters) be actively purged on first boot after the cut, or left inert and invisible? → A: Purge on first boot after the cut, with a logged note of what was removed.
- Q: When something requests a removed tunnel path or a dead per-user subscription URL, should the worker fall through to the camouflage page like any unknown URL, or refuse explicitly? → A: Fall through to camouflage,   identical to any random unknown URL.
- Q: Which Telegram bot commands survive the cut? → A: Keep status, sub links, and kill on/off; drop per-user usage; rewrite help.
- Q: When the admin opens a bookmark to a deleted panel view (for example the old users page), where should the panel send them? → A: Home view, with the unknown-view redirect rule documented once.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin serves VLESS + WARP after the cut (Priority: P1)

The single admin opens the panel, configures VLESS and WARP, and every
subscription link they copy serves working configs — VLESS over WebSocket
plus WARP — with nothing referencing removed protocols.

**Why this priority**: This is the whole product after the cut. If VLESS or
WARP regresses, nothing else matters.

**Independent Test**: Can be fully tested by configuring VLESS + WARP on a
clean deployment, fetching each subscription output, and importing them
into v2rayNG and a sing-box client — all connect, and no output mentions
VMess, Trojan, Shadowsocks, Reality, or Hy2.

**Acceptance Scenarios**:

1. **Given** a clean deployment, **When** the admin completes setup and
   copies each subscription link, **Then** every link serves valid configs
   that connect through the worker.
2. **Given** the trimmed panel, **When** the admin searches all settings and
   views for removed protocol names, **Then** no setting, toggle, help text,
   or output references them.

---

### User Story 2 - Removed routes look untouched (Priority: P1)

Anyone (or any old client config) requesting a removed protocol path, a
per-user subscription link, or a deleted admin endpoint gets the
camouflage page, byte-identical to any random unknown URL — no tunnel, no
data leak, no hint that anything was ever there.

**Why this priority**: Security boundary. A distinct refusal would advertise
the removal; answering every probe with the same camouflage page gives
scanners nothing to distinguish.

**Independent Test**: Can be fully tested by requesting each removed URL
shape from the previous release and confirming each response is identical
to a random unknown URL, with no proxied connection ever established.

**Acceptance Scenarios**:

1. **Given** an old client config pointing at a removed protocol path,
   **When** it attempts to connect, **Then** the worker answers with the
   camouflage page exactly as for an unknown path, and no proxied traffic
   flows.
2. **Given** an old per-user subscription token, **When** it is requested,
   **Then** the worker serves the camouflage page, identical to any random
   URL, revealing nothing about the former user system.

---

### User Story 3 - Deleted panel surfaces are gone (Priority: P2)

The admin panel shows no trace of the user-management section, TOTP setup,
speedtest toggle, my-ip page, version-check button, remote-subscription
list, NAT64 fields, or proxy-mode camouflage — in either language.

**Why this priority**: Every leftover surface is a support question and a
trust bug ("is multi-user still recording my guests?").

**Independent Test**: Can be fully tested by walking every panel view in
English and Persian and confirming the absence of each removed surface,
with no orphaned dictionary strings or dead navigation entries.

**Acceptance Scenarios**:

1. **Given** the admin opens each panel view in English, **When** they look
   for user management, TOTP, speedtest, my-ip, version-check, or remote
   subs, **Then** none exist.
2. **Given** the panel in Persian, **When** the admin walks the same views,
   **Then** the same surfaces are absent and no untranslated leftover
   strings appear.

---

### User Story 4 - Export/import survives the schema cut (Priority: P2)

An admin with a pre-cut settings backup is told plainly it is incompatible
and must reconfigure, and post-cut exports never contain removed fields or
secrets.

**Why this priority**: The cut changes the settings schema. Silent data
loss or secret leakage through backups would be a trust-breaking bug.

**Independent Test**: Can be fully tested by exporting settings after the
cut, inspecting the file for removed fields and secrets, and importing an
old backup to confirm a clear incompatibility message with nothing
applied.

**Acceptance Scenarios**:

1. **Given** a post-cut deployment, **When** the admin exports settings,
   **Then** the file contains no removed-protocol fields, no user records,
   and no secrets.
2. **Given** a pre-cut backup file, **When** the admin imports it, **Then**
   the system rejects it with a clear pre-cut incompatibility message and
   applies nothing — never a half-applied state, never a silent migration.

### Edge Cases

- What happens when a client sends a `?target=` value naming a deleted
  format (e.g. `?target=clash`)? It MUST be rejected as an invalid target,
  not silently remapped.
- How does the system handle a saved bookmark to a deleted panel view
  (e.g. the users page)? It MUST redirect to the home view, never a blank
  page; the unknown-view redirect rule is documented once.
- What happens to stored per-user data from before the cut? It MUST be
  purged on first boot after the cut, with a logged note of what was
  removed — never served, never exported, never retained.
- What happens when Telegram bot commands reference removed features
  (e.g. per-user usage)? Only status, sub links, and kill on/off survive;
  per-user usage is dropped and help is rewritten — no command may error
  out.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Worker MUST terminate VLESS over WebSocket exactly as before
  the cut (same handshake, same relay behavior, same close semantics).
- **FR-002**: Worker MUST serve WARP subscription outputs exactly as before
  the cut (scope of output consolidation is spec 003, not this spec).
- **FR-003**: System MUST NOT serve VMess, Trojan, or Shadowsocks inbounds;
  requests to their former paths MUST fall through to camouflage,
  identical to any unknown URL.
- **FR-004**: System MUST NOT serve Reality/Hy2 remote-node configs in any
  subscription output.
- **FR-005**: System MUST NOT offer chain-proxy (chained egress) settings or
  behavior; egress is direct-or-proxyIP as defined in spec 002 scope.
- **FR-006**: System MUST NOT serve per-user token subscriptions; former
  token URLs MUST fall through to camouflage, identical to any unknown URL.
- **FR-007**: Panel MUST NOT expose user management, TOTP, speedtest, my-ip,
  version-check, remote-subscription, NAT64, or camouflage-proxy surfaces in
  either language.
- **FR-008**: Subscription negotiation MUST support base64 and sing-box
  targets; deleted format targets MUST be rejected as invalid.
- **FR-009**: Settings export MUST exclude removed fields and all secrets;
  import of a pre-cut backup MUST be rejected with a clear incompatibility
  message and apply nothing, never half-apply and never silently migrate.
- **FR-010**: Telegram bot MUST keep exactly status, sub links, and kill
  on/off commands; per-user usage MUST be dropped and help rewritten; no
  command may fail because its feature is gone.
- **FR-011**: Camouflage MUST retain static-page mode only; proxy mode MUST
  be removed along with its fetch path.
- **FR-012**: The full verification loop (type checks, unit + worker tests,
  UI walk where panel changed) MUST pass with zero references to removed
  symbols in tests, dictionaries, or golden files.
- **FR-013**: Pre-cut stored per-user data (user records, usage counters)
  MUST be purged on first boot after the cut with a logged removal note.

### Key Entities

- **Admin subscription**: the single set of subscription links owned by the
  admin; the only subscription class after the cut.
- **Removed surface**: any route, setting, panel view, bot command, or output
  variant belonging to the deleted scope; tracked as a closed list during
  review, not an open judgment call.
- **Settings backup**: the exported settings file; the compatibility
  boundary between pre-cut and post-cut deployments.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admin configures VLESS + WARP on a clean deployment and
  connects with both v2rayNG and a sing-box client within 10 minutes.
- **SC-002**: Zero occurrences of removed protocol/format/feature names
  across panel text, subscription outputs, exports, and bot replies in
  either language.
- **SC-003**: All requests to removed paths answer identically to unknown
  URLs with no proxied connection established, verified across every
  removed URL shape.
- **SC-004**: Settings backup round-trip (export then import) completes with
  no removed fields, no secrets, and no half-applied state.
- **SC-005**: The total settings field count drops by at least 25% versus
  the pre-cut schema, and at least 4 subscription output variants are gone.

## Assumptions

- The triage verdicts of constitution v1.2.0 are final and are not
  re-litigated in this spec.
- Telegram bot itself is kept; only its removed-feature commands change.
- Static camouflage page content is kept as-is; only proxy mode is removed.
- Pre-cut stored per-user data is purged on first boot; no data-retention
  obligation exists for a single-admin deployment.
- Specs 002–004 build on the codebase state produced by this spec.
