# Tasks: WARP Output Consolidation

**Input**: Design documents from `/specs/003-warp-output-consolidation/`
**Prerequisites**: plan.md, spec.md (clarified 2026-09-17: toggle matrix, global toggle, camouflage refusal), research.md, data-model.md, contracts/
**Tests**: Constitution VII + repo convention require the full loop green (typecheck, unit + workers suites, UI walk). Test deletions/updates are embedded as tasks, not optional extras.

**Organization**: Grouped by user story. Deletion order follows research Decisions 1–7 (store → emitters → handler → panel → tests → docs) so drift guards fail fast on missed steps.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline + closed removal lists before touching code

- [X] T001 Verify clean tree and record baseline green via `npm run typecheck` and `npm test` from repo root
- [X] T002 Transcribe the closed lists from `specs/003-warp-output-consolidation/contracts/` (4 survivors, toggle matrix, 13 deleted names → camouflage) into the working checklist (no code change)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Global toggle in the store — everything (emitters, handler, panel) reads it

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Add `amneziaEnabled: boolean` (default `false`) to `WarpGlobalSettings` with store defaults and validation in `src/types/warp.ts` + `src/warp/store.ts`
- [X] T004 [P] Accept the toggle alongside values in the `amnezia` PUT endpoint and purge served WARP copies on flips via the existing helpers in `src/handlers/api/warp.ts`, with a test pinning the purge in `test/warp/api.spec.ts`
- [X] T005 Resolve the global toggle at render and ignore per-account `amnezia_overrides` in `src/warp/expand.ts`
- [X] T006 Update warp store/expand specs under `test/warp/` for the global toggle default, toggle resolution, and inert overrides

**Checkpoint**: `npm run typecheck` passes against the extended global settings; foundation ready — story work can begin

---

## Phase 3: User Story 1 - Admin serves the four WARP families (Priority: P1) · MVP

**Goal**: One account renders exactly four working outputs; deleted emitters are gone from code

**Independent Test**: Register one account → download all four outputs → each imports into its target app and connects; survivor list is exactly four (quickstart scenario 1)

- [X] T007 [US1] Trim `WARP_FORMATS`, `WARP_CONTENT_TYPES`, `WARP_EXTENSIONS`, and `WARP_EMITTERS` to the four survivors in `src/warp/formats/registry.ts`
- [X] T008 [P] [US1] Collapse conf emitters in `src/warp/formats/conf.ts` (wireguard-conf toggle branch, throne always-amnezia; keep `emitWireguardUri` as an internal helper for v2rayn, delete the `wireguard-uri` route rows)
- [X] T009 [P] [US1] Collapse `emitSingbox` to a single entry plus toggle branch and delete the legacy variant and xray branch in `src/warp/formats/singbox.ts`
- [X] T010 [P] [US1] Delete clash/surge/surfboard/loon/egern emitters in `src/warp/formats/proxies.ts` (delete the file if no shared helper remains)
- [X] T011 [P] [US1] Trim the panel WARP groups and detail renderers to the four families in `src/ui/panel/warp.js` (groups, labels, download rows)
- [X] T012 [P] [US1] Move goldens in `test/warp/formats-golden.spec.ts` + `test/warp/formats.spec.ts` (rename throne-amnezia golden to throne, verify plain goldens byte-identical, delete culled goldens)

**Checkpoint**: US1 independently testable — four families connect, thirteen names gone from code

---

## Phase 4: User Story 2 - Amnezia as a toggle, not formats (Priority: P2)

**Goal**: One global toggle moves Amnezia values in WG conf + sing-box; Throne always, v2rayn never; no per-account controls

**Independent Test**: Toggle off → download WG + sing-box (clean); toggle on → re-download, diff shows only Amnezia values; Throne unchanged by the flip; v2rayn never carries values; no amnezia-specific option anywhere (quickstart scenario 2)

- [X] T013 [P] [US2] Add toggle-ON goldens in `test/warp/` proving WG conf and sing-box bytes equal the retired `-amnezia` twin bytes for the same account
- [X] T014 [US2] Add the global Amnezia toggle plus EN+FA dict keys in `src/ui/panel/warp.js` and `src/ui/panel/dict.js` (toggle lives in the WARP section; flip purges served copies via the T004 server path)
- [X] T015 [US2] Remove the per-account Amnezia card and its save/reset handlers in `src/ui/panel/warp.js` + `src/ui/panel/actions.js`, ignore override writes in `src/handlers/api/warp.ts`, and mirror in `test/warp/expand.spec.ts` + `test/warp/api.spec.ts`

**Checkpoint**: US1 + US2 both work — four families render, one toggle moves values

---

## Phase 5: User Story 3 - Deleted formats look untouched (Priority: P2)

