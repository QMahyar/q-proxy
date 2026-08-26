# E1 — Bootstrap endpoint (coalesce boot to 1 request)
Type: task (AFK) · Phase: Efficiency · Blocks: E2, E3

## Question
Add `GET /api/bootstrap` returning `{settings, status, subUrls, etag}` in one response; rewrite panel boot to a single call. Update route table + `docs/ARCHITECTURE.md` §3 + `test/workers/router.spec.ts`.

## Answer

DONE — GET /api/bootstrap in src/handlers/api/bootstrap.ts returns {settings,status,subUrls} + ETag/304; routes.ts + router.ts dispatch (GET only, requireAuth); panel.html boot() uses single call; ARCHITECTURE.md §3 row 21 + Rev header; router.spec bootstrap test green.
