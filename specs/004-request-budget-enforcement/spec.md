# Feature Specification: Request Budget Enforcement

**Feature Branch**: `004-request-budget-enforcement`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "Enforce the Cloudflare Workers free-tier ~100k requests/day budget: VLESS-over-WebSocket proxy traffic is the expensive consumer, subscription/WARP file serving is cheap and edge-cached, WARP WireGuard traffic never touches the worker. Caps on nodes per output, client refresh intervals, cached subscription serving, and a visible usage readout for the single admin. No per-user quota system."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin sees daily usage (Priority: P1)

The admin opens the panel and sees today's request count and the running
total at a glance, with enough context to know whether the deployment is
comfortably inside the ~100k/day budget or approaching it.

**Why this priority**: You cannot manage what you cannot see. A single
visible number replaces all guesswork about the free-tier limit.

**Independent Test**: Can be fully tested by generating traffic, then
confirming the panel readout moves and matches the worker's internal
counters.

**Acceptance Scenarios**:

1. **Given** a deployment serving traffic, **When** the admin opens the
   status view, **Then** today's count and the running total are visible
   and current.
2. **Given** a fresh day boundary, **When** the admin checks the readout,
   **Then** today's count has reset while the running total continues.

---

### User Story 2 - Subscriptions stay cheap (Priority: P1)

Clients fetch subscription and WARP files no more often than the admin's
configured refresh interval, served from edge cache — so ten clients do
not each burn a fresh worker request every few minutes.

**Why this priority**: Subscription polling is the controllable multiplier.
Caching plus honest refresh intervals is what keeps file serving near-free.

**Independent Test**: Can be fully tested by fetching the same subscription
repeatedly inside the cache window and confirming only the first fetch
reaches origin, plus confirming clients are told the admin's interval.

**Acceptance Scenarios**:

1. **Given** the admin's refresh interval is set to N hours, **When** a
   client fetches the subscription twice within minutes, **Then** the
   second fetch is served from cache, not origin.
2. **Given** any subscription response, **When** the client inspects update
   guidance, **Then** it carries the admin's configured interval, never a
   hardcoded default.

---

### User Story 3 - Node caps bound output size (Priority: P2)

The admin sets the maximum nodes per output; oversized endpoint selections
(presets plus custom lines) are trimmed to the cap deterministically, so
no subscription response can balloon unboundedly.

**Why this priority**: Response size is bandwidth and CPU per request.
Without a cap, one enthusiastic paste box creates megabyte subs on every
refresh.

**Independent Test**: Can be fully tested by configuring more endpoints
than the cap and confirming each output carries exactly the capped count,
chosen deterministically.

**Acceptance Scenarios**:

1. **Given** more selected endpoints than the cap allows, **When** any
   subscription output is fetched, **Then** it carries exactly the capped
   number of nodes.
2. **Given** the cap is lowered, **When** outputs are re-fetched after the
   change propagates, **Then** they reflect the new cap.

---

### User Story 4 - Kill-switch stops the spend (Priority: P2)

When the admin flips the kill-switch, proxied VLESS connections stop
immediately — halting request burn — while the panel itself stays
reachable so the admin can flip it back.

**Why this priority**: The emergency brake for budget blowouts and abuse.
It must kill traffic, never lock out the admin.

**Independent Test**: Can be fully tested by enabling the switch and
confirming connection attempts are refused while the panel still loads.

**Acceptance Scenarios**:

1. **Given** the kill-switch is on, **When** a client attempts a proxied
   connection, **Then** it is refused before any upstream traffic flows.
2. **Given** the kill-switch is on, **When** the admin opens the panel,
   **Then** the panel loads and the switch can be turned off.

### Edge Cases

- What happens when usage approaches the daily budget? The panel MUST show
  it plainly; automatic throttling is out of scope — the admin decides
  (kill-switch, fewer endpoints, longer intervals).
- What happens when a client ignores the refresh interval and polls
  aggressively? Cache absorbs repeats within the window; beyond that each
  poll costs — the interval guidance is advisory, the cache is the guard.
- What happens to in-flight proxied connections when the kill-switch flips?
  New connections MUST be refused; existing ones end by normal close
  semantics, never by dropping admin panel access.
- What happens when settings change (endpoints, intervals, caps)? Cached
  copies MUST invalidate so clients see the new state after propagation,
  never a mix of old and new.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Panel MUST display today's request count and running total
  to the admin.
- **FR-002**: Subscription and WARP file responses MUST be edge-cached
  with a short throttle window; repeats inside the window MUST NOT reach
  origin.
- **FR-003**: Subscription responses MUST advertise the admin's configured
  refresh interval; no hardcoded interval may be served.
- **FR-004**: A configurable maximum-nodes-per-output cap MUST bound every
  subscription output deterministically.
- **FR-005**: Kill-switch MUST refuse new proxied connections while leaving
  the panel reachable.
- **FR-006**: Settings changes affecting served content MUST invalidate
  cached copies (no stale mix served past propagation).
- **FR-007**: No per-user quota, per-token accounting, or per-user readout
  may exist — single-admin totals only.
- **FR-008**: Auxiliary fetches the worker performs itself (DoH, remote
  fetches where they remain, health checks) MUST carry timeout and size
  caps so one slow upstream cannot burn the budget.

### Key Entities

- **Daily usage**: today's request count (resets at the day boundary) plus
  the running total; the admin's only budget instrument.
- **Refresh interval**: the admin-configured hours between client
  subscription updates; advertised to clients, not enforced on them.
- **Node cap**: the admin-configured maximum nodes per subscription
  output; the bound on response size.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Admin reads today's count and running total from the panel in
  under 30 seconds, accurate against internal counters.
- **SC-002**: Repeat subscription fetches inside the cache window do not
  increase the origin request count.
- **SC-003**: Every subscription response advertises the admin's interval;
  changing the interval changes what clients receive.
- **SC-004**: With endpoints exceeding the cap, every output carries
  exactly the capped node count, deterministically.
- **SC-005**: Kill-switch on refuses new proxied connections within
  seconds while the panel stays usable.
- **SC-006**: A single deployment serving one admin's devices stays
  comfortably inside ~100k requests/day under normal use.

## Assumptions

- Specs 001–003 are implemented first; this spec governs the trimmed
  surface, not the deleted one.
- The ~100k/day figure is the Cloudflare free-tier requests limit as
  understood by the operator; the system reports usage, it does not
  enforce provider-side billing behavior.
- Day boundaries follow the platform's usual UTC day convention for
  counters.
- WARP WireGuard data-plane traffic never reaches the worker, so only
  config-file downloads count toward the budget.
- No automatic throttling or auto-kill at budget approach — visibility
  plus the manual kill-switch is the whole mechanism, per the operator's
  explicit choice.
