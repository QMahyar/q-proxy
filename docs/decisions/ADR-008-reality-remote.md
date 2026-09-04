# ADR-008: REALITY remote-backend model

## Status
Accepted

## Date
2026-09-04

## Verdict
DEFER — REALITY termination on Workers is impossible by construction (confirmed). The subscription-side remote-backend model below is fully specified and small, but parked pending a product decision. No implementation work scheduled.

## Context
REALITY (`security=reality`, `type=tcp`, `flow=xtls-rprx-vision`) would give users a non-Cloudflare-fingerprinted profile, but it must terminate where the TLS handshake can be controlled. Q Proxy runs behind the Cloudflare edge. This spike confirms termination is out and defines the only viable shape: reference external REALITY backends (admin's own VPS Xray nodes) in subscriptions without the Worker ever touching handshakes or private keys.

## Evidence

### Termination is impossible by construction, not by effort
REALITY requires, per connection: raw TCP inbound, the server's long-term X25519 private key, and byte-level control of the TLS handshake (session-id/key-share steganography against a camouflage SNI's real certificate). The Workers platform denies all three:
- No inbound TCP sockets exist. The sole `cloudflare:*` socket usage in the repo is egress `connect` (`src/tunnel/chain/index.ts:67`); static search confirms no listen-like API is imported or available to the `fetch` handler.
- The edge terminates TLS with Cloudflare's certificates before the Worker runs; the handler never sees ClientHello bytes and cannot present or steal another site's handshake.
- `test/transport/reality-probe.spec.ts` (throwaway, 4 tests, all passing at spike time) documents the boundary from the inside: `cloudflare:sockets` is unimportable outside workerd (egress-only module), while everything the *subscription* side needs is already dependency-free.
This is permanent. No platform changelog re-probe is needed — unlike ADR-006/007, there is no future runtime feature that grants raw inbound TCP behind the edge.

### Subscription-side needs are trivially satisfiable (probed)
- The de-facto share-URI grammar (`security=reality&pbk=&sid=&sni=&fp=`, `type=tcp&flow=xtls-rprx-vision&spx=%2F`, 3x-ui-compatible per `docs/research/04-protocol-formats.md` §1.1) assembles with URL encoding only — asserted byte-exact in the probe.
- The server public key decodes to 32 bytes with the repo's existing `src/utils/base64.ts` (`decodeBase64Url`); the hand-rolled X25519 in `src/crypto/x25519.ts` is not even needed since the Worker never performs the handshake — it only stores and emits the admin-provided public key.
- `sid` validation is the sing-box rule (hex, ≤8 chars, empty allowed) — asserted in the probe.

## Decision
Never terminate REALITY in this codebase. The remote-reference model is specified below and deferred as a product decision, not a technical unknown.

## Remote-backend model (specified, not implemented)
Admin registers their own external REALITY nodes in settings; the Worker emits them into admin-scope subscriptions only. The Worker never dials, proxies, or holds keys for these nodes — it is a subscription renderer for them, same as it already is for Worker nodes.

### Minimal file list
- `src/types/node.ts` (frozen — needs ARCHITECTURE revision): extend `VlessNode` with transport/security variants or add a `RemoteRealityNode` carrying `address`, `port`, `uuid`, `sni`, `pbk`, `sid`, `flow`, `spx`, `fp`. No private-key field may exist — enforce by type (there is nowhere to put one).
- `src/types/settings.ts` + `src/settings/fields.ts` + `src/settings/validate.ts`: `remoteNodes[]` descriptor (bounded count, UUID/pbk/sid format checks, SSRF host-literal guard reused from existing validators, invariant 10 compliant: admin-owned addresses like `customDomains`).
- `src/nodes/share-uri.ts`: `buildVlessRealityUri` per the probed grammar (existing `tlsParams`/`transportParams` helpers stay WS-only; reality needs its own param builder — `type=tcp`, no `host`/`path`/`ed`).
- `src/nodes/emitters/singbox-json.ts`: `reality: {enabled, public_key, short_id}` + `flow: xtls-rprx-vision` + TCP transport (drop `ws` block); `src/nodes/emitters/clash-yaml.ts`: `reality-opts` + `flow` (`network: tcp`); surge/loon: document skip matrix (no reality support → omit node, never emit a broken profile).
- `src/handlers/subscribe.ts` (+ `src/subscription/*` merge path): include remote nodes in admin subscription; **exclude from `users-sub`** following the `remoteSubUrls` precedent (per-user scoping: protocol filters must hold; CONTEXT.md documents the intentional non-merge).
- `src/ui/panel.html`: remote-node section in field registry + en/fa dictionaries; validation messages stay English-only per known-gap policy.
- Tests: golden share-URI + emitter goldens per repo wire-format rule (ask-before-change applies once shipped), `test/settings/validate.spec.ts` cases, address-composition test extension in `test/nodes/generate.spec.ts` (invariant 10 must keep passing: no hard-coded hosts).
- Effort: S (1–2 days; pure functions + settings plumbing, no protocol code, no relay changes).

## Alternatives Considered

### Terminate REALITY on the Worker
- Pros: None achievable.
- Cons: Requires inbound TCP + private-key handshake control the platform denies; would also break the zero-deps/single-file story with a TLS-stack fork.
- Rejected: Impossible, permanently.

### Reverse-proxy or port-forward to the REALITY backend through the Worker
- Pros: Keeps one hostname.
- Cons: Egress `connect()` speaks raw TCP but the inbound leg is still edge-terminated TLS/WS — the REALITY handshake bytes cannot pass through; result is not REALITY and clients fail.
- Rejected: Misunderstands where the handshake happens.

### Do nothing ever (no remote references either)
- Pros: Smallest surface; no third-party-node trust questions.
- Cons: Users run VPS REALITY nodes alongside Q Proxy with no unified subscription.
- Parked as the live alternative: this ADR's deferral keeps it available pending the product call.

## Consequences
- `docs/ARCHITECTURE.md` scope line stays true; no route-table change (remote nodes add no inbound path), so §3 and `test/workers/router.spec.ts` are untouched.
- Trust boundary shifts and must stay explicit: emitted nodes point at infrastructure the Worker does not operate or monitor; the panel must label them as external, and no health/status endpoint may claim otherwise.
- The REALITY private key must never appear in settings, KV, exports, or logs — only the public `pbk`. Any future implementation PR must assert this in tests (settings-export scrub + log scrub).
- If violated (attempting termination), the outcome is not degraded service but complete non-function: handshake bytes are unreachable behind the edge.

## References
- `docs/research/04-protocol-formats.md` §1.1 (reality URI grammar, 3x-ui corroboration), §2.2/§2.3 (reality-opts / reality object schemas), §3.4 (no inbound TCP)
- `src/tunnel/chain/index.ts:67` — sole `cloudflare:sockets` usage is egress `connect`
- `src/utils/base64.ts`, `src/crypto/x25519.ts` — existing zero-dep primitives covering the subscription-side needs
- `src/subscription/merge.ts`, `src/handlers/subscribe.ts` — where remote nodes would merge; `src/users/store.ts` — scoping precedent for exclusion
- Spike: `test/transport/reality-probe.spec.ts` (4/4 passing, deleted before commit)
- Roadmap: ADR-009 (remote-reference queued behind product approval, independent of platform work)
