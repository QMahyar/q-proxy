# ADR-004: Pure emitters and parsers-never-throw contract

## Status
Accepted

## Date
2026-08-24

## Context
Subscriptions (5 Worker formats + 17 WARP formats) and tunnel handshakes are the highest-risk surfaces: wire-format drift breaks clients, and handshake bugs become WS close-code leaks. Requirements:
- Emitters must be testable without `workerd` or KV (fast unit tests)
- Protocol parsers must handle split TCP chunks (need-more) and reject cleanly without leaking reasons
- Adding a format must not touch egress or auth

## Decision
Emitters are pure functions `(nodes: readonly ProxyNode[], opts: EmitOptions) => string` — no `fetch`, no KV, no `cloudflare:*` (`docs/ARCHITECTURE.md §2.5`, `src/nodes/emitters/registry.ts`). `EmitOptions` carries `remoteDns`, `urlTestIntervalSec`, `isFragment`, `subscriptionUrl`, `updateIntervalHours`, `rules?: EmitRules` — handlers build it, emitters consume it. Subscription rendering is centralized in `src/subscription/render.ts` (`selectVariantNodes`, `emitterOptions`, `renderSubscriptionBody`, `makeEdgeCacheKey`/`matchEdgeCache`, `SUB_CONTENT_TYPES`) consumed by both `src/handlers/subscribe.ts` and `src/handlers/users-sub.ts`.

Protocol inbounds implement `ProtocolInbound<R>` (`src/protocols/common.ts`) with `push(data) => Promise<PushOutcome<R>>` (`need-more` | `ready {parsed, rest}` | `reject {reason}`), `responseHeader()` once, `takeInitialPayload()`. All parsers return `ParseResult<T> = {ok:true,value} | {ok:false,reason}` or `PushOutcome` — they never throw. `src/core/errors.ts` `AppError` subclasses are thrown only at the HTTP handler layer and mapped to WS close codes (1008 reject, 1011 infra) or the JSON envelope.

## Alternatives Considered

### Throwing parsers with try/catch at the tunnel handler
- Pros: Shorter parser code
- Cons: Hidden control flow, risk of leaking `reason` to clients, harder to test split-chunk `need-more` paths, violates `AGENTS.md` "Parsers never throw"
- Rejected: Explicit `reject` keeps error handling visible and lets the relay log server-side only

### Impure emitters that fetch remote subs or read KV
- Pros: Emitter could hide merge logic
- Cons: Unit tests would need `fetch` mocking and workerd; emitter output would depend on network/KV cache timing
- Rejected: `subscription/merge.ts` (`fetchRemoteSubLines`) stays in the handler layer; base64 format merges after `buildShareUris` (`src/nodes/share-uri.ts`) — other formats are never merged by design (`DEVELOPER_GUIDE.md §4.3`)

### Single `FORMATS` table in a handler
- Pros: One place to list formats
- Cons: `subscribe.ts` and `users-sub.ts` drift (users-sub intentionally never merges remote subs so protocol filters hold)
- Rejected: Single source `SUB_FORMATS` in `src/subscription/negotiate.ts` with priority `?target=` > UA > base64 (`src/core/ua.ts` `classifyUA`)

## Consequences
- `test/nodes/emitters/*.spec.ts` are golden snapshots that break on purpose when wire formats change — owner sign-off required (`AGENTS.md` Boundaries)
- New emitter: extend `SubFormat` in `src/core/ua.ts`, create `src/nodes/emitters/<name>.ts`, register in `registry.ts`, add to `SUB_FORMATS` in `negotiate.ts`, add UA case and golden test (`CONTEXT.md` "Where to Add Things")
- New WARP format: `src/warp/formats/registry.ts` `WARP_FORMATS`/`WARP_EMITTERS`/type/extension maps
- `src/utils/html.ts` `escapeHtml` is the single HTML-escaping helper (was copy-pasted in `subscribe.ts`/`myip.ts` pre-ADR)
- Violating purity (adding `fetch`/`caches` to an emitter) would force that emitter into the `workers` project and break `unit` isolation

## References
- `src/protocols/common.ts` — `ProtocolInbound`, `PushOutcome`, `ParseResult`
- `src/nodes/emitters/registry.ts`, `src/nodes/emitters/*.ts` — emitter contracts
- `src/subscription/negotiate.ts`, `src/subscription/render.ts`, `src/core/ua.ts`
- `src/handlers/subscribe.ts`, `src/handlers/users-sub.ts`
- `docs/ARCHITECTURE.md §2.5`, `§2.7`, `§3` rows 7/7c
- `AGENTS.md` Conventions — "Parsers never throw", "Emitters are pure"
