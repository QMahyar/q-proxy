# ADR-005: Hand-rolled X25519 for WARP device registration

## Status
Accepted

## Date
2026-08-24

## Context
WARP integration (`src/warp/`) must register real Cloudflare WARP devices via `api.cloudflareclient.com` (`src/warp/api.ts`). Registration requires an X25519 keypair and the public key is sent to the WARP API. Requirements:
- Zero runtime deps (ADR-001) — no `noble-curves`, no `tweetnacl`
- Work in Workers isolates (WebCrypto `subtle` lacks X25519 in the compat date)
- Deterministic, testable against RFC 7748 vectors

## Decision
Implement X25519 in `src/crypto/x25519.ts` per RFC 7748, zero-dep. Used by `src/warp/api.ts` (retry/backoff, cleanup on failure) and `src/warp/store.ts` (two-key write with rollback, `sanitizeAccount` strips `private_key`/`warp_token`). Config parsers in `src/warp/config.ts` handle `.conf` and `wg://` URIs via `ParseResult`. Formats in `src/warp/formats/registry.ts` expose 17 output forms (conf, URI, Amnezia variants, Throne, Clash, sing-box, etc.). `src/crypto/x25519.ts` is proven by `test/crypto/x25519.spec.ts` against RFC 7748 vectors.

## Alternatives Considered

### `noble-curves` or `stablelib/x25519`
- Pros: Audited, less code to maintain
- Cons: Runtime dependency, bundle size, supply-chain surface, contradicts ADR-001
- Rejected: ADR-001 forbids runtime deps — WARP would be the only consumer but would still force a dep for every deploy

### WebCrypto `ECDH` with `X25519` named curve
- Pros: Native, no JS crypto
- Cons: Not available at `compatibility_date = "2026-08-01"` in Workers; `subtle.generateKey({name:"X25519"})` is not in the Workers `workers-types` at this compat
- Rejected: Would require bumping compat and relying on an API not yet in `workers-types`/`workerd` at the time of W1

### Delegate key generation to an external service
- Pros: No crypto in the Worker
- Cons: Privacy (private key leaves the Worker), extra round-trip, new infra to run
- Rejected: Private key must never leave the Worker (stored in `qproxy:warp:account:{id}` with rollback)

## Consequences
- Bundle stays ~400 KB with no crypto dependency; WARP registration works offline from the bundle
- Maintenance cost: `src/crypto/x25519.ts` must be kept correct — changes require re-running RFC 7748 vectors and `test/warp/api.spec.ts`/`store.spec.ts`
- Two-key write (`qproxy:warp:account:{id}` + `qproxy:warp:token:{token}`) with rollback on partial failure (`src/warp/store.ts`); `sanitizeAccount` is mandatory before returning to the panel
- Adding a WARP format touches only `src/warp/formats/registry.ts` maps + one emitter file (`CONTEXT.md` "Where to Add Things")

## References
- `src/crypto/x25519.ts` — RFC 7748 implementation
- `src/warp/api.ts`, `src/warp/store.ts`, `src/warp/config.ts`, `src/warp/formats/registry.ts`
- `test/crypto/x25519.spec.ts` — RFC 7748 vectors
- `docs/ARCHITECTURE.md` WARP core Rev 2026-08-24
