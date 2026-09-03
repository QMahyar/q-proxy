---
id: 05
title: Make settings a single source of truth and fix test/lint debt
type: task
status: open
branch: chore/architecture
blocked_by: []
---

# Make settings a single source of truth and fix test/lint debt

## Question

Repay the architecture/test-maintainability debt: make settings fields a single source of truth, repair the test-mirror rule, and add the missing crypto known-answer spec + a lint step. Ground truth: `docs/ARCHITECTURE.md`, `docs/decisions/` (ADR-001..005), AGENTS.md conventions.

## Current findings (from the architecture review — implement these)

1. **[Priority] Settings are NOT a single source of truth.** The five-place hand-sync — `Settings` interface + `DEFAULT_SETTINGS` (`src/types/settings.ts`), `src/settings/validate.ts` (helpers `boolField/intField/strField/strArrayField`), the `panel.html` field registry + en/fa dictionaries (`src/ui/panel.html`), plus the seed/migrate — has already drifted: the "72 leaf fields" count is phantom, `sourceUrls` is bound outside the `FL()` registry, and frozen §2.2 is a major version stale. This is the **highest-payoff structural change**.
   - Fix: introduce a single descriptor table consumed by `validate.ts`, and add a **drift test** that parses `DEFAULT_SETTINGS`, the `panel.html` field registry, and the descriptor table and fails on any divergence. Keep the `{ok:true,value}|{ok:false,fields}` result convention.
2. **Test-mirror rule is broken 3×** (rule: `test/` mirrors `src/`):
   - `test/protocols/bounded.spec.ts` tests `src/utils/bounded.ts` → move/rename to `test/utils/bounded.spec.ts`.
   - `src/warp/expand.ts` has no `test/warp/expand.spec.ts` (only covered inside `test/warp/formats.spec.ts`).
   - `test/handlers/telegram.spec.ts` tests `src/handlers/api/telegram.ts` → should be `test/handlers/api/telegram.spec.ts`.
3. **`src/utils/hmac.ts` has no spec** — `hmacSha256Hex` backs session cookies (`auth/session.ts:3`) and the Telegram webhook secret (`handlers/api/telegram.ts:7`). Write `test/utils/hmac.spec.ts` using RFC 4231 known-answer vectors.
4. **No linter at all.** `package.json` has typecheck + tests but no `lint`. Add a minimal lint (eslint) with a rule set that will not block the zero-dep/single-file constraint, and wire it into `npm run typecheck`-adjacent or as `npm run lint` documented in AGENTS.md.

## Constraints

- Do NOT rename exported types that are frozen in `docs/ARCHITECTURE.md` (would need an architecture revision) — the settings refactor is internal.
- Do not add a runtime dep; a dev-only lint tool is acceptable (devDependencies only).
- Do not change settings behavior/semantics — only centralize the field definitions and add the drift test.

## Verify

`npm run typecheck` then `npx vitest run --project unit`. The new drift test must fail before the refactor and pass after. Confirm the mirrored spec names resolve.
