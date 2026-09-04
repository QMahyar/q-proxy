# ADR-006: gRPC inbound feasibility

## Status
Accepted

## Date
2026-09-04

## Verdict
DEFER — a Worker cannot terminate Xray-style gRPC inbound today. No implementation work scheduled.

## Context
VLESS/Trojan over gRPC (`type=grpc&serviceName=...&mode=gun|multi`) is a first-class Xray transport and appears in generated client configs across the ecosystem. `docs/research/04-protocol-formats.md` §1.1 documents the share-URI params (`serviceName`, `mode`) and §3.1 already asserts Workers cannot terminate standard h2/gRPC streams. Q Proxy terminates all inbounds over WebSocket (`src/handlers/tunnel.ts`, `src/tunnel/websocket.ts`). This spike tested whether gRPC could join that set with zero runtime dependencies.

## Evidence

### Protocol requirements (Xray-core behavior, first principles)
Native gRPC transport is HTTP/2 end to end: a single h2 stream carries length-prefixed messages (5-byte header: compression flag + big-endian length), bidirectional DATA frames, and — critically — call status travels in HTTP **trailers** (`grpc-status`, `grpc-message`). Xray `gun` mode maps one proxy session to one h2 stream; `multi` multiplexes further. Clients (Xray, sing-box) treat a missing or malformed `grpc-status` trailer as a failed call, so trailers are not optional.

### Platform capabilities (probed, not assumed)
- gRPC framing needs no dependencies: `test/transport/grpc-probe.spec.ts` (throwaway, 7 tests, all passing at spike time) implements the 5-byte codec inline with `ParseResult`-style outcomes — round-trip, pipelined messages with `rest`, truncated header/payload yielding need-more, and absurd declared lengths rejected without allocating. Framing is the easy 5%.
- The remaining 95% is platform surface the fetch handler does not expose: `Response` has no trailer API (`trailers` property and any `addTrailers`-style method are both absent — asserted in the probe), and the Worker never sees h2 streams, only Fetch-API `Request`/`Response` after the edge terminates TLS and HTTP/2. `content-type: application/grpc` headers are settable, but a `grpc-status` regular header is not a trailer and does not satisfy native clients.
- Cloudflare's documented gRPC support is origin-facing (proxying h2/gRPC toward origins with gRPC enabled), not Worker-terminated. There is no workerd API for sending trailers or managing h2 streams from a `fetch` handler.

### What was probed
- `test/transport/grpc-probe.spec.ts`: zero-dep frame codec (5 framing tests, pass) + platform surface (trailer API absent, grpc headers settable — pass). Specs deleted before commit per spike hygiene; results recorded here.

## Decision
DEFER gRPC inbound indefinitely. Do not add `serviceName`/`mode` handling, routes, or settings fields. Continue emitting `type=ws` for Worker nodes.

## What would unblock
1. workerd gains response-trailer support plus h2-stream passthrough to the `fetch` handler (watch the workerd changelog; re-probe yearly, not per release).
2. Alternatively, terminate gRPC on an external backend and reference it subscription-side — that is the ADR-008 remote-backend model, not this ADR.
3. grpc-web is explicitly out of scope: it fits HTTP/1.1 without trailers, but no Xray-family client speaks grpc-web for proxy transport, so interop fails on the client side instead.

## Implementation sketch (kept for the unblock day, no code written)
- `src/handlers/grpc.ts`: read framed POST/stream body via `ByteAccumulator`, reuse `ProtocolInbound` parsers, `openEgressWithSpeculativeDirect`, and `createRelay`; trailers-only final response once trailers exist.
- `src/core/routes.ts`: `identifyGrpc` matcher + `SecureRoute` row; `src/core/router.ts` dispatch after the kill-switch gate (invariant 6 holds for any new transport).
- `src/types/settings.ts` + `src/settings/fields.ts` + `validate.ts`: `grpcPath`, `grpcServiceName`, `grpcMode` descriptors.
- `src/types/node.ts` (frozen — needs ARCHITECTURE revision): transport field; `src/nodes/generate.ts`, `share-uri.ts` (`type=grpc&serviceName=&mode=`), emitters (`grpc-opts` in sing-box/clash, registry).
- Effort if unblocked: M (2–3 days implementation + client interop matrix against Xray-core fixtures per repo protocol-change rule).

## Alternatives Considered

### Fake gRPC over HTTP/1.1 chunked POST with grpc-status as a header
- Pros: Shippable today with streams only.
- Cons: Native Xray/sing-box clients reject trailer-less calls; only a custom client would interop — violates the wire-compatibility rule.
- Rejected.

### grpc-web translation layer
- Pros: Fits the fetch handler model.
- Cons: No ecosystem client speaks it for VLESS/Trojan; dead interop on arrival.
- Rejected.

## Consequences
- No route-table change, so `docs/ARCHITECTURE.md` §3 and `test/workers/router.spec.ts` stay untouched.
- Nodes keep `type=ws`; share-URI and emitter goldens are unaffected.
- If violated (shipping header-only "gRPC"), clients fail closed on missing trailers and golden tests would not catch it — interop breakage without a test signal.

## References
- `docs/research/04-protocol-formats.md` §1.1 (serviceName/mode params), §3.1 (gRPC targets origins), §3.4 (Workers accept HTTP(S)+WS only)
- `src/handlers/tunnel.ts`, `src/tunnel/websocket.ts` — current WS-only termination
- `src/tunnel/egress.ts` — reusable egress opener for any future transport
- Spike: `test/transport/grpc-probe.spec.ts` (7/7 passing, deleted before commit)
- Roadmap: ADR-009 (gRPC parked behind platform support)
