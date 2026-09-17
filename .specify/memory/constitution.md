<!-- Sync Impact Report (remove before commit):
Version change: 1.1.0 → 1.2.0 (MINOR: full keep/drop triage verdicts locked — emitters, routing, camouflage, egress, panel cull)
Modified principles: II (triage verdicts final); IV (noise = no new field); III unchanged (confirmed)
Added sections: none
Removed sections: none
Follow-up TODOs: none — all triage decided. Ready for /speckit.specify breakdown.
-->

# Q Proxy Constitution

## Core Principles

### I. Narrow Protocol Scope (VLESS CDN + WARP ONLY, CONFIRMED)

The worker terminates VLESS over WebSocket and serves WARP/WireGuard
configs. NOTHING else ships in the default build. CONFIRMED REMOVED:
VMess, Trojan, Shadowsocks inbounds, Reality/Hy2 remote nodes, and chain
proxies (socks/http/vmess/ss chains), plus gRPC/xhttp transports:
protocol files, settings fields, emitter branches, routes, and panel
surfaces go together or not at all. Rationale: every extra inbound doubles
the handshake audit surface and every extra emitter doubles golden-test
load, while the stated user need is CDN-fronted VLESS plus WARP
passthrough. Single-admin single-user ONLY: the ≤50 scoped-users system
(`qproxy:users`, per-user token subs, quotas, expiry) is REMOVED with the
same all-or-nothing rule. Any re-addition is a
MAJOR governance decision requiring an ADR, a frozen-contract revision in
`docs/ARCHITECTURE.md`, and a major version bump.

### II. YAGNI No-Bloat (NON-NEGOTIABLE)

No setting, emitter, route, panel card, or dependency ships without a named
user need traceable to BPB/Nahan/Edge parity triage or a filed issue. Every
addition MUST delete or explicitly justify its weight: new settings ride the
single descriptor pipeline (`Settings` → `DEFAULT_SETTINGS` → field
descriptor → panel binding → EN+FA dict → validate spec + drift guards), new
emitters stay pure `(nodes, opts) => string` with golden tests, and dead
symbols stay dead (resurrection guards fail CI on purpose). When in doubt,
REMOVE. Decided verdicts (locked 2026-09-16 triage): Telegram bot KEEP,
TOTP REMOVE, speedtest intercept REMOVE, multi-user system REMOVE,
remote-sub merging REMOVE, camouflage-static KEEP (proxy mode REMOVE),
my-ip checker REMOVE, version-check REMOVE. VLESS emitters: base64 +
sing-box ONLY (clash/surge/loon/quantumult deleted). WARP outputs: WG
conf + sing-box + v2rayn links + throne (v2rayn+Amnezia values; Amnezia
as values/toggle, never 17 separate formats). Routing rules: Edge-minimal
(bypass-LAN + final only — NOT the BPB full ad/malware/QUIC set).
Fragment: presets + custom box kept, NO new noise field. Egress: proxyIP
pool + custom DoH kept; NAT64 + remote-DNS + url-test knobs dropped.
Panel keeps the security set (ECH, fingerprint, randomized SNI,
early-data+ALPN, IP-allowlist, kill-switch, intervals, export/import,
QR+ShareSheet).

### III. Request-Budget Discipline (100k req/day free tier)

Cloudflare Workers free tier allows ~100k requests/day and this worker
spends it on proxying. Cost split is explicit: VLESS-over-WS connections
are EXPENSIVE (every CDN-fronted connection terminates here, every
handshake + relay byte costs), while subscription/WARP file serving is
CHEAP (edge-cacheable, served once per `subUpdateIntervalHours`). WARP
WireGuard traffic NEVER touches the worker — only the config file
download counts. The codebase MUST treat requests as currency:
subscriptions edge-cached (60s throttle triple, settings-etag cache keys),
clients refresh on `subUpdateIntervalHours` (served via
`Profile-Update-Interval`, never hardcoded), node counts capped by
`maxNodesPerFormat`, single-admin budget enforced via caps + cache (no
per-user quota system — it died with multi-user), per-connection overhead
inside WS↔TCP pump caps, and DoH/remote-sub fetches with timeout + byte
caps + parallelism budgets.
Any feature that multiplies per-client request volume (shorter polling,
uncached endpoints, chatty status APIs) MUST ship with a measured
requests-per-day estimate or it does not land.

### IV. Preset Endpoints + Custom Paste (CDN ip:port, WARP endpoint:port)

The panel ships with a SMALL set of curated presets in code plus ONE
custom path, nothing more. VLESS side: preset CDN ip:port list (Cloudflare
port families only — `tls ⇒ {443,2053,2083,2087,2096,8443}`, `plain ⇒
{80,8080,8880,2052,2082,2086,2095}`) and a custom textarea where the admin
pastes their own `ip:port` lines; entries pinning ports outside the CF
families are dropped, nothing is ever hard-coded into generation beyond
the shipped preset file. WARP side: preset endpoint:port list plus a
custom `endpoint:port` paste box, merged with the account's WireGuard
credentials and Amnezia values at emit time. Fragment presets
(TLS-only, never on CDN addresses) and fingerprint/SNI controls stay as
the BPB/Edge-compatible evasion set; any new "noise" knob MUST be defined
as preset-or-custom data first, code second, with Xray-core fixture
validation plus golden emitter output. Triage verdict (2026-09-16): NO
new noise field — fragment presets + custom box are the whole anti-DPI
surface until a named client demands more.

