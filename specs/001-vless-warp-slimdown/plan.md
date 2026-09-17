# Implementation Plan: VLESS + WARP Slim-Down

**Branch**: `001-vless-warp-slimdown` | **Date**: 2026-09-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-vless-warp-slimdown/spec.md`

## Summary

Delete the entire non-VLESS scope (VMess/Trojan/SS inbounds, Reality/Hy2
remote nodes, chain proxies, multi-user system, TOTP, speedtest, my-ip,
version-check, remote-sub merging, NAT64, camouflage-proxy mode), cull
VLESS subscription outputs to base64 + sing-box, and leave a
single-admin VLESS-over-WebSocket + WARP worker. Approach: schema-first
removal (settings → descriptors → panel → routes → emitters → tests) so
the repo's own drift guards fail fast on any missed step; every removed
URL falls through to camouflage; pre-cut backups are rejected; pre-cut
user data is purged on boot.

## Technical Context

**Language/Version**: TypeScript 7.0.2 (native), strict, ES2023 target

**Primary Dependencies**: Zero runtime dependencies (constitutional).
Dev-only: esbuild 0.28 (single-file bundle), vitest 4 (unit + workers
projects), wrangler 4.125, `@cloudflare/vitest-pool-workers` (miniflare)

**Storage**: Cloudflare KV (`QPROXY_KV`: settings/WARP/auth state) + D1
(`QPROXY_DB`: counters/audit stay; per-user tables purged — see
data-model.md)

**Testing**: `tsc --noEmit` (lint gate) + `vitest run` (unit node +
workers miniflare) + Playwright `test:ui` walk for panel changes

**Target Platform**: Cloudflare Workers, compatibility date `2026-08-01`
(single-file `dist/q-proxy.js`; `dist/_worker.js` for Pages)

**Project Type**: Edge worker service (WS tunnel + HTTP subscriptions)
with embedded bilingual admin SPA

**Performance Goals**: Behavior-preserving cut — VLESS handshake/relay and
WARP serving keep existing semantics; no new latency targets. Request
surface strictly shrinks (fewer routes, no remote fetches, smaller subs).

**Constraints**: Zero runtime deps; single-file bundle; parsers never
throw; no secrets in responses/logs/exports; frozen `docs/ARCHITECTURE.md`
changes only via dated Rev header; goldens move only with triage
authorization (granted by constitution v1.2.0)

**Scale/Scope**: Single admin, single user class; ~100k req/day free-tier
budget (enforced in spec 004, not here)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Narrow scope**: Plan deletes only, adds no protocol/format/route.
  PASS.
- **II. YAGNI**: Every deletion traces to a locked 2026-09-16 triage
  verdict; nothing new ships. PASS.
- **III. Budget**: Cut removes request multipliers (remote-sub fetches,
  proxy-camouflage fetches, oversized sub variants). PASS (positive).
- **IV. Endpoints**: Untouched — spec 002 owns it; no new noise field.
  PASS.
- **V. Zero-dep single-file**: No new imports; bundle shrinks. PASS.
- **VI. Security**: Purge (not retain) user data; reject (not migrate)
  pre-cut backups; camouflage fallthrough reveals nothing; export stays
  secret-free. PASS.
- **VII. Test-first**: Verification loop is the Definition of Done
  (quickstart.md); golden moves pre-authorized by triage. PASS.

Post-design re-check: no new principles implicated; no violations. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/001-vless-warp-slimdown/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

Single-project worker; deletions span existing subsystems (no new
directories, no new files except the boot-purge log path):

```text
src/
├── core/            # routes.ts (shrink matchers), router.ts (drop rows),
│                    # ua.ts (SubFormat → base64|singbox)
├── protocols/       # keep vless.ts + common.ts; delete vmess/trojan/ss
├── nodes/           # generate.ts (VLESS-only); emitters/ (keep singbox
│                    #   + base64 render; delete clash/surge/loon/quantumult)
├── subscription/    # negotiate.ts (2 targets); render thins; delete merge.ts
├── tunnel/          # unchanged (VLESS relay + proxyIP failover stay)
├── warp/            # unchanged (spec 003 owns consolidation)
├── users/           # DELETE subsystem (handler + store usage)
├── handlers/        # delete users-sub, myip, version; trim api/*,
│                    # telegram.ts (3 commands + help); camouflage (static only)
├── settings/        # store/seed/migrate/fields/validate (schema cut,
│                    # version bump, import-reject, boot purge)
├── auth/            # delete TOTP; keep password/session/guard
├── ui/panel/        # delete users views; prune settings cards; dict keys;
│                    # PANEL_JS_ORDER; format-labels mirror
└── types/           # settings.ts (schema cut), node.ts (VLESS-only union)

test/                # mirror deletions; move goldens; drop dead fixtures
docs/                # ARCHITECTURE.md Rev header; decisions/ ADR entry
```

**Structure Decision**: No new structure. The feature is a pure deletion
pass over the existing single-project layout; the only additive code is
the boot-purge routine and the import-version reject branch, both inside
`src/settings/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. Table intentionally empty.
