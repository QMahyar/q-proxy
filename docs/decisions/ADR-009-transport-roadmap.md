# ADR-009: Transport roadmap (gRPC / XHTTP / REALITY-remote)

## Status
Accepted

## Date
2026-09-04

## Verdict
Sequence the deferred transport work by unblock dependency, not by desirability. No implementation work scheduled; this ADR is the re-entry checklist.

## Context
ADR-006 (gRPC: DEFER), ADR-007 (XHTTP: DEFER, nearest-term), and ADR-008 (REALITY-remote: DEFER, specified) all deferred, triggering this roadmap. The three have different unblock conditions — platform feature, edge-behavior probe, and product decision respectively — so they form a sequence, not a backlog pile.

## Decision
Work the transports in this order; each step's exit criterion gates the next build:

### Step 1 — XHTTP unblock probes (only scheduled work; research-only, no src changes)
1. Pin XHTTP wire semantics against the Xray-core `transport/internet/xhttp` source (modes, per-POST caps, framing, short-POST-only server interop). Output: fixture table.
2. Run the production-edge full-duplex probe from ADR-007 (chunked POST echo Worker on a real zone; TTFB vs body completion).
3. Exit: if short-POST interop is confirmed, XHTTP becomes the next BUILD (M, short-POST subset first); if clients require streaming and the edge buffers, XHTTP re-defers and this ADR is amended.

### Step 2 — REALITY-remote product decision (independent of Step 1, no platform dependency)
1. Decide: does Q Proxy advertise admin-owned external nodes in admin subscriptions (ADR-008 model)?
2. Exit: on approval, BUILD per the ADR-008 file list (S, 1–2 days). Exclusion from `users-sub` is non-negotiable (remoteSubUrls precedent). Private-key-never-in-KV must be a test assertion, not a convention.

### Step 3 — gRPC parked (no action until the platform moves)
1. Watch workerd releases for response trailers / h2-stream handler APIs only; no periodic re-probing beyond that.
2. Exit: platform support lands → BUILD per ADR-006 sketch (M + interop matrix).

### Explicit non-goals
- Never terminate REALITY on Workers (ADR-008: impossible by construction, not queued behind anything).
- No split-connection transports requiring cross-request rendezvous (no KV/DO session handoff — ADR-007).
- No header-only "gRPC" or grpc-web translation layers (interop-dead on arrival — ADR-006).
- No new runtime dependencies for any transport (ADR-001 boundary holds; all three spikes proved zero-dep sufficiency for the non-blocked parts).

## Alternatives Considered

### Build all three behind settings flags now
- Pros: Visible progress.
- Cons: gRPC and REALITY-termination cannot work regardless of flags; XHTTP streaming risks production-only deadlock. Flags would ship dead or dangerous code paths.
- Rejected.

### One combined transport epic
- Pros: Single tracking unit.
- Cons: The unblocks are independent (research probe vs product call vs platform release); bundling them stalls the decidable items behind the undecidable one.
- Rejected: Sequence, don't bundle.

## Consequences
- `scripts/make-tickets-*.sh` wave-5 transport tickets stay open but gated: XHTTP on Step 1 exit, REALITY-remote on Step 2 approval, gRPC on Step 3 platform signal.
- `docs/ARCHITECTURE.md` scope line ("No inbound gRPC/xhttp/REALITY") remains true until a Step exit flips one item to BUILD with an architecture revision.
- Re-entry point for any future agent: this ADR first, then the per-transport ADR — evidence and file lists are already pinned there.

## References
- ADR-006 (gRPC feasibility), ADR-007 (XHTTP feasibility), ADR-008 (REALITY-remote model)
- ADR-001 (zero runtime deps boundary), ADR-004 (pure emitters / parsers-never-throw — binding on any future transport code)
- `docs/research/04-protocol-formats.md` §3.4 (platform constraints shaping all three verdicts)
- `scripts/make-tickets.sh:62-64`, `scripts/make-tickets-2.sh:13-15` (existing wave-5 tickets this roadmap gates)
