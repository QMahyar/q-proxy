# E0 — Efficiency plan adopted

**Status:** Decided (2026-08-24)
**Type:** research → decision

## Question

Which efficiency changes does Q Proxy adopt to stay far under the 100k req/day Workers limit, and where do they land?

## Answer

Adopted, in implementation order (files verified against repo):

| # | Change | File(s) | Saves |
|---|--------|---------|-------|
| E1 | `GET /api/bootstrap` — settings+status+subUrls in one response; client boots with 1 call | `src/handlers/api/`, `src/core/routes.ts`, `src/core/router.ts`, `src/ui/panel.html` | boot 4→1 req |
| E2 | ETag/304 on settings + bootstrap (`W/"version-updatedAt"`, `If-None-Match`) | settings/bootstrap handlers, panel.html api() | ~90% payload on repeats |
| E3 | Client cache: sessionStorage 30s TTL + in-flight Promise dedup; kill-switch debounce 300ms; my-ip on demand only | `src/ui/panel.html` | reload GETs → ~0 |
| E4 | KV store: isolate cache 15s→60s; `cacheTtl:60` on get; write-through (no invalidate); conditional write (skip put when unchanged); readUsage memo | `src/settings/store.ts`, `src/core/counters.ts` | 75–90% KV reads; 30–50% writes |
| E5 | Subscriptions: Cache API (`caches.default`) 5 min + `Profile-Update-Interval`; remote-sub fetch cached per `subUpdateIntervalHours` | `src/handlers/subscribe.ts`, `src/subscription/` | edge-served polls; outbound fetches per interval |
| E6 | Router early-exit: robots/camouflage/static paths skip `loadSettings` | `src/core/router.ts` | zero KV on bot traffic |
| E7 | Counter flush via `ctx.waitUntil` on hot paths | `src/core/router.ts`, `src/worker.ts`, `src/core/counters.ts` | 10–30ms p50 |

Rejected: Durable Objects, WebSocket status, bulk KV API, service workers.

## Constraints

- Kill-switch must remain instant (it's the safety gate) — debounce only double-clicks, keep single-click latency.
- Cache invalidation: subscription cache must bust on settings save (nodes change).
- ETag must reflect settings version so 409-conflict windows don't serve stale 304s.