**Goal**: Every deleted format name serves camouflage identical to unknown URLs

**Independent Test**: Request each of the 13 deleted names plus one random unknown URL → all indistinguishable; panel shows no deleted names (quickstart scenario 3)

- [X] T016 [US3] Fall through to `handleCamouflage` for non-surviving formats in `src/handlers/warp-sub.ts` (replacing the distinct 404)
- [X] T017 [P] [US3] Cover camouflage-equivalence for every deleted name plus post-rotation freshness per family in `test/workers/` warp-sub/router specs
- [X] T018 [US3] Delete orphaned format dict keys, point deleted-view bookmarks at the home view (001 precedent), and update `scripts/ui-walk.mjs` WARP steps to the four-families-plus-toggle surface (keeping the step count)

**Checkpoint**: All three user stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs, full-loop green, success metrics

- [X] T019 Add dated Rev header to `docs/ARCHITECTURE.md` and update WARP output sections in `docs/USER_GUIDE.md` + `docs/DEVELOPER_GUIDE.md` (four families, toggle matrix, retired overrides, camouflage rule)
- [X] T020 Run the full verification loop from repo root (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:ui`) to green (`test:ui` needs live `wrangler dev` plus gitignored local creds per repo gotcha)
- [X] T021 Execute `specs/003-warp-output-consolidation/quickstart.md` scenarios 1–6 and record SC-001–SC-005 outcomes (17→4 count, toggle diff, camouflage matrix)
- [X] T022 Final audit grep for deleted format names (`wireguard-conf-amnezia`, `throne-amnezia`, `wireguard-uri` route, `singbox-legacy`, `xray`, `clash`, `surge`, `surfboard`, `loon`, `egern`, per-account override UI) across `src/`, `test/`, `src/ui/panel/`, `docs/` — zero hits or triage-approved exceptions only (internal `emitWireguardUri` helper and frozen history docs are approved)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all stories (store shape is the render contract)
- **Stories (Phases 3–5)**: Depend on Foundational; US1 (P1) before US2 (P1) before US3 (P2) in priority order; US2 needs US1's single-entry registry stable; US3 needs US1's survivor list stable
- **Polish (Phase 6)**: Depends on all stories complete

### Within Each Story

- Store/types before emitters before handler before panel before tests update; story checkpoint before next priority

### Parallel Opportunities

- T004 ∥ T003-follow-ups (different files: api PUT vs types/store)
- T008 ∥ T009 ∥ T010 (conf, singbox, proxies — different files; joint green at checkpoint)
- T011 ∥ T012 (panel warp.js vs warp specs — different files)
- T013 ∥ T014-sibling-files (warp specs vs panel+dict — note T014 touches actions.js too; keep dict.js edits inside T014 only)
- T017 ∥ T018 (workers specs vs walk script + dict)
- File-level rule: same file never in two parallel tasks (registry T007 before emitter deletions; warp.js T011 before T014/T015; api/warp.ts T004 before T015)

---

## Parallel Example: User Story 1

```bash
# Emitter leaves together (independent files, joint checkpoint) — T008, T009, T010:
Task: "Collapse conf emitters in src/warp/formats/conf.ts (toggle branch, throne always-amnezia)"
Task: "Collapse emitSingBox and delete legacy/xray in src/warp/formats/singbox.ts"
Task: "Delete culled emitters in src/warp/formats/proxies.ts"

# Panel + tests together — T011, T012:
Task: "Trim panel WARP groups to four families in src/ui/panel/warp.js"
Task: "Move WARP goldens in test/warp/formats-golden.spec.ts + formats.spec.ts"
```

---

## Implementation Strategy

### MVP First (Foundational + US1)

1. Phase 1 Setup + Phase 2 Foundational (global toggle in store, render resolution)
2. Phase 3 US1 (four families) → STOP, validate: all four connect
3. Deploy/demo only after US1 — a cut that serves the wrong set is not shippable

### Incremental Delivery

4. Phase 4 US2 (toggle) → diff proves values-only movement → demo
5. Phase 5 US3 (camouflage) → probe matrix identical → demo
6. Phase 6 Polish → docs Rev + guides + full loop + quickstart + SC counts

---

## Notes

- Every task names exact files; test paths mirror `src/` under `test/` per repo convention — confirm with a glob if a mirror name differs, do not invent new locations
- Never rename surviving top-level functions in `src/ui/panel/*.js` (concat contract); never hand-edit generated `src/ui/panel.html`
- Toggle-OFF bytes must stay byte-identical to pre-cut plain goldens; toggle-ON bytes must equal retired twin bytes — goldens prove both, never weaken them
- Commit after each task or logical group; stop at any checkpoint to validate the story independently
