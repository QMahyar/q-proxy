# Tasks: Preset + Custom Endpoints

**Input**: Design documents from `/specs/002-preset-custom-endpoints/`
**Prerequisites**: plan.md, spec.md (clarified 2026-09-17: replace-model, uniform variants, global WARP source, drop-no-migrate), research.md, data-model.md, contracts/
**Tests**: Constitution VII + repo convention require the full loop green (typecheck, unit + workers suites, UI walk). Test updates are embedded as tasks, not optional extras.

**Organization**: Grouped by user story. Schema-first order (settings → generate → panel → tests → docs) so drift guards fail fast on missed steps.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline + closed contracts before touching code

- [X] T001 Verify clean tree and record baseline green via `npm run typecheck` and `npm test` from repo root
- [X] T002 Transcribe the closed contracts from `specs/002-preset-custom-endpoints/contracts/` (cdn-presets, endpoint-validation, warp-endpoints) into the working checklist (no code change)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Settings schema + generation core — everything (panel, tests) compiles against it

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Cut `addresses`/`AddressSetting` and add `cdnPresets: string[]` (default `[]`, all presets ship opt-in so clean installs behave as today), `customEndpoints: string[]` (default `[]`), `warpPresets: string[]` (default `["default"]`, preserving current WARP behavior), `warpCustomEndpoints: string[]` (default `[]`) in `src/types/settings.ts` — version stays 3, no migration step
- [X] T004 [P] Remove `addresses` descriptor rows and add four descriptor rows for the new fields in `src/settings/fields.ts`
- [X] T005 [P] Remove `addresses` validation and add per-line custom-endpoint validation for BOTH paste boxes (`customEndpoints` and `warpCustomEndpoints`) in `src/settings/validate.ts` (unparsable lines reject; out-of-family ports reject, never converted; messages name every offending line by number + verbatim content; max 64 stored lines)
- [X] T006 Rebuild `collectAddresses` in `src/nodes/generate.ts` around enabled presets + parsed custom lines + hostname fallback (extract a shared source-resolution helper also used by `src/handlers/api/address-probe.ts`, which must probe the new sources instead of `s.addresses`); dedupe by lowercased `host:port`; remove `parseCountryFilter` and the `?country=` path
- [X] T007 Simplify `resolveHostname` in `src/core/routes.ts` to request-hostname fallback (drop the `addresses[]` list use)
- [X] T008 [P] Create shipped preset data `src/nodes/cdn-presets.ts` (`{id, label, ip, port}` entries per research Decision 4, all CF-family ports, data only with Principle-IV header comment)
- [X] T009 Render WARP from the global selection in `src/warp/expand.ts` (empty global selection resolves to the `default` preset; stored per-account `endpoint_list` ignored, not migrated)
- [X] T010 Update settings/store/API specs under `test/settings/` and `test/workers/` for the new schema and the drop-no-migrate rule

**Checkpoint**: `npm run typecheck` passes against the new schema; foundation ready — story work can begin

---

## Phase 3: User Story 1 - Admin picks CDN presets (Priority: P1) · MVP

**Goal**: Ticked presets flow into every VLESS output variant; nothing else appears as an address

**Independent Test**: Tick two presets on a clean deployment → base64 and sing-box outputs carry exactly those endpoints with valid ports (quickstart scenario 1)

- [X] T011 [P] [US1] Pin preset contract in `test/nodes/cdn-presets.spec.ts` (new file: stable ids; every port inside the CF families `tls ⇒ {443,2053,2083,2087,2096,8443}`, `plain ⇒ {80,8080,8880,2052,2082,2086,2095}`; data-only module)
- [X] T012 [P] [US1] Cover preset selection, preset+fragment variants (presets get fragment nodes like any TLS address — uniform-variant verdict), cross-source `host:port` dedupe, and hostname fallback in `test/nodes/generate.spec.ts`
- [X] T013 [US1] Add the preset checklist card with per-entry toggles plus EN+FA dict keys in `src/ui/panel/sections-registry.js`, `src/ui/panel/fields-render.js` (only if a new widget is needed), and `src/ui/panel/dict.js` (also delete orphaned `addresses.*`/country dict keys in both languages)
- [X] T014 [US1] Extend `scripts/ui-walk.mjs` with preset tick→save→both-outputs assertions, keeping the step count

**Checkpoint**: US1 independently testable — presets in, everything else out

---

## Phase 4: User Story 2 - Admin pastes custom endpoints (Priority: P1)

**Goal**: Valid pasted lines appear verbatim in configs; bad lines block save with named errors; nothing silently lost

**Independent Test**: Paste 5 valid + 2 invalid lines → rejection names both bad lines; after fix, exactly the 5 appear (quickstart scenario 2)

