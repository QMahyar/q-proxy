# Implementation Plan: WARP Output Consolidation

**Branch**: `003-warp-output-consolidation` | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md) (clarified 2026-09-17: toggle matrix, global switch, camouflage refusal)

**Input**: Feature specification from `/specs/003-warp-output-consolidation/spec.md`

## Summary

Collapse 17 WARP output formats to 4 served families — `wireguard-conf` (zip bundle), `singbox`, `v2rayn`, `throne` — with one new global Amnezia switch stored alongside the existing WARP global values. Switch ON renders Amnezia values into the WG conf and sing-box outputs; Throne always carries them; v2rayn links never do. The 8 `-amnezia` twin formats, `wireguard-uri` route, `singbox-legacy` twins, xray, clash twins, surge, surfboard, loon, and egern are deleted as served routes; requests for them fall through to camouflage identical to unknown URLs (the 001 doctrine). Per-account Amnezia overrides are retired (ignored at render, not migrated). Toggle flips and credential rotations purge served copies.

## Technical Context

**Language/Version**: TypeScript 7.0.2 (native), strict, ES2023 target

**Primary Dependencies**: Zero runtime dependencies (constitutional). Dev-only: esbuild 0.28, vitest 4, wrangler 4.125, `@cloudflare/vitest-pool-workers`

**Storage**: Cloudflare KV (`QPROXY_KV`: WARP global settings gain one boolean; accounts/presets untouched in shape) + D1 (untouched by this feature)

**Testing**: `tsc --noEmit` + `vitest run` (unit node + workers miniflare) + Playwright `test:ui` walk for panel changes

**Target Platform**: Cloudflare Workers, compatibility date `2026-08-01` (single-file `dist/q-proxy.js`; `dist/_worker.js` for Pages)

**Project Type**: Edge worker service (WS tunnel + HTTP subscriptions) with embedded bilingual admin SPA

**Performance Goals**: No new latency targets. Served surface shrinks 17→4 formats (fewer goldens, smaller panel); toggle flips reuse the existing edge-cache purge path, no new polling.

**Constraints**: Zero runtime deps; single-file bundle; parsers never throw; no secrets in responses/logs/exports; surviving plain-family goldens stay byte-identical with the toggle OFF (default); new toggle-ON goldens are additive; frozen `docs/ARCHITECTURE.md` changes only via dated Rev header.

**Scale/Scope**: Single admin; one global switch; 4 served families; per-account data untouched in shape.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Narrow scope**: Deletes 13 served formats, adds one boolean + one panel switch. No protocol, no new format, no new route (deleted routes fall through to the existing camouflage handler). PASS.
- **II. YAGNI**: Every deletion traces to the locked triage verdict (base64+singbox VLESS already done; WG/singbox/v2rayn/Throne survivors named in triage); the toggle is the triage-mandated Amnezia-as-values mechanism. PASS.
- **III. Budget**: Fewer variants, no new fetches, no new polling. Toggle flips purge via the existing path (bounded, admin-initiated). PASS.
- **IV. Endpoints**: Untouched — renders the 002 global selection unchanged. PASS.
- **V. Zero-dep single-file**: No new imports; bundle shrinks (13 emitters/branches deleted). PASS.
- **VI. Security**: Deleted-format requests become indistinguishable from unknown URLs (extends the 001 camouflage doctrine, closes a fingerprinting gap vs today's distinct 404). Export stays secret-free. PASS (positive).
- **VII. Test-first**: Full loop is the Definition of Done (quickstart.md). Survivor goldens stay byte-identical with toggle OFF; toggle-ON and camouflage-equivalence goldens are new; the cull itself is triage-pre-authorized. PASS.

Post-design re-check: no new principles implicated; no violations. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/003-warp-output-consolidation/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

Deletion-led pass over the WARP subsystem plus one boolean and its panel switch:

```text
src/
├── warp/
│   ├── formats/
│   │   ├── registry.ts      # WARP_FORMATS → 4 survivors; EMITTERS single entry per family (+opts)
│   │   ├── conf.ts          # keep emitWireguardConfZip (+toggle branch), emitThrone (always amnezia),
│   │   │                    # keep emitWireguardUri as INTERNAL helper (route deleted), keep emitV2rayN (never amnezia)
│   │   ├── singbox.ts       # single emitSingbox (+toggle branch); legacy variant deleted
│   │   ├── proxies.ts       # DELETE clash/surge/surfboard/loon/egern emitters (file may shrink to shared helpers)
│   │   └── (xray emitter)   # DELETE xray branch (lives in singbox.ts — trim to VLESS/WARP needs)
│   ├── expand.ts            # resolve global toggle; ignore per-account amnezia_overrides at render
│   ├── store.ts             # WarpGlobalSettings gains amneziaEnabled boolean (default false)
│   ├── api.ts               # unchanged (registration untouched)
│   └── cache.ts             # purge on toggle save (existing helpers)
├── handlers/
│   ├── warp-sub.ts          # deleted formats → handleCamouflage (identical to unknown URL)
│   └── api/warp.ts          # amnezia PUT accepts the toggle; per-account override writes ignored
├── types/warp.ts            # WarpGlobalSettings + amneziaEnabled; account type keeps inert overrides field
└── ui/panel/
    ├── warp.js              # 4 families + toggle in groups/detail; per-account amnezia card removed
    ├── dict.js              # EN+FA toggle keys; orphaned fmt.*/preset-switch keys removed
    └── format-labels.js     # untouched (VLESS formats only)

test/                        # cull deleted goldens; pin survivor goldens (toggle OFF identical) + new toggle-ON,
                             # camouflage-equivalence, and global-switch cases
docs/                        # ARCHITECTURE.md Rev header; USER/DEVELOPER guide WARP sections
```

**Structure Decision**: No new directories or modules. The feature is a deletion pass plus one boolean riding the existing WARP global-settings store (not the Settings descriptor pipeline — values and switch stay atomic in one KV record).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally empty.