### V. Zero-Dependency Single-File Worker

Zero runtime npm dependencies, forever. The bundle is one file
(`dist/q-proxy.js` for Workers, `dist/_worker.js` for Pages) built by
esbuild, importing only relative modules, `cloudflare:*`, WebCrypto
globals, and text-imported UI assets. Compatibility date is pinned
(`2026-08-01`); Blob-binary WS semantics, `cloudflare:sockets` TCP egress
only, and isolate-cache/KV-consistency assumptions follow from it. Parsers
never throw (`{ok:true,value}` / `{ok:false,reason}` or `PushOutcome`);
only HTTP handlers convert failures into WS close codes (1008 reject, 1011
infra) or the JSON envelope via `AppError` subclasses.

### VI. Security and Privacy by Default

Secure path gates panel/subs/API, sessions are HMAC `q_session`
(`{exp,iat}` + revocation floor) with CSRF (`X-Q-Panel`) on mutations,
passwords are PBKDF2 (100k, peppered, legacy auto-upgrade), and the
kill-switch gate runs BEFORE any WebSocket upgrade. Sensitive fields
(`passwordHash`, `passwordSalt`, `sessionSecret`, write-only tokens) NEVER
appear in responses, logs, exports, or HTML. SSRF guards deny
local/private/metadata targets on every admin-supplied URL, `mergeInto`
skips `__proto__`/`constructor`/`prototype`, and setup re-reads fresh state
before writing (TOCTOU). A feature that weakens any of these MUST NOT land,
regardless of panel-parity pressure.

### VII. Test-First and Verification Loop (NON-NEGOTIABLE)

`npm run typecheck` (strict `tsc --noEmit`, the lint gate — no eslint by
design) and `npm test` (unit + workers projects) MUST pass before every
commit; UI-facing changes additionally require `npm run build` +
`npm run test:ui` (12-step Playwright walk, zero-console-error contract).
Wire-format changes break golden tests ON PURPOSE — moving a golden needs a
pre-authorized plan and an old→new record. Drift guards (dict usage/parity,
format-label parity, assets budget, fields agreement) fail CI when steps are
skipped; fix forward, never weaken the guard.

## Additional Constraints

Technology stack: TypeScript 7.x strict ES2023, Cloudflare Workers runtime,
one KV namespace (`QPROXY_KV`) + one D1 database (`QPROXY_DB`) — write-hot
state (users, usage, activity, counters, audit) in D1, settings/WARP/auth
state in KV. Single-admin single-user: no user directory, no token subs,
no quotas — D1 keeps counters/audit only. Tooling (esbuild, vitest, wrangler, playwright) is devDeps
only; `deploy.py` stays Python-stdlib-only. Panel: build-time sources in
`src/ui/panel/` (plain-concat single IIFE scope — `PANEL_JS_ORDER` is load
order, top-level function names are a cross-file contract, NEVER rename
without grepping all parts); generated `src/ui/panel.html` is NEVER edited
by hand; all user-visible strings go through `dict.js` EN+FA (`t()`), and gz
budgets are enforced by `test/ui/assets.spec.ts`. Server validation messages
remain English-only (known documented gap). Route-table changes MUST update
`docs/ARCHITECTURE.md` §3 and `test/workers/router.spec.ts` together.

## Development Workflow

`docs/ARCHITECTURE.md` frozen sections change ONLY via a dated Rev header;
`docs/decisions/` ADRs record WHY. Change patterns: setting field
(`Settings` + `DEFAULT_SETTINGS` → descriptor → panel binding + EN/FA dicts
→ validate + drift specs), emitter (format type → pure emitter → registry →
negotiation wiring → golden + UA specs → client label mirror), UI view (part
→ `PANEL_JS_ORDER` → route → dict keys → `ui-walk` step). Review checklist
for every PR: constitution principles I–VII verified, no new runtime dep, no
hard-coded address, no secret in output, goldens moved only with
authorization, typecheck + tests + (if UI) build + ui-walk green. Release via
`node scripts/release.mjs <version> [--push]` (typecheck + tests + build +
tag). CI runs `npm ci` + typecheck + tests on every push/PR.

## Governance

This constitution supersedes all other practices; conflicts resolve in its
favor. Amendments require: (a) a written proposal with rationale, (b) a
SemVer version bump — MAJOR for backward-incompatible governance/principle
removals or redefinitions (e.g. re-adding a removed protocol), MINOR for new
principles or materially expanded guidance, PATCH for clarifications/wording
— (c) updates to dependent docs (`AGENTS.md`, `ARCHITECTURE.md` Rev line,
ADRs) in the same change, and (d) a migration plan when frozen contracts
move. Compliance: every review MUST cite principles I–VII; unjustified
 complexity is grounds for rejection. Triage complete (2026-09-16) — all
verdicts above are locked; the next step is the spec breakdown, not more
governance debate.

**Version**: 1.2.0 | **Ratified**: 2026-09-16 | **Last Amended**: 2026-09-16
