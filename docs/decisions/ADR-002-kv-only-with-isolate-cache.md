# ADR-002: KV-only persistence with 60s isolate cache and stale-write window

## Status
Accepted

## Date
2026-08-24

## Context
Q Proxy needs persistence for settings (`qproxy:settings`), counters (`qproxy:counters`), per-user directory (`qproxy:users`, ≤50), WARP state (`qproxy:warp:*`), and a session revocation floor (`qproxy:min-iat`). Requirements:
- Single KV namespace binding `QPROXY_KV` (`src/types/env.ts`, `wrangler.toml`)
- Stay far under 100k req/day free-tier budget — subscriptions and boot must not pay a KV read per request
- No D1/DO operational overhead for a single-admin product
- `wrangler dev` must work with in-memory miniflare KV (no external service locally)

## Decision
Use one KV namespace only. Implement a 60s per-isolate cache in `src/settings/store.ts` (`loadSettings` memo + `saveSettings` write-through + `loadSettingsFresh` bypass). `getSessionFloor` memoizes `qproxy:min-iat` 60s; `readUsage` memoizes counters 15s (`src/core/counters.ts`). Writes skip no-op puts. `GET /robots.txt` and `OPTIONS` on `/api/*` skip `loadSettings` entirely (`src/core/router.ts` early exit). Mutating handlers that need TOCTOU safety re-read via `loadSettingsFresh` before write (`src/handlers/api/auth.ts:setup`, `src/handlers/api/settings.ts:save`).

## Alternatives Considered

### Cloudflare D1 (SQLite) or Durable Objects
- Pros: Strong consistency, transactions, SQL queries for users/usage
- Cons: New binding, migration, local dev needs D1/DO support, cost, two persistence systems to reason about
- Rejected: Durable Objects / WebSocket-status explicitly rejected during the efficiency plan — KV-only keeps the single-file story and miniflare requires no extra setup

### No cache / cacheTtl:0 on every read
- Pros: Strongest consistency
- Cons: Every subscription fetch and panel boot pays a KV read; counters flush every request — burns quota and adds latency
- Rejected: E4 in the efficiency plan measures 75–90% KV reads saved by the 60s cache

### Workers KV `cacheTtl` only (no isolate memo)
- Pros: Simpler
- Cons: Still pays isolate→KV hop on every request within the same isolate; misses the 15s `readUsage` memo on hot paths
- Rejected: Isolate memo is cheaper than KV `cacheTtl` and is invalidated on `saveSettings`

## Consequences
- Typical request ≤1 KV read; boot coalesced to `GET /api/bootstrap` (`src/handlers/api/bootstrap.ts`) with ETag/304 further cuts reads
- Eventual-consistency window documented as Known Gap: `handleKillSwitch`/`handleSaveSettings` merge from 60s cached settings — concurrent edits in another isolate can be reverted within TTL (`AGENTS.md` Known Gaps, last bullet)
- TOCTOU-sensitive writes must use `loadSettingsFresh`; adding a new mutating handler without it reintroduces the race
- Adding a second persistence system requires an architecture revision (`docs/ARCHITECTURE.md §5` KV schema is frozen) and updates to `CONTEXT.md` Gotchas

## References
- `src/settings/store.ts` — cache + `loadSettingsFresh`/`saveSettings`
- `src/core/counters.ts` — buffered counters + 15s memo
- `src/core/router.ts` — early-exit for `robots.txt`/`OPTIONS`
- `docs/ARCHITECTURE.md §5` — KV schema frozen
- Efficiency plan decision E4 — KV optimizations with 60s cache (superseded by this ADR)
