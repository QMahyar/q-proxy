# F4 — User center (in-depth)
Type: task (AFK) · Phase: Features · Order: 4

## Question
Complete multi-user: data model (per-user KV keys), token'd sub routes, quotas (daily req), expiry, enable/disable, per-user node/protocol filters, admin UI section, security (token entropy, revocation, no secret leakage). Nahan/Nova patterns as reference.

## Answer

DONE (2026-08-25): shipped per locked spec — 536/536 tests, typecheck + build clean.

1. **Store** `src/users/store.ts`: `qproxy:users` single-array CRUD (`listUsers/saveUsers/newUserToken/findUserByToken/sanitizeUser`), UUID-guarded token lookup, ≤50 cap enforced at API; usage key `qproxy:user-usage:{day}` via `dayKeyUtc` with `recordUserHit` (fire-and-forget RMW) + `getUserHits`.
2. **Admin API** `src/handlers/api/users.ts` (warp.ts dispatch pattern): GET list (`todayHits` attached), POST create, PUT partial (+`enabled`), DELETE, `{id}/regenerate-token`; session+CSRF on non-GET; 404 unknown id; validation errors as 422 field maps.
3. **Public sub** `/{sp}/sub/u/{token}/{target?}`: `user-sub` SecureRoute (bad uuid → null → camouflage); handler `src/handlers/users-sub.ts` reuses pickSubFormat/generateNodes/EMITTERS/subscriptionHeaders; protocol filter applied when not "all" (remote-sub merge skipped so filters hold); 410 disabled/expired, 429 + Retry-After(UTC-midnight) over quota; hit recorded via fire-and-forget; edge-cache 60s keyed token+format+mode; `?view=html` info page.
4. **UI**: Settings subtab "users" (table-driven special card): name / sub-URL copy+QR / status chip (active·expired·limited·disabled) / enable switch / edit·regen·delete; `m-user` modal (name, All+protocol checkboxes, daily limit, datetime-local expiry) with Esc+focus trap; EN/FA dicts.
5. **Security**: tokens are uuid-v4 credentials shown to admin only and never logged; disabled/expired/quota responses are no-store.

Tests: `test/users/store.spec.ts` (8) + router end-to-end block in `test/workers/router.spec.ts` (CRUD → public sub 200 base64 → view=html → 410×2 → camouflage×2 → 429+Retry-After → regen → delete → 404). Bundle budget raised 180→190 KB (panel grew to 187.9 KB, pre-approved).

Deviations from ticket wording: unknown-but-valid token returns camouflage fallthrough instead of 404 (implementation directive supersedes decision #5); no per-user node cap beyond global maxNodesPerFormat (spec's "per-user node cap" dropped in the locked implementation spec).
