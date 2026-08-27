# ADR-003: Stateless HMAC sessions with iat revocation floor

## Status
Accepted

## Date
2026-08-26

## Context
The panel (`/{sp}/panel`, `/{sp}/api/*`) needs authentication for a single admin, without a session table. Requirements:
- No KV write on every login or API call (quota)
- Survive isolate restarts (no in-memory session map)
- Allow "change password signs out all other devices" and instant revoke on demand
- CSRF protection for mutating APIs
- 7-day expiry, `HttpOnly; Secure; SameSite=Lax`

## Decision
Issue stateless cookies `q_session=<b64url(payload)>.<hex-hmac-sha256(payload, sessionSecret)>` with payload `{"exp": epochSeconds, "iat"?: epochSeconds}` (`src/auth/session.ts`). `verifySession(cookie, secret, minIat)` rejects if `iat < minIat` (missing `iat` ⇒ 0 for backwards compat). Revocation floor lives in KV `qproxy:min-iat` with a 60s isolate memo (`getSessionFloor`/`bumpSessionFloor`/`clearSessionFloorCache`). Enforcement is at the router layer via `withSessionFloor` composed into every `requireAuth` path (`src/core/router.ts:73`). `POST /{sp}/api/auth/password` bumps the floor and issues a fresh cookie after a TOCTOU-safe `loadSettingsFresh`→`saveSettings` write. `POST /{sp}/api/auth/logout` requires only `X-Q-Panel: 1` CSRF header (no session). PBKDF2 tiers: 100k current, 15k legacy auto-upgraded on login (`src/auth/password.ts`). `src/auth/guard.ts` checks `X-Q-Panel: 1` on mutating APIs.

## Alternatives Considered

### KV session store (random token → KV record)
- Pros: Simple revoke by deleting KV key, no crypto
- Cons: KV write on login, KV read on every authenticated request, TTL management, quota burn
- Rejected: Violates KV-minimization from ADR-002; adds a hot KV read to `GET /api/bootstrap` and every subscription-adjacent admin call

### JWT with library (jsonwebtoken, jose)
- Pros: Standard, library handles edge cases
- Cons: Runtime dependency (breaks ADR-001), larger bundle, still needs revocation — JWT `jti` denylist is a KV read anyway
- Rejected: Zero-deps constraint and the revocation floor already solves "sign out everywhere" without a denylist

### Rotate sessionSecret to revoke
- Pros: No extra KV key
- Cons: Invalidates all secrets derived from it in one shot, complicates settings writes, not granular to "password change" vs "manual revoke"
- Rejected: Floor is cheaper and composable — `bumpSessionFloor` is a single `put` without touching `qproxy:settings`

## Consequences
- No KV read for session validation except the 60s-memoized `qproxy:min-iat` (zero on `minIat===0` path)
- Password change signs out other devices within one floor-propagation window (≤60s per isolate); current device stays signed in via fresh `iat`
- Legacy 15k PBKDF2 hashes are transparently re-hashed to 100k on successful login; failures log and never block login
- Adding a new authenticated route must go through `withSessionFloor(requireAuth(handler))` or it bypasses revocation
- `settings.language` vs `qp_lang` cookie split remains (Known Gap) — session language is not the source of truth

## References
- `src/auth/session.ts` — `SESSION_TTL_SECONDS`, `SESSION_COOKIE_NAME`, `issueSession`, `verifySession`, `getSessionFloor`/`bumpSessionFloor`
- `src/auth/password.ts` — PBKDF2 100k/15k, `verifyPassword` with auto-upgrade signal
- `src/auth/guard.ts` — CSRF header check
- `src/core/router.ts` — `withSessionFloor` wiring
- `src/handlers/api/auth.ts` — login/setup/password/logout flows
- `docs/ARCHITECTURE.md §3` rows 12–14c, Rev 2026-08-26 wave1 amendments
