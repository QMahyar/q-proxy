# ADR-007: XHTTP feasibility

## Status
Accepted

## Date
2026-09-04

## Verdict
DEFER — nearest-term transport candidate, but blocked on two unproven items below. No implementation work scheduled.

## Context
XHTTP carries VLESS over plain HTTP (POST bodies up, response bodies down), which would give Q Proxy a non-WebSocket HTTP-native transport without leaving the fetch handler. Unlike gRPC it needs no trailers and unlike REALITY no raw TCP. The question is whether Xray's XHTTP modes fit the Workers request/response lifecycle with zero runtime dependencies.

## Evidence

### Protocol requirements (Xray-core; pin before any build)
XHTTP client settings center on `path`, `host`, `mode`, and `extra`, with server-side knobs for per-POST byte caps and streaming behavior. Two shapes matter:
- **Short POSTs (packet-up shape):** sequential bounded POSTs, each fully readable then answerable — a stateless fetch handler fits exactly.
- **Long-lived streaming (stream-up / stream-one shape):** the handler must emit response bytes *before* the request body completes — full-duplex on one HTTP exchange.
Mode names and server-knob semantics here are stated at survey depth; per repo protocol-change rule the Xray-core `transport/internet/xhttp` source is the binding reference and must be pinned before any implementation. No wire-format change to existing transports is implied either way.

### Platform capabilities (probed locally, edge unverified)
- `test/transport/xhttp-probe.spec.ts` (throwaway, 4 tests, all passing at spike time) proves the relay pattern needs only web streams: concurrent uplink/downlink pumping through one handler, downlink bytes emitted before uplink completion, streaming `Request` construction (`duplex: "half"`) plus streaming `Response`, and stateless short-POST mapping. Zero-dep holds.
- What unit/miniflare probes **cannot** prove is production-edge behavior: whether the Cloudflare edge forwards chunked request-body bytes to the isolate incrementally and lets the handler stream a response concurrently, or buffers the body first (which deadlocks streaming modes: client waits for download while edge waits for upload end). miniflare is not the edge. Long-lived exchanges also face Worker duration/CPU limits that short POSTs avoid.
- Cross-request session rendezvous (if a split up/down shape were chosen) has no reliable home: KV is eventually consistent with second-scale latency, Durable Objects are outside the one-KV-namespace architecture, and isolate memory is not shared across colos. Any build must therefore keep each exchange self-contained (short POSTs or single full-duplex POST), never split across connections.

### What was probed
- `test/transport/xhttp-probe.spec.ts`: full-duplex pump, early-downlink-before-uplink-end, streaming Request/Response construction, stateless packet-up mapping — 4/4 passing in Node. Specs deleted before commit; production-edge full-duplex remains the open question by construction.

## Decision
DEFER XHTTP until the unblock steps complete, then build the smallest interoperable subset first (short POSTs), not streaming modes.

## What would unblock
1. Pin wire semantics against the Xray-core xhttp source (modes, per-POST caps, framing header presence, client fallback when the server only supports short POSTs). One focused read-through; output is a fixture table, not code.
2. Production-edge full-duplex probe: deploy a minimal echo Worker on a real zone, POST chunked bodies from a non-browser client, and measure time-to-first-response-byte versus request-body completion. Binary outcome: streaming modes viable or dead on the edge.
3. If (2) fails, confirm major clients interoperate with a short-POST-only server before building; if they require streaming, XHTTP stays deferred.

## Implementation sketch (kept for the unblock day, no code written)
- `src/handlers/xhttp.ts`: POST reader into `ByteAccumulator`, reuse `ProtocolInbound` parsers + `openEgressWithSpeculativeDirect` + `createRelay`; streaming `Response` for stream modes, buffered JSON-free byte response for short POSTs.
- `src/core/routes.ts`: `xhttpPath` matcher + `SecureRoute` row; `src/core/router.ts` dispatch after kill-switch gate (invariant 6).
- `src/types/settings.ts` + `src/settings/fields.ts` + `validate.ts`: `xhttpPath`, `xhttpMode`, `xhttpMaxPostBytes` descriptors (paths validated like existing tunnel paths).
- `src/types/node.ts` (frozen — needs ARCHITECTURE revision): transport field (`ws` today, `xhttp` added); `src/nodes/generate.ts` port↔security pairing invariant applies unchanged; `share-uri.ts` emits `type=xhttp&path=&host=&mode=`; emitters add sing-box `transport: {type: "xhttp", ...}` and clash `xhttp-opts` (verify client-version support first); surge/loon skip matrix documented.
- `?target=`/UA negotiation in `src/subscription/negotiate.ts` already keys off node fields — no new format enum needed unless a client requires it.
- Effort if unblocked: M (short-POST subset, 2–4 days + interop matrix) to L (streaming modes, + edge-behavior hardening and duration-limit handling).

## Alternatives Considered

### Build streaming modes first (stream-one as the flagship)
- Pros: Lowest overhead, closest to Xray defaults.
- Cons: Depends on the single riskiest unknown (edge full-duplex); failure mode is silent deadlock, not an error.
- Rejected: Risk order is backwards — prove the edge, then choose modes.

### Split up/down across two requests with KV rendezvous
- Pros: Avoids full-duplex entirely.
- Cons: KV latency/consistency cannot do millisecond session handoff; violates the one-KV-namespace spirit; new failure modes under concurrent isolates.
- Rejected: Architecturally unsound for this repo.

## Consequences
- No route-table, settings-schema, or frozen-type changes; `docs/ARCHITECTURE.md` scope line ("No inbound gRPC/xhttp/REALITY") stays true.
- The XHTTP ticket in `scripts/make-tickets-*.sh` remains a future item gated on this ADR's unblock steps, not on effort availability.
- If violated (shipping streaming XHTTP on assumed edge behavior), the failure is production-only deadlock invisible to unit and miniflare tests.

## References
- `docs/research/04-protocol-formats.md` §3.2 (WS architecture — the pattern XHTTP would reuse), §3.4 (HTTP-only inbound constraint, which XHTTP satisfies)
- `src/handlers/tunnel.ts` (`initialPayload ?? rest` first-packet invariant — any XHTTP handler must preserve it), `src/tunnel/relay.ts`, `src/tunnel/egress.ts`
- `src/subscription/negotiate.ts`, `src/nodes/emitters/registry.ts` — extension points for a future transport
- Spike: `test/transport/xhttp-probe.spec.ts` (4/4 passing, deleted before commit)
- Roadmap: ADR-009 (XHTTP unblock probes are the first scheduled transport work)
