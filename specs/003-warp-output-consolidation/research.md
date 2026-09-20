# Research: WARP Output Consolidation

**Feature**: `003-warp-output-consolidation` | **Date**: 2026-09-17

Technical Context contained zero `NEEDS CLARIFICATION` markers — the
clarify session (2026-09-17) settled the toggle matrix (WG+singbox switch,
Throne always, v2rayn never), the global level (per-account overrides
retired), and the camouflage refusal. Code survey confirmed the building
blocks: `-amnezia` twin emitters already encode both variants, `emitV2rayN`
is `btoa(emitWireguardUri(...))`, and `warp/cache.ts` already purges served
copies. This Phase 0 records the removal-strategy decisions.

## Decision 1: Toggle lives with the WARP global values, not in Settings

- **Decision**: Add `amneziaEnabled: boolean` (default `false`) to `WarpGlobalSettings` in the existing KV record; the `warp/settings/amnezia` PUT accepts it alongside values. No Settings-descriptor field, no version implications.
- **Rationale**: Values and switch stay atomic in one store and one API call; the panel's Amnezia card already reads/writes that record. A Settings-descriptor field would split one concept across two stores and two save paths for zero benefit.
- **Alternatives considered**: `Settings.warpAmnezia` descriptor field — rejected: splits values from switch, needs descriptor/panel/drift ceremony for a WARP-view-owned control.

## Decision 2: Emitter matrix follows the clarified verdict literally

- **Decision**: One registry entry per surviving family; the toggle is an emit-time option: `wireguard-conf` renders the plain zip when OFF and today's `-amnezia` zip bytes when ON; `singbox` likewise; `throne` always renders today's `-amnezia` throne bytes; `v2rayn` always renders today's plain bytes. The 8 `-amnezia` twin registry entries are deleted; twin emitter functions collapse into flag branches (or stay as internal helpers where the diff is noise either way — implementer's call, goldens decide).
- **Rationale**: Survivor outputs with toggle OFF stay byte-identical to today's plain goldens (zero migration risk); toggle ON reproduces today's `-amnezia` goldens (proven bytes, not new code paths).
- **Alternatives considered**: Keeping twin formats behind the toggle (routing `wireguard-conf` to twin content when ON) — rejected: identical bytes with extra registry entries is exactly the duplication being killed.

## Decision 3: `wireguard-uri` survives as an internal helper, dies as a route

- **Decision**: `emitWireguardUri` stays (v2rayn is base64 of its output); the `"wireguard-uri"` route, content-type/extension rows, and panel references are deleted like the other 12.
- **Rationale**: Deleting the function would force reimplementing it inside v2rayn for no reason; the spec kills served formats, not shared code.
- **Alternatives considered**: Keeping the route as a hidden 5th family — rejected: FR-001 says exactly four.

## Decision 4: Throne parameters pinned from the current golden

- **Decision**: No Throne grammar work. The current `throne-amnezia` golden bytes become the single `throne` contract; the test is renamed, not rewritten.
- **Rationale**: The clarify assumption is satisfied by evidence, not new research — the emitter ships, tests assert it byte-exact, and the triage defined Throne as v2rayn+Amnezia values, which is what those bytes are.
- **Alternatives considered**: Re-deriving Throne params against the app — rejected: the golden already is the app-compatible contract per the passing suite.

## Decision 5: Deleted formats fall through to camouflage (extends 001)

- **Decision**: `handleWarpSub` serves camouflage (same handler, same bytes/headers as any unknown path) for any format outside the surviving four, instead of today's distinct 404.
- **Rationale**: The 001 camouflage doctrine (spec 001, contracts/removed-routes.md) exists precisely so probes learn nothing; a distinct 404-per-deleted-format would fingerprint the removal list. One refusal story for every dead path, one test matrix.
- **Alternatives considered**: Keeping the 404 — rejected: inconsistent with 001 and fingerprintable. Distinct 410-per-format — rejected harder for the same reason.

## Decision 6: Cache purge on toggle flips reuses the existing path

- **Decision**: The toggle-save handler calls the existing per-token/all purge helpers (`warp/cache.ts`); rotation keeps its current per-token purge (verified to cover all four families since families only shrink the emitted set, not the purge path). No new cache machinery.
- **Rationale**: Spec edge cases demand freshness, not new infrastructure — the purge helpers already enumerate served copies by token, which is format-agnostic.
- **Alternatives considered**: Version-stamping served files — rejected: new machinery for a solved problem.

## Decision 7: Per-account overrides retire inert (002 precedent)

- **Decision**: `amnezia_overrides` stays in the account type and stored blobs; render ignores it; update paths ignore writes to it; panel card deleted. No migration, no purge of stored values.
- **Rationale**: Same clean-break rule as 002's `endpoint_list` retirement (clarified drop-no-migrate): inert data is harmless, migration code is forever-code for a one-way trip.
- **Alternatives considered**: Deleting the field from the type + a KV migration — rejected: rewrites every stored account for zero behavioral gain.
