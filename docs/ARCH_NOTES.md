# Architecture notes (T7 — notes only, no behavior change)

## Crypto decision (`src/crypto/*`)

- WebCrypto (Workers runtime) where the algorithm exists:
  `src/crypto/aesgcm.ts` (AES-GCM seal/open, cached `CryptoKey` imports),
  `src/crypto/kdf.ts` HKDF-SHA1 extract/expand via `crypto.subtle`,
  `src/utils/hmac.ts` + `src/auth/password.ts` (HMAC-SHA256, PBKDF2),
  `src/auth/guard.ts` (SHA-256 digest),
  `src/utils/random.ts` + `src/crypto/x25519.ts` + `src/warp/store.ts`
  (`getRandomValues` / `randomUUID` for keys, nonces, ids).
- Hand-rolled pure TS, pinned by `test/crypto/*` vectors:
  X25519 (`x25519.ts` — live: keypair/derive in `src/warp/api.ts`, `src/warp/config.ts`),
  AES-128 block (`aes.ts`), ChaCha20-Poly1305 (`chacha20.ts`),
  MD5 (`md5.ts`, incl. `evpBytesToKey` in `kdf.ts`),
  SHA-224 (`sha224.ts`), SHAKE128 (`shake128.ts`).
  Most have no live request-path callers today; they stay for vector/compat coverage.
- Interop constraint: Workers WebCrypto has no X25519 scalar-mult and no
  MD5/SHAKE128/legacy-KDF shapes, so replacing the hand-rolled files would change
  warp/config compat. Crypto replacement is explicitly out of scope
  (`SPEC_HARDENING.md`); rule for new code is WebCrypto wherever the algorithm
  exists, hand-rolled files stay vector-pinned.

## Counters loss window (`src/core/counters.ts`)

- D1-first (`counters` table, schema bootstrapped at runtime by `ensureD1Schema`
  in `src/settings/store.ts`), KV fallback under `qproxy:counters`.
- Deltas accumulate in an in-memory buffer; flush fires when
  `connectionsSinceFlush >= 32` or the buffer is `>= 60s` stale, single-flight
  via the `flushing` guard (`FLUSH_EVERY_CONNECTIONS`, `FLUSH_INTERVAL_MS`).
- `readUsage` returns stored + unflushed buffer; stored reads are memoized 15s
  per isolate (`USAGE_MEMO_MS`), refreshed on flush.
- Loss window: unflushed deltas and the 15s memo die with isolate eviction/crash.
  Write failures are logged (`log.error`) and callers fail open. Post-response
  flushes ride `ctx.waitUntil` (`afterResponse`); with `ctx == null` (unit tests)
  the write is skipped but deltas stay buffered until the next threshold.

## Settings cache rules (`src/settings/store.ts`)

- Per-isolate cache, 60s TTL (`CACHE_TTL_MS`); KV reads use `cacheTtl: 60`.
  `remember()` also stamps `loadedDebug` for log gating; `saveSettings` bumps
  `rev` and re-remembers. `settingsEtag`/`settingsRev` derive from the cache.
- `loadSettings`: cached fast path — hot request path (router) and plain reads.
- `loadSettingsFresh`: always reads KV, bypasses the isolate cache — auth
  login/logout/password/setup (`src/handlers/api/auth.ts`), settings
  save/import/reset (`src/handlers/api/settings.ts`), status/telegram mutation
  flows (`src/handlers/api/status.ts`, `src/handlers/api/telegram.ts`).
- Rule: use Fresh in auth/setup races and right after any write where a stale
  60s read would be wrong; use cached `loadSettings` on the hot path.

## Router bundle note

- Single entry `src/worker.ts` → `routeRequest` in `src/core/router.ts`;
  the router table is static imports, no code-split bundle. The only bundled
  artifact is the admin panel (`scripts/build-single-file.mjs` splices
  `src/ui/panel/*` into generated `src/ui/panel.html` — never hand-edit).
  This file is docs-only; no routing, emitter, or subscription output changed.