- [X] T015 [P] [US2] Cover per-line accept/reject, line-numbered messages, verbatim keeps, and the 64-line cap in `test/settings/validate.spec.ts`
- [X] T016 [US2] Add the custom textarea with per-line error display plus EN+FA dict keys in `src/ui/panel/sections-registry.js`, `src/ui/panel/fields-validate.js`, and `src/ui/panel/dict.js` (panel keeps the admin's text on rejection)
- [X] T017 [US2] Cover custom-line generation, formatting-variant dedupe, and pre-cut `addresses[]` data ignored in `test/nodes/generate.spec.ts`
- [X] T018 [US2] Extend `scripts/ui-walk.mjs` with custom-box mixed valid/invalid assertions, keeping the step count

**Checkpoint**: US1 + US2 both work — presets and paste box, uniform across variants

---

## Phase 5: User Story 3 - Admin sets WARP endpoints (Priority: P2)

**Goal**: One global WARP endpoint choice governs every account and all four output families with credentials intact

**Independent Test**: Set a custom global endpoint → WireGuard, sing-box, v2rayn, and Throne outputs all carry it; clear it → `default` preset, never empty (quickstart scenario 4)

- [X] T019 [P] [US3] Cover global selection, empty→default fallback, unknown-id tolerance, and per-account-list ignored in `test/warp/expand.spec.ts`
- [X] T020 [P] [US3] Retire per-account `endpoint_list` handling in `src/handlers/api/warp.ts` (update paths ignore it; stored values left inert) with mirror updates in `test/handlers/api/` warp specs
- [X] T021 [US3] Replace per-account endpoint UI with global WARP preset/custom cards plus EN+FA dict keys in `src/ui/panel/warp.js`, `src/ui/panel/sections-registry.js`, and `src/ui/panel/dict.js`
- [X] T022 [US3] Extend `scripts/ui-walk.mjs` with global WARP endpoint assertions across families, keeping the step count

**Checkpoint**: All three stories independently functional

---

## Phase 6: User Story 4 - Failover survives a blocked origin (Priority: P2)

**Goal**: Dead direct routes fail over through the pool with no admin action (verify-only — built and covered under 001)

**Independent Test**: Block the direct route → connection succeeds via pool; dead pool entries skipped (quickstart scenario 5, manual)

- [X] T023 [US4] Regression-proof failover with zero source changes: `test/tunnel/egress.spec.ts` ordering/shuffle/cap/dedupe/retry suites plus the workers bytes-spec 1011 case stay green; record pool behavior unchanged

**Checkpoint**: All four user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify-only sweeps, docs, full-loop green, success metrics

- [X] T024 Verify FR-007/FR-008 with zero source changes: single DoH box present, no NAT64/remote-DNS/url-test controls in either language, fragment/fingerprint/SNI suites green (`test/settings/`, `test/nodes/`, `test/ui/` drift guards)
- [X] T025 Add dated Rev header to `docs/ARCHITECTURE.md` and update endpoint sections in `docs/USER_GUIDE.md` + `docs/DEVELOPER_GUIDE.md` (preset/custom model, addresses[] removal, global WARP source, drop-no-migrate)
- [X] T026 Run the full verification loop from repo root (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:ui`) to green (`test:ui` needs live `wrangler dev` plus gitignored local creds per repo gotcha)
- [X] T027 Execute `specs/002-preset-custom-endpoints/quickstart.md` scenarios 1–7 and record SC-001–SC-005 outcomes
- [X] T028 Final audit grep for removed symbols (`addresses` settings field, `AddressSetting`, `?country=`, per-account `endpoint_list` handling, NAT64/remote-DNS/url-test remnants) across `src/`, `test/`, `src/ui/panel/`, `docs/` — zero hits or triage-approved exceptions only

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all stories (schema is the compile contract)
- **Stories (Phases 3–6)**: Depend on Foundational; US1 + US2 (both P1) before US3 + US4 (P2) in priority order; US2 needs US1's generation merge stable; US4 needs Foundational only
- **Polish (Phase 7)**: Depends on all stories complete

### Within Each Story

- Schema/types before handlers before panel before tests update (research Decision 1 pattern); story checkpoint before next priority

### Parallel Opportunities

- T004 ∥ T005 ∥ T008 (fields, validate, preset data — different files); T011 ∥ T012 (different test files); T015 ∥ T017-file-sections (validate spec vs generate spec); T019 ∥ T020 (expand spec vs warp handler spec); T023 ∥ T024 (verification-only, disjoint suites)
- File-level rule: same file never in two parallel tasks (T006→T017 sequence on generate.ts is intentional; T013→T016→T021 sequence on sections-registry.js/dict.js is intentional)

---

## Parallel Example: User Story 1

```bash
# Batch 1 (independent files) — T011, T012 together:
Task: "Pin preset contract in test/nodes/cdn-presets.spec.ts (stable ids, CF-family ports)"
Task: "Cover preset selection and fallback in test/nodes/generate.spec.ts"

# Batch 2 (panel, after Batch 1 review) — T013, then T014:
Task: "Add preset checklist card + dict keys in src/ui/panel/ (sections-registry, fields-render, dict)"
```

---

## Implementation Strategy

### MVP First (Foundational + US1 + US2)

1. Phase 1 Setup + Phase 2 Foundational (schema, validation, generation core, WARP global render)
2. Phase 3 US1 (presets) → STOP, validate: ticked presets in both outputs
3. Phase 4 US2 (custom paste) → STOP, validate: per-line errors, verbatim keeps
4. Deploy/demo only after US1 + US2 (both P1) — presets without the paste-box escape hatch (or vice versa) is not shippable

### Incremental Delivery

5. Phase 5 US3 (global WARP) → all families carry the choice → demo
6. Phase 6 US4 (failover proof, no code) → demo blocked-origin recovery
7. Phase 7 Polish → docs Rev + guides + full loop + quickstart + SC counts

---

## Notes

- Every task names exact files; test paths mirror `src/` under `test/` per repo convention — confirm with a glob if a mirror name differs, do not invent new locations
- Never rename surviving top-level functions in `src/ui/panel/*.js` (concat contract); never hand-edit generated `src/ui/panel.html`
- Settings version stays 3 — a bump would reclassify v3 backups as pre-cut (research Decision 2); unknown preset ids are ignored, never errors
- Commit after each task or logical group; stop at any checkpoint to validate the story independently
