# Implementation Plan: Preset + Custom Endpoints

**Branch**: `002-preset-custom-endpoints` | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-preset-custom-endpoints/spec.md`

## Summary

Add curated CDN `ip:port` presets (shipped data file + per-entry toggles) and a custom `ip:port` paste box as the ONLY VLESS address sources — replacing the `addresses[]` list (dropped, not migrated) with worker-hostname fallback when all empty. Presets and custom lines feed every output variant uniformly (normal and fragment alike). WARP gets ONE global endpoint source (preset ticks + custom box) governing every account and output family, replacing per-account endpoint selection. ProxyIP failover, single DoH box, and fragment/fingerprint/SNI behavior are already built and tested under spec 001; this plan verifies them without rebuilding. Settings version stays 3 (bumping would reclassify v3 backups as pre-cut and brick imports).

## Technical Context

**Language/Version**: TypeScript 7.0.2 (native), strict, ES2023 target

**Primary Dependencies**: Zero runtime dependencies (constitutional). Dev-only: esbuild 0.28, vitest 4, wrangler 4.125, `@cloudflare/vitest-pool-workers`

**Storage**: Cloudflare KV (`QPROXY_KV`: settings blob holds the two new fields; WARP presets/accounts already in KV) + D1 (untouched by this feature)

**Testing**: `tsc --noEmit` + `vitest run` (unit node + workers miniflare) + Playwright `test:ui` walk for panel changes

**Target Platform**: Cloudflare Workers, compatibility date `2026-08-01` (single-file `dist/q-proxy.js`; `dist/_worker.js` for Pages)

**Project Type**: Edge worker service (WS tunnel + HTTP subscriptions) with embedded bilingual admin SPA

**Performance Goals**: No new latency targets. Node count per output stays bounded by the existing `maxNodesPerFormat` cap (spec 004 owns the budget); preset+custom inputs are small bounded lists (≤64 entries each, matching the `addresses` cap).

**Constraints**: Zero runtime deps; single-file bundle; parsers never throw; no secrets in responses/logs/exports; CF port families are fixed policy (`tls ⇒ {443,2053,2083,2087,2096,8443}`, `plain ⇒ {80,8080,8880,2052,2082,2086,2095}`); settings version MUST stay 3 (see research Decision 2); preset file is the single blessed hard-coded-address exception to invariant X (see Constitution Check).

**Scale/Scope**: Single admin; preset file ships ~8 entries; custom boxes bounded to 64 lines each.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Narrow scope**: Adds endpoint DATA (preset selection + custom lines) and one fallback branch. No protocol, format, or route added or removed. PASS.
- **II. YAGNI**: Every addition traces to spec 002 FR-001..008. WARP/US4/DoH/fragment work is verify-only, not rebuilt. PASS.
- **III. Budget**: More selectable endpoints could grow subscription size; bounded by the existing `maxNodesPerFormat` cap and 60s edge cache (no new fetch paths, no new polling). New lists are capped at 64 entries. PASS with note (cap interplay belongs to spec 004).
- **IV. Preset+Custom**: This feature IS the principle. Preset file + custom paste, CF-family enforcement, hostname fallback when all empty. Invariant-X reconciliation: X forbids hard-coded generation addresses *except* the shipped preset file, which IV explicitly blesses ("nothing is ever hard-coded into generation beyond the shipped preset file"). Address-composition tests are updated to allow exactly that one source. NOT a violation — recorded here deliberately.
- **V. Zero-dep single-file**: One new data module with zero imports beyond types; bundle grows by bytes. PASS.
- **VI. Security**: Custom lines are never fetched by the worker (generation-only addresses; WARP endpoints render client-side), so no new SSRF surface. Per-line validation rejects (never silently converts); no secrets involved. PASS.
- **VII. Test-first**: Full loop is the Definition of Done (quickstart.md). No wire-format changes (same two emitters), so no golden moves — node SETS change, but goldens use fixed fixtures. PASS.

Post-design re-check: no new principles implicated; no violations. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-preset-custom-endpoints/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

Additive feature on the post-001 layout; two new settings fields ride the existing descriptor pipeline, one new data module, panel additions in place:

```text
src/
├── nodes/
│   ├── cdn-presets.ts        # NEW: shipped CDN preset entries (data only, no imports)
│   ├── generate.ts           # presets + custom lines REPLACE addresses[]; dedupe by host:port
│   └── share-uri.ts          # untouched
├── types/settings.ts         # REMOVE addresses[] (+AddressSetting, country filter, resolveHostname list use);
│                             # + cdnPresets: string[], customEndpoints: string[],
│                             # + warpPresets: string[] (default ["default"]), warpCustomEndpoints: string[];
│                             # version stays 3
├── settings/
│   ├── fields.ts             # - addresses/descriptor rows, + four descriptor rows
│   ├── validate.ts           # + per-line custom-endpoint validation (VLESS + WARP boxes)
│   ├── migrate.ts            # untouched (no version bump, no new step; removed keys drop via defaults)
│   └── store.ts              # untouched (import-reject rule unchanged: version < 3)
├── warp/
│   ├── expand.ts             # render from GLOBAL warp selection; empty → default preset
│   └── (store/api/config)    # per-account endpoint_list retired (stored lists ignored, not migrated)
├── tunnel/egress.ts          # untouched (US4 verify-only)
└── ui/panel/
    ├── sections-registry.js  # endpoint section rebuilt: preset checklist + custom textarea (VLESS),
    │                         # global WARP preset/custom cards; addresses/country UI removed
    ├── fields-render.js      # preset/custom field widgets (if needed)
    ├── fields-validate.js    # client-side per-line feedback (mirror)
    ├── dict.js               # EN+FA keys for preset/custom surfaces (orphaned addresses/country keys removed)
    └── format-labels.js      # untouched

test/                        # mirror updates + new cases (see quickstart.md)
docs/                        # ARCHITECTURE.md Rev header; USER/DEVELOPER guide endpoint sections
```

**Structure Decision**: No new directories. The feature follows the repo's setting-field pipeline (`Settings` → `DEFAULT_SETTINGS` → descriptor → panel binding + EN/FA dicts → validate + drift specs) and the emitter inputs stay unchanged.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally empty.
