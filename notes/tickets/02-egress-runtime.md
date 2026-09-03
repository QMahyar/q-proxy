---
id: 02
title: Fix egress failover and runtime correctness traps
type: task
status: open
branch: fix/egress-runtime
blocked_by: []
---

# Fix egress failover and runtime correctness traps

## Question

Make egress failover actually survive refused/unreachable targets, retry on read errors, and stop zombies + per-connection memory blowups. Ground truth: `docs/ARCHITECTURE.md`, AGENTS.md invariants #6.

## Current findings (from the Cloudflare-runtime review — implement these)

1. **[HIGH] `connect()` result never awaited via `socket.opened`.** `src/tunnel/chain/index.ts:66-70` (`dialTcp`) returns the Socket immediately; CF sockets surfaces ECONNREFUSED/DST_UNREACH on `socket.opened`/stream errors, NOT in `connect()`. So `src/tunnel/egress.ts:120` treats a refused target as success, proxyIP×8 walk (`egress.ts:173-185`) is skipped, tunnel dies 1011.
   - Fix: in the default dial impl, `await socket.opened` (reuse the running `Promise.race` timeout at `egress.ts:154-166` to bound connect), and close + throw on rejection.
2. **[HIGH] Downlink read ERROR bypasses the zero-byte retry hook.** `src/tunnel/relay.ts:277-295`: clean EOF with `downlinkBytes===0` routes to `handleRemoteClose` → `opener.retry`; a read *rejection* goes to `fail(1011)`. Fix: in the catch, if `!halfOpen && !retriedOnce && downlinkBytes === 0 && opts.retry`, run the same swap logic instead of `fail()`.
3. **[MEDIUM] No idle/stall deadline on established sockets.** `src/tunnel/relay.ts:276-315` — only a 10 s handshake + 5 s half-open grace exist. A stalled origin pins an invocation, a connection slot, an 8 MiB uplink budget, and the client forever. Fix: track `lastActivityMs` and `finish(1000)` after a configurable idle ceiling (e.g. 300 s).
4. **[MEDIUM] Uplink hard cap is 8 MiB enforced TWICE (2×8 MiB per tunnel).** `src/tunnel/relay.ts:8,132-134` (`upQueue`) and `:8,174-177` (`decodeQueued`). ~7-8 stalled tunnels evict the 128 MB isolate → error 1102 kills every healthy tunnel on it. Fix: drop to ~1-2 MiB per queue, or add a module-level isolate-wide byte counter shared across relay instances.

## Constraints

- Keep AGENTS.md invariant #6 (kill-switch gate before upgrade) and the "header written once" invariant.
- Match edgetunnel's approach only conceptually — do NOT clone it; use `docs/research/02-edgetunnel.md` for reference.
- Timer hygiene: every `setTimeout` on the losing path must be cleared (no unhandled-rejection noise under `unhandled_rejection_after_microtask_checkpoint`).
- No `throw` escapes to WS close 1011 where a reject 1008 is correct.

## Verify

`npm run typecheck` then `npx vitest run --project unit` (relay/egress specs). Add a unit test proving a refused dial triggers failover, and that a mid-session read error triggers retry.
