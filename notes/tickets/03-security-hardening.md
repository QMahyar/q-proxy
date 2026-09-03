---
id: 03
title: Close the security trio and harden session posture
type: task
status: open
branch: fix/security-hardening
blocked_by: []
---

# Close the security trio and harden session posture

## Question

Close the three High findings from the security review and tighten the session/token posture the review surfaced. Everything below is already decided; implement, don't redesign.

## Current findings (from the security review — implement these)

1. **[HIGH] Camouflage `proxy` mode is an unauthenticated open-relay SSRF.** `src/handlers/camouflage.ts:13-17`: `isLocalOrPrivateTarget` only checks the admin-set base host; a protocol-relative path (`//attacker.example/x`) rebinds the host, and the guard never sees it. `fetch` uses default `redirect:"follow"` with no final-URL re-check.
   - Fix: after building `target`, reject unless `isLocalOrPrivateTarget(target.hostname) === false && target.origin === base.origin`; fetch with `redirect: "error"` plus an explicit loop that re-validates each hop (reuse the pattern at `src/subscription/merge.ts:69-73`).
2. **[HIGH] Shadowsocks salt-replay registry is poisoned pre-authentication.** `src/protocols/shadowsocks.ts:73-80` records the salt in `seenSalts` BEFORE any tag/decrypt check, so an unauthenticated flood of ~2048 cheap salts evicts a victim's entry and re-opens the replay window. (Contrast VMess, which records only after `checkAuthId` succeeds — `src/protocols/vmess.ts:175-183` with rollback at `:192/:198`.)
   - Fix: move `seenSalts.set(...)` to after the first successful `openFrame` (`shadowsocks.ts:92-96`), with rollback of the salt entry on the failure paths. Keep the prune/limit behavior (`src/utils/bounded.ts`).
3. **[MED] Per-user subscription tokens stored plaintext in KV and echoed by the users-list API, defeating the `tokenHash` design.** `src/handlers/api/users.ts:120` (persisted via `saveUsers` at `:152`); `src/users/store.ts:9` (`token?: string`), `store.ts:170` (`sanitizeUser` returns `token ?? ""`); served at `users.ts:131-144`.
   - Fix: persist only `tokenHash` + a `tokenHint`; return the plaintext once at create/regenerate (already done at `users.ts:153`/`:196`) and omit it from list/put responses. Ensure the token lookup still works via `constantTimeEqual` on the hash (`store.ts:158-163`).

Also harden (cheap, decided):
- Optionally tighten the session/cookie posture: review whether the 7-day admin cookie (`src/auth/session.ts:7`) should be shorter and whether `SameSite=Strict` is appropriate (panel is same-site only; CSRF already uses the custom `X-Q-Panel` header at `src/auth/guard.ts`). Do not regress login/revocation.
- Confirm the login throttle is not trivially dilutable; if trivial to fix in `src/auth/guard.ts:52-80` (e.g. cap the failure scan honestly), do it — otherwise leave a resolution note.

## Constraints

- `passwordHash`/`passwordSalt`/`sessionSecret`/`botToken` must NEVER appear in responses, logs, or HTML (AGENTS.md).
- Do not change the wire formats or share-URI/emitter output.
- Token hashing must keep `constantTimeEqual` and the existing expiry/disable behavior.

## Verify

`npm run typecheck` then `npx vitest run --project unit` (users/camouflage/ss specs). Add tests: protocol-relative-path SSRF rejected from camouflage; salt recorded only after a valid SS handshake; user list no longer returns plaintext tokens.
