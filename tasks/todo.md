# UI Audit Remediation — Task Tracker

Plan: `tasks/plan.md` (v1.5, from docs/ui-audit.md). Evidence: `.pi/ui-audit/shots/<phase>/`.
Dev server: `wrangler-dev-8799` background task → http://127.0.0.1:8799 · creds in `.pi/ui-audit/local-*.txt`.

## Phase 1 — Skeleton & shipstoppers
- [x] Task 1 (WS-A): Promote Users + WARP top-level tabs + redirects ✅ 1369 tests, Playwright phase1/
- [x] Task 2 (WS-B): Users token column + zero state + quota relabel ✅ tokenHint chip + regen, empty-card, quota relabel, auth-status probe fix
- [x] Task 3 (WS-E): Light-theme WCAG token fix ✅ AA ratios verified, contrast.spec.ts guard
- [x] Task 4 (WS-G): Destructive-action confirmations ✅ import/preset/discard/bulk named-op dialogs
- [x] Task 5 (WS-F): securePath dead control removal ✅ read-only card, clipboard verified
- [x] Checkpoint 1: typecheck+tests+build + Playwright pass 1 ✅ 1382/1382

## Phase 2 — Entity surfaces
- [x] Task 6 (WS-C): Subscriptions hub #/subs ✅ 5th tab, format-labels registry + drift test, teaser, staleness fix, attachment split
- [x] Task 7 (WS-D): WARP detail reorder + error/retry + warp.fmt.* registry adoption ✅
- [x] Task 8 (WS-D): WARP format grouping + preset honesty ✅ 7 families, amnezia toggle, cache fix
- [x] Task 9 (WS-B): Users read surface + capacity chip + search ✅ 8-col table, FA digits, dup-id bug fixed
- [x] Task 10 (WS-A): Settings merge 10->6 ✅ Tunnel/Egress/Routing cards, aliases, P0 readBind textarea fix
- [x] Task 11 (WS-B): ShareSheet component ✅ #m-qr+#m-rot deleted, honest clipboard, TOTP QR routed
- [ ] Checkpoint 2: full tests + Playwright pass 2 (EN/FA + 375px)

## Phase 3 — Copy, i18n, interaction
- [ ] Task 12 (WS-F): Dead-key purge (~70×2) + computed unused-key guard
- [ ] Task 13 (WS-F): Hardcoded strings → dict + home.status.total + dir=auto ECH
- [ ] Task 14 (WS-G): Wizard funnel + undo/redo fix + withBusy + copy honesty
- [ ] Task 15 (WS-E): A11y radiogroups + labels + live regions
- [ ] Task 16 (WS-E): Empty/loading consolidation + retry pairing
- [ ] Checkpoint 3: tests + Playwright pass 3 (keyboard, FA)

## Phase 4 — Perf, purge, server hygiene
- [ ] Task 17 (WS-H): Minify + ETag + per-lang dict split
- [ ] Task 18 (WS-H): Dead code purge (ports/checker/ctrl-k/no-op bars/fossils)
- [ ] Task 19 (WS-H): Server field deletions (localDns, sourceUrls, city) + derived headers + AGENTS.md 76
- [ ] Task 20 (WS-H): settings.js split + O(1) dirty tracking
- [ ] Checkpoint 4: full suite + size report + Playwright pass 4

## Phase 5 — Verification & release
- [ ] Task 21: scripts/ui-walk.mjs visual regression suite (EN/FA × themes × viewports)
- [ ] Task 22: CHANGELOG + guides + version bump/tag

## Status log
- [ ] plan written (this commit)
