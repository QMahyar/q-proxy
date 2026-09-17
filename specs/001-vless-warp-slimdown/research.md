# Research: VLESS + WARP Slim-Down

**Feature**: `001-vless-warp-slimdown` | **Date**: 2026-09-16

Technical Context contained zero `NEEDS CLARIFICATION` markers — language,
storage, testing, platform, and constraints are all fixed by the repo and
constitution v1.2.0. This Phase 0 therefore records the removal-strategy
decisions (order, markers, and guardrails) so Phase 2 tasks follow one
consistent playbook.

## Decision 1: Schema-first removal order

- **Decision**: Delete in this order — `Settings` type + defaults →
  field descriptors + validation → panel parts + dict keys → routes +
  handlers → node/emitter code → tests + goldens → docs Rev header.
- **Rationale**: The repo's drift guards (fields agreement, dict usage,
  format-label parity, resurrection guards) fail CI on any skipped step;
  going schema-first turns every missed deletion into an immediate compile
  or test error instead of a silent leftover.
- **Alternatives considered**: Code-first (delete protocols/handlers,
  fix fallout after) — rejected because the panel's plain-concat scope and
  descriptor pipeline produce confusing downstream errors when driven
  backwards.

## Decision 2: Pre-cut marker via settings version bump

- **Decision**: Bump the settings version (2 → 3) as the cut marker.
  Import and boot paths treat version < 3 blobs as pre-cut: imports are
  rejected with a clear incompatibility message applying nothing; boot
  runs the user-data purge (Decision 3). Unknown keys are never merged.
- **Rationale**: The spec mandates reject-not-migrate; a version gate is
  the only reliable pre-cut detector once removed fields are gone from
  the type. It also gives the panel a single rule for the error message.
- **Alternatives considered**: Key-sniffing (detect removed field names
  in the backup) — rejected as fragile allow-listing that rots with every
  future schema change.

## Decision 3: Boot purge of per-user data

- **Decision**: On first boot with a version < 3 store, delete all
  per-user records (user directory, per-day usage/activity aggregates,
  per-user tokens) and write one log line noting what was removed; then
  stamp the store at version 3. D1 per-user tables are dropped/emptied in
  the same pass; counters and audit log are retained.
- **Rationale**: Spec mandates purge-with-log-note. Doing it at boot
  (before serving) guarantees no request can ever observe pre-cut user
  data, and a single idempotent pass cannot double-delete.
- **Alternatives considered**: Lazy purge on first admin login — rejected
  because subscription URLs are servable without login and must never
  observe stale user state.

## Decision 4: Camouflage fallthrough for all removed URLs

- **Decision**: Removed tunnel paths, dead token URLs, and deleted API
  routes resolve exactly like any other unknown path — through the
  static-camouflage handler. No removal-specific status codes, no
  dedicated handlers, no upgrade attempt before the fallthrough.
- **Rationale**: One refusal story for every unknown path preserves the
  disguise under probing and deletes handler code instead of adding it.
  The kill-switch gate keeps running before upgrade for surviving routes.
- **Alternatives considered**: Distinct statuses per removed route (410
  for tokens, 404 for protocols) — rejected: fingerprintable and more
  code for zero user value.

## Decision 5: Emitter cull as whole-file deletion

- **Decision**: Delete the clash/surge/loon/quantumult emitter files,
  their registry entries, their `SUB_FORMATS`/`UA`/label/header wirings,
  and their goldens outright. No shims, no aliases, no deprecated-target
  warnings: `?target=` values outside base64|singbox are invalid.
- **Rationale**: Shims keep the maintenance cost the cull exists to kill
  (goldens, UA branches, panel labels). The spec's SC-005 counts deleted
  variants as success.
- **Alternatives considered**: Temporary redirect of deleted targets to
  sing-box with a warning header — rejected as scope creep that punishes
  the clients that updated promptly.

## Decision 6: Panel pruning follows the concat contract

- **Decision**: Delete whole users views; prune removed cards from
  settings parts in place; remove orphaned dict keys in both languages;
  update the concat order table; update the UI walk steps that visited
  removed views. Never rename surviving top-level part functions; never
  hand-edit the generated panel file.
- **Rationale**: The panel is one plain-concat scope — function names are
  a cross-file contract and the generated file is build output. The
  dict-usage and resurrection guards verify completeness after the prune.
- **Alternatives considered**: Rewriting panel structure while pruning —
  rejected: restructuring and deleting in one pass makes regressions
  unattributable; structure work belongs to a later spec if ever.

## Decision 7: Telegram trimmed to three commands + help

- **Decision**: Keep status, sub-links, kill on/off; delete per-user
  usage and any command touching removed scope; rewrite help text in both
  languages to the surviving set.
- **Rationale**: Direct transcription of the locked triage verdict; bot
  replies must never reference deleted features (spec edge case).
- **Alternatives considered**: Keeping commands that "still run" —
  rejected by the same verdict; dead-feature commands are support traps.

## Decision 8: Docs move with the code

- **Decision**: Same change ships a dated `docs/ARCHITECTURE.md` Rev
  header, an ADR recording the cut rationale, and updated user-facing
  guides (removed settings/commands/outputs). Frozen sections are never
  edited without the Rev line.
- **Rationale**: Constitutional requirement; the Rev header is what keeps
  the frozen contract trustworthy after a MAJOR-scope deletion.
- **Alternatives considered**: Docs follow-up later — rejected: the same
  drift that rots code rots docs, and reviewers cannot verify scope
  without the closed removal list in writing.
