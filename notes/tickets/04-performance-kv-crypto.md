---
id: 04
title: Stop user-sub KV write amplification and hoist per-packet crypto
type: task
status: open
branch: perf/kv-crypto
blocked_by: []
---

# Stop user-sub KV write amplification and hoist per-packet crypto

## Question

Cut the two performance offenders: the user-subscription KV write amplification (which can exhaust the Free plan's 1000-writes/day quota) and the per-packet WebCrypto re-imports in the AEAD hot path.

## Current findings (from the performance review — implement these)

1. **[HIGH] `consumeUserHit` runs BEFORE the edge-cache check → 4-5 KV reads + 2 writes per user-sub poll, ALWAYS, even on cache hit.** `src/handlers/users-sub.ts:55` → `src/users/store.ts:240-254` (`readUsageCount` get, `put` #1 = day usage, `getUserTotalHits` get + `put` #2 = lifetime total). 50 users × 5-min polls ≈ 14.4k writes/day ≈ 14× the Free quota; after the cap, `put` throws and every user-sub request 500s. Also adds ~30-60 ms serial latency per hit.
   - Fixes, in ROI order:
     a. Check the edge cache BEFORE the quota increment and serve cache hits without a write (`users-sub.ts:61-63`).
     b. Batch the lifetime total (`user-total`) in-isolate like `src/core/counters.ts` (flush per 60 s / N hits) instead of a write per hit.
     c. Memoize the users array for ~15 s in-isolate (it is re-fetched on every hit today).
2. **[HIGH] `crypto.subtle.importKey` re-runs on EVERY AEAD length/payload frame, both directions.** `src/protocols/vmess-crypto.ts:50,66` and `src/protocols/shadowsocks.ts:252-254,274-276`. A 1 MB/s stream ≈ 60-120 imports/s/direction. Fix: import the session key once at session start (uplink subkey + downlink subkey) and store the `CryptoKey` in the codec closure.
3. **[HIGH] Pure-JS ChaCha20-Poly1305 uses BigInt per 16-byte block.** `src/crypto/chacha20.ts:86-99` (`poly1305`) — ~2-6 ms/MB, threatens the 30 s CPU budget on long chacha downloads. Fix options: prefer AES-GCM everywhere (VMess `auto` already maps to AES; SS method is AES-only in settings), OR reimplement Poly1305 with 32-bit limbs. At minimum, ensure chacha is not emitted/preferred when it's avoidable without changing wire formats.

## Constraints

- Do NOT change the metrics/counters semantics in a way that breaks existing tests (`counters.ts` batching pattern is the model to copy).
- Do not change wire formats; the quota/day key scheme (`qproxy:user-usage:<day>:<hash>`) stays.
- KV read-modify-write must remain tolerant: a race loses at most one increment.

## Verify

`npm run typecheck` then `npx vitest run --project unit` (users-sub, users/store, vmess/shadowsocks crypto specs). Add a test proving a cache-hit user-sub poll issues 0 KV writes, and that the codec session key is imported once (not per frame).
