# Tasks: VLESS + WARP Slim-Down

**Input**: Design documents from `/specs/001-vless-warp-slimdown/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: Constitution VII + repo convention require the full loop green (typecheck, unit + workers suites, UI walk). Test deletions/updates are embedded as tasks, not optional extras.

**Organization**: Grouped by user story. Deletion order follows research Decision 1 (schema → panel → routes → emitters → tests → docs).

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline + closed removal list before touching code

- [X] T001 Verify clean tree and record baseline green via `npm run typecheck` and `npm test` from repo root
- [X] T002 Transcribe the closed removal list from `specs/001-vless-warp-slimdown/contracts/` into the working checklist (no code change)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Settings schema cut — everything (panel, routes, tests) compiles against it

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Cut `Settings` type + `DEFAULT_SETTINGS` in `src/types/settings.ts` per `data-model.md` (remove all listed families, bump version 2 → 3)
- [X] T004 [P] Remove descriptor rows and validation branches for deleted fields in `src/settings/fields.ts` and `src/settings/validate.ts`
- [X] T005 [P] Update first-run seeding and migration in `src/settings/seed.ts` and `src/settings/migrate.ts` (v3 stamp, no removed defaults)
- [X] T006 Reject pre-cut imports whole in `src/handlers/api/settings.ts` (backup version < 3 → clear incompatibility message, apply nothing — contracts/settings-schema.md rules 1–2)
- [X] T007 Purge pre-cut user data on boot in `src/settings/store.ts` (idempotent, one log note, stamp v3) plus D1 migration in `migrations/` dropping per-user tables, counters/audit retained
- [X] T008 Update settings/store/API specs under `test/settings/` and `test/workers/` for the cut schema, reject rule, and purge

**Checkpoint**: `npm run typecheck` passes against the v3 schema; foundation ready — story work can begin

---

## Phase 3: User Story 1 - Admin serves VLESS + WARP after the cut (Priority: P1) · MVP

**Goal**: Worker terminates VLESS-over-WS and serves WARP exactly as before; no output references removed protocols/formats

**Independent Test**: Clean setup → fetch each subscription link → import base64 into v2rayNG and sing-box output into sing-box client → both connect; zero removed names anywhere (quickstart scenarios 1, 3, 8)

- [X] T009 [P] [US1] Delete `src/protocols/vmess.ts`, `src/protocols/vmess-crypto.ts`, `src/protocols/trojan.ts`, `src/protocols/shadowsocks.ts`; prune `src/protocols/common.ts` to the VLESS seam (parsers-never-throw preserved)
- [X] T010 [P] [US1] Delete `src/nodes/emitters/clash-yaml.ts`, `src/nodes/emitters/surge-conf.ts`, `src/nodes/emitters/loon-conf.ts`, `src/nodes/emitters/quantumult-conf.ts` (and `src/nodes/emitters/yaml-writer.ts` if no survivor imports it); trim `src/nodes/emitters/registry.ts` to base64-render + sing-box
- [X] T011 [US1] Cut `src/types/node.ts` to the VLESS node kind and make `src/nodes/generate.ts` + `src/nodes/share-uri.ts` VLESS-only (port↔security + fragment⇒TLS∧¬CDN invariants intact)
- [X] T012 [US1] Trim `src/core/ua.ts` (`SubFormat` → base64|singbox) and `src/subscription/negotiate.ts` + render/headers; delete `src/subscription/merge.ts` (contracts/subscription-targets.md)
- [X] T013 [US1] Shrink tunnel matchers and dispatch table in `src/core/routes.ts` + `src/core/router.ts` (VLESS path only; kill-switch-before-upgrade order kept)
- [X] T014 [US1] Trim `src/handlers/tunnel.ts` to the VLESS inbound (first-packet-consumed-once invariant kept)
- [X] T015 [P] [US1] Delete pruned-protocol parser specs and deleted-emitter goldens under `test/protocols/` + `test/nodes/`; update UA/negotiate/generate specs under `test/core/` + `test/subscription/` + `test/nodes/`
- [X] T016 [P] [US1] Confirm `src/warp/` untouched and warp specs green (no behavior change permitted by this story)

**Checkpoint**: US1 independently testable — VLESS + WARP connect, deleted `?target=` values refused

---

## Phase 4: User Story 2 - Removed routes look untouched (Priority: P1)

**Goal**: Every removed URL serves camouflage identical to unknown paths; Telegram trimmed to 3 commands + help

**Independent Test**: Request each shape in contracts/removed-routes.md + one random URL → all indistinguishable, no upgrade ever; bot command matrix per contracts/telegram-commands.md (quickstart scenarios 2, 7)

- [X] T017 [P] [US2] Delete `src/handlers/users-sub.ts`, `src/handlers/myip.ts`, and `src/users/store.ts`
- [X] T018 [P] [US2] Delete `src/tunnel/chain/` + `src/tunnel/nat64.ts` + `src/tunnel/speedtest.ts`; trim chain/NAT64/speedtest refs in `src/tunnel/egress.ts` (proxyIP-pool failover kept)
- [X] T019 [US2] Reduce `src/handlers/camouflage.ts` to static-page mode (delete proxy-fetch path; keep shared SSRF guards in `src/utils/net.ts` for surviving URL fields)
- [X] T020 [US2] Trim `src/handlers/api/telegram.ts` to status + sub-links + kill on/off with rewritten help in both languages (contracts/telegram-commands.md)
- [X] T021 [US2] Remove users CRUD, TOTP, version-check, and deleted aliases from `src/core/router.ts` + `src/handlers/api/` (contracts/removed-routes.md table)
- [X] T022 [P] [US2] Delete/update router, camouflage, telegram, tunnel, and egress specs under `test/workers/` + `test/tunnel/` mirroring T017–T021

**Checkpoint**: US1 + US2 both work — serving correct, removed invisible

---

## Phase 5: User Story 3 - Deleted panel surfaces are gone (Priority: P2)

**Goal**: No trace of removed surfaces in any view, either language; deleted-view bookmarks land on home

**Independent Test**: Walk every view EN + FA; confirm absences, home redirect, no orphaned/untranslated strings (quickstart scenario 6)

- [X] T023 [P] [US3] Delete `src/ui/panel/users.js`, `src/ui/panel/users-modal.js`, `src/ui/panel/totp.js`; remove them from `PANEL_JS_ORDER` in `scripts/build-single-file.mjs`
- [X] T024 [US3] Prune the user-management section, TOTP card, speedtest toggle, my-ip entry, version-check button, remote-subscription list, NAT64 fields, camouflage-proxy control, deleted subscription-target options, and deleted routes in `src/ui/panel/` (home router: unknown view → home redirect, documented once)
- [X] T025 [P] [US3] Remove orphaned dictionary keys (EN+FA) in `src/ui/panel/dict.js`; add EN+FA dict keys for the pre-cut rejection message (T006) and boot-purge note (T007); trim the client format mirror in `src/ui/panel/format-labels.js` to base64 + sing-box
- [X] T026 [US3] Update `scripts/ui-walk.mjs`: replace steps visiting removed views with surviving-surface assertions, keeping the 12-step count; any step-count change needs explicit authorization
- [X] T027 [US3] Rebuild panel and run unit drift guards (`dict-usage`, `format-labels`, `assets`) until green without weakening any guard

**Checkpoint**: US3 independently verifiable via panel walk + drift suites

---

## Phase 6: User Story 4 - Export/import survives the schema cut (Priority: P2)

**Goal**: Pre-cut backups rejected whole; post-cut exports clean and round-trippable; boot purge proven

**Independent Test**: Pre-cut import → message + zero changes; export → no removed fields/users/secrets → re-import succeeds; upgrade-boot purge + log note + no-op reboot (quickstart scenarios 4–5)

- [X] T028 [US4] Cover clean export (surviving fields only, secrets stripped) and successful re-import in `test/workers/` settings specs
- [X] T029 [US4] Cover pre-cut backup rejection (version < 3 → message, nothing applied, no partial state) in `test/workers/` settings specs
- [X] T030 [US4] Cover boot purge (user rows removed + log note, camouflage on token URLs, counters/audit survive, second boot no-op) in `test/workers/` store/boot specs

**Checkpoint**: All four user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Docs, full-loop green, success metrics

- [X] T031 Add dated Rev header to `docs/ARCHITECTURE.md` and record the cut rationale as a new entry under `docs/decisions/`
- [X] T032 Update `docs/USER_GUIDE.md` + `docs/DEVELOPER_GUIDE.md` for removed settings, commands, outputs, and views
- [X] T033 Run the full verification loop from repo root (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:ui`) to green (`test:ui` needs live `wrangler dev` plus gitignored local creds per repo gotcha)
- [X] T034 Execute `specs/001-vless-warp-slimdown/quickstart.md` scenarios 1–8 and record SC-005 counts (settings fields −25% or more, deleted output variants gone)
- [X] T035 Final audit grep for removed symbols (protocols, formats, users, TOTP, speedtest, my-ip, version-check, remote-subs, NAT64, proxy-camouflage) across `src/`, `test/`, `src/ui/panel/`, `docs/` — zero hits or triage-approved exceptions only

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all stories (schema is the compile contract)
- **Stories (Phases 3–6)**: Depend on Foundational; US1 + US2 (both P1) before US3 + US4 (P2) in priority order; US3 needs US1's target list stable; US4 needs Foundational only
- **Polish (Phase 7)**: Depends on all stories complete

