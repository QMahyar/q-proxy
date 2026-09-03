# Wayfinder Map — Harden Q Proxy Through the 5 Review Gates

`wayfinder:map`

## Destination

Harden Q Proxy so it passes all five review gates: restore VMess AEAD client interop, make egress failover survive refused targets, stop user-subscription KV write amplification, close the security trio, and fix the architecture/tests/lint debt — every concrete finding implemented, `npm run typecheck` + test suite green, on mergeable feature branches.

## Notes

**Overrides "plan, don't do": this effort carries execution into the map.** Tickets are `task` type, agent-driven (AFK): each is implemented on its own git branch (no worktrees) by a parallel subagent, then typecheck + unit tests must pass.

- Domain: Cloudflare Workers proxy (VLESS/VMess/Trojan/SS over WS), zero runtime deps, one KV namespace.
- Skills each session should consult: `typescript-best-practices`, `test-driven-development`, `security-and-hardening`, `performance-optimization`, `cloudflare-workers-best-practices`.
- MUST NOT break AGENTS.md invariants **#1–#10** (esp. #3 SS nonce LE, #4 first-packet-once, #5 Trojan UDP frame, #6 kill-switch before upgrade, #9 pure emitters).
- Do NOT edit frozen sections of `docs/ARCHITECTURE.md` (Rev header line 3) or change share-URI / emitter wire formats.
- Do NOT add a runtime dependency to `package.json`.
- Verify: `npm run typecheck`, then `npx vitest run --project unit`. Capture proof in the resolution comment.
- Branch naming: `fix/<area>` / `perf/<area>` / `chore/<area>`; commit only your files; do not merge, do not push, do not touch `master`.

## Decisions so far

<!-- index: one line per CLOSED ticket, gist + link to its detail -->

- [01 — Fix VMess AEAD interop and protocol wire bugs](../notes/tickets/01-protocol-interop.md): **DISPROVEN** — the CRITICAL "VMess header swap" is a false positive. Verified against `XTLS/Xray-core proxy/vmess/aead/encrypt.go`: layout is `authId(16)|sealedLen(18)|nonce(8)|payload`, which is exactly what `vmess-crypto.ts:157-158` does. Applying the "swap" would break VMess. Remaining items (size-cap, Trojan UDP gate, response option byte) are LOW-confidence and need a live client/workerd capture; leave untested.
- [02/1 — egress failover](../notes/tickets/02-egress-runtime.md): `dialTcp` now `await socket.opened` (`chain/index.ts:70`) so ECONNREFUSED/DST_UNREACH surfaces on the dial and the proxyIP×8 walk engages. Verified real; committed `909da7c` on `fix/egress-opened`.
- [02/2 — read-error retry + idle deadline + uplink cap](../notes/tickets/02-egress-runtime.md): all 3 VERIFIED REAL + fixed on `fix/egress-failover` (`6aafcc4`): downlink read-error now retries (zero-byte gate), 300 s idle deadline added, 8 MiB→1 MiB per-queue cap. 891 unit tests.
- [03/1 — camouflage SSRF](../notes/tickets/03-security-hardening.md): protocol-relative path can no longer rebind host, and cross-origin redirects are refused (`camouflage.ts`). Committed `90fee5f` on `fix/camouflage-ssrf`.
- [03/3 — plaintext user tokens](../notes/tickets/03-security-hardening.md): `UserAccount` no longer stores/echoes plaintext `token`; returned once at create/regenerate. Legacy migration drops the plaintext. Committed `e334d0d` on `fix/users-token-plaintext`.
- [03/2 — SS salt pre-auth poisoning](../notes/tickets/03-security-hardening.md): NOT verified as a bug — reviewer's claim was contradicted by read of the code (salt is rolled back on every failure path, so no replay window). Leave as-is; needs a live replay test to confirm.
- [04 — user-sub KV amplification + per-frame importKey + chacha](../notes/tickets/04-performance-kv-crypto.md): A (cache-before-quota + batched user-total + 15 s users memo) and B (CryptoKey cache, once/session) VERIFIED REAL + changed on `perf/kv-crypto` (`7dc9bc4`); C (chacha BigInt Poly1305) is real but unreachable in default config — noted in AGENTS.md Known Gaps, 32-bit limbs = future fix. 896 unit + 33 workers.
- [05 — settings single source of truth + drift test + mirror fixes + hmac spec + lint](../notes/tickets/05-architecture-tests.md): A real → `src/settings/fields.ts` descriptor (66 fields, not 72) + drift test; dicts/en-fa already in sync; frozen §2.2 stale (deferred, needs arch revision); B all 3 mirror violations fixed; C hmac spec added (7 tests); D lint SKIPPED (typescript-eslint peer-requires TS <6.1; repo runs TS 7.0.2). `ccc84c4` on `chore/architecture`. 909 unit + 33 workers + build.

## Not yet specified

- Whether to add `[limits] cpu_ms` to `wrangler.toml` (decide after perf ticket; Free-tier 10 ms CPU is structurally exceeded).
- VMess response-option-byte (`vmess-crypto.ts:224`, HIGH-SUSPECT) — implement the reviewer's one-line fix now, but confirm against a live v2rayNG capture (byte 1 of decrypted response header should be `0x05`, not `0x00`).
- Whether to bump the compatibility date (currently `2026-08-01`, 3 days below a behavior-changing cutoff at `2026-08-04`).
- Settings single-source-of-truth: how far to refactor the 5-place field sync (ticket `05` settles the scope).

## Out of scope

- Storage migration to Durable Objects / D1 (perf reviewer's future note) — bigger than this hardening pass; would be its own map.
- New protocol/feature additions (REALITY, xhttp, quantumult) — fixes only, no feature growth.
- External subconverter offload (edgetunnel-style) — architectural change beyond destination.
- Adopting bpb's runtime deps (`jose`, `jszip`, `qrcode-generator`) — the zero-dep single-file constraint stays.
