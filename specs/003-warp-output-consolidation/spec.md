# Feature Specification: WARP Output Consolidation

**Feature Branch**: `003-warp-output-consolidation`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Consolidate 17 WARP output formats down to 4 served families: native WireGuard config, sing-box JSON, v2rayn links, and Throne (v2rayn values plus Amnezia values). Amnezia becomes a values toggle inside these outputs, never separate formats. Deleted formats (xray, clash, surge, surfboard, loon, egern, legacy sing-box variants, standalone zips beyond the conf bundle) are rejected as invalid."

## Clarifications

### Session 2026-09-17

- Q: Which outputs should change when the Amnezia switch is flipped on? → A: Switch affects WireGuard conf + sing-box; Throne always carries Amnezia values; v2rayn links never do.
- Q: Should there be one Amnezia switch for the whole panel, or a separate switch on each WARP account? → A: One global switch for all accounts (existing per-account overrides retired).
- Q: Should requests for deleted WARP formats get a plain not-found refusal, or the same camouflage page as unknown URLs? → A: Camouflage page, identical to any unknown URL (same as removed VLESS paths).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin serves the four WARP families (Priority: P1)

The admin registers a WARP account once, then downloads or shares four
working outputs: a native WireGuard config, a sing-box profile, v2rayn
links, and a Throne bundle — each connecting through the selected
endpoint with the account's credentials.

**Why this priority**: These four cover the official app, the modern
multi-protocol clients, the copy-paste link users, and the region-popular
Throne app. Everything else was niche duplication.

**Independent Test**: Can be fully tested by generating all four outputs
from one account and importing each into its target app — all four connect.

**Acceptance Scenarios**:

1. **Given** a registered WARP account, **When** the admin downloads the
   WireGuard config, **Then** it imports into the official WireGuard app
   and connects.
2. **Given** the same account, **When** the admin fetches the sing-box,
   v2rayn, and Throne outputs, **Then** each imports into its target app
   and connects with the same account identity.

---

### User Story 2 - Amnezia as a toggle, not formats (Priority: P1)

The admin flips one Amnezia switch and the WireGuard and sing-box outputs
carry the Amnezia values; flipping it off yields clean standard outputs.
No separate "amnezia" download options exist anywhere.

**Why this priority**: The old model multiplied every format into
plain/amnezia twins (half the 17). A toggle kills the duplication while
keeping the anti-DPI capability.

**Independent Test**: Can be fully tested by toggling Amnezia on and off
and diffing the outputs — values appear/disappear with no other change,
and no amnezia-specific download option exists.

**Acceptance Scenarios**:

1. **Given** Amnezia is off, **When** the admin downloads the WireGuard
   config, **Then** it contains no Amnezia fields and connects normally.
2. **Given** Amnezia is on, **When** the admin downloads the same outputs,
   **Then** the Amnezia values are present, the account still
   authenticates, and the panel shows no separate amnezia formats.

---

### User Story 3 - Deleted formats look untouched (Priority: P2)

Anyone requesting a deleted WARP format (xray, clash, surge, surfboard,
loon, egern, legacy variants) gets the camouflage page,
byte-identical to any random unknown URL — never a mislabeled file, never
a distinctive refusal, never a hint the format existed.

**Why this priority**: Old bookmarks and old client guides link to these
URLs. Indistinguishability teaches nothing to scanners, consistent with
every other removed path.

**Independent Test**: Can be fully tested by requesting each deleted format
name and confirming each response is identical to a random unknown URL,
plus confirming the survivor list is exactly four.

**Acceptance Scenarios**:

1. **Given** any deleted format name, **When** it is requested, **Then**
   the worker serves the camouflage page, identical to any unknown URL.
2. **Given** the panel's WARP section, **When** the admin looks for
   download options, **Then** exactly the four surviving families (plus the
   Amnezia toggle) are offered, in either language.

### Edge Cases

- What happens when Amnezia is toggled after configs were already shared?
  Previously shared files keep their old values (files are snapshots);
  the panel MUST make clear that clients need a fresh download.
- What happens when the WARP account is rotated or regenerated? All four
  families MUST reflect the new credentials on next fetch; stale cached
  copies MUST expire rather than serve dead credentials.
- What happens when a custom endpoint (spec 002) is combined with
  Amnezia on? Both MUST apply together — endpoint plus Amnezia values, no
  silent override of one by the other.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST serve exactly four WARP output families:
  native WireGuard config, sing-box JSON, v2rayn links, Throne bundle.
- **FR-002**: System MUST provide a single GLOBAL Amnezia toggle whose
  values apply to the WireGuard config and sing-box outputs of every
  account; Throne ALWAYS carries Amnezia values and v2rayn links NEVER do,
  regardless of the toggle; existing per-account Amnezia overrides are
  retired (not migrated); no standalone amnezia formats may exist.
- **FR-003**: Requests for any deleted WARP format MUST fall through to
  camouflage, identical to any unknown URL — never a distinctive status,
  never a substitution.
- **FR-004**: All four families MUST carry the globally selected endpoints
  from spec 002 (one source for every account) with account credentials
  intact.
- **FR-005**: Account rotation/regeneration MUST invalidate served copies
  so the next fetch carries fresh credentials.
- **FR-006**: Panel MUST offer exactly the four families plus the Amnezia
  toggle in both languages, with no references to deleted formats.

### Key Entities

- **WARP account**: the registered account identity (credentials);
  endpoints come from the single global selection (spec 002), not the
  account. The account is one of the sources every output renders from.
- **Output family**: one of the four served renderings of an account;
  snapshots at fetch time, not live views.
- **Amnezia values**: the optional obfuscation parameters applied as one
  global toggle onto outputs, not a parallel format set and not a
  per-account setting.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: One account produces four outputs that all connect in their
  target apps within 10 minutes of setup.
- **SC-002**: Toggling Amnezia changes only the Amnezia values in outputs;
  no separate amnezia option exists anywhere.
- **SC-003**: Every deleted format name answers identically to unknown
  URLs; the survivor list is exactly four.
- **SC-004**: After credential rotation, the next fetch of each family
  carries working credentials (no stale dead files served).
- **SC-005**: Served WARP format count drops from 17 to 4 (plus toggle).

## Assumptions

- Spec 001 is implemented first; deleted-protocol residue is gone.
- Spec 002 supplies endpoint selection; this spec only renders it.
- "Throne" means v2rayn-compatible values plus the Amnezia parameter set
  the Throne app consumes — exact parameter names pinned at plan time
  against the app's current expectations.
- The native WireGuard config remains a downloadable bundle; whether other
  families offer bundles or plain text is a presentation detail for plan
  time.