### Within Each Story

- Schema/types before handlers before panel before tests update (research Decision 1); story checkpoint before next priority

### Parallel Opportunities

- T004 ∥ T005 (different settings files); T009 ∥ T010 ∥ T015 ∥ T016 (protocols, emitters, their tests, warp-untouched); T017 ∥ T018 ∥ T022; T023 ∥ T025; T028 ∥ T029 ∥ T030 (different spec files)
- File-level rule: same file never in two parallel tasks (T011→T013→T014 sequence on nodes/routes/tunnel is intentional)

---

## Parallel Example: User Story 1

```bash
# Batch 1 (independent files) — T009, T010, T016 together:
Task: "Delete pruned protocol inbounds in src/protocols/ (keep VLESS seam)"
Task: "Delete culled emitters in src/nodes/emitters/ (keep sing-box)"
Task: "Confirm src/warp/ untouched and warp specs green"

# Batch 2 (tests mirror code) — T015 alongside implementation review:
Task: "Delete pruned parser specs and culled emitter goldens in test/"
```

---

## Implementation Strategy

### MVP First (Foundational + US1 + US2)

1. Phase 1 Setup + Phase 2 Foundational (schema v3, reject, purge)
2. Phase 3 US1 (serve VLESS + WARP) → STOP, validate: clients connect
3. Phase 4 US2 (removed invisible, bot trimmed) → STOP, validate: probe matrix identical
4. Deploy/demo only after US1 + US2 (both P1) — a cut that serves but leaks, or hides but breaks, is not shippable

### Incremental Delivery

5. Phase 5 US3 (panel) → walk EN+FA → demo
6. Phase 6 US4 (backup/purge proofs) → demo upgrade path
7. Phase 7 Polish → docs Rev + ADR + full loop + quickstart + SC-005 counts

---

## Notes

- Every task names exact files; test paths mirror `src/` under `test/` per repo convention — confirm with a glob if a mirror name differs, do not invent new locations
- Never rename surviving top-level functions in `src/ui/panel/*.js` (concat contract); never hand-edit generated `src/ui/panel.html`
- Golden moves are pre-authorized by triage (constitution v1.2.0) — record old→new in the change report
- Commit after each task or logical group; stop at any checkpoint to validate the story independently
