# Edgetunnel Parity — SPEC

Source: `E:\Code\edgetunnel\_worker.js` + `https://edt-pages.github.io/admin|/login` vs qproxy panel (`src/ui/panel/*` → `src/ui/panel.html` via `scripts/build-single-file.mjs`).

Goal: reach feature parity in the **panel + supporting worker APIs** without regressing qproxy strengths (WARP manager, kill-switch, i18n fa/en RTL, accent/theme, wizard, backup import/export, undo/redo, pool latency, traffic chart, TOTP, rate-limit, CSRF).

## Hard constraints (from AGENTS.md)

- Zero runtime npm deps. No new entry in `dependencies`. CDN `<script>` in panel only if already-established pattern (leaflet/qrcode precedent in edgetunnel) and documented; prefer no external fetch at runtime.
- Strict TS (`noUnusedLocals/Params`, `noUncheckedIndexedAccess`), 2-space LF, named exports (default only in `src/worker.ts`).
- Parsers never throw: return `{ok:true,value}|{ok:false,reason}` (`src/protocols/common.ts` pattern). Request errors → `AppError` subclasses (`src/core/errors.ts`).
- Settings flow: always `validateSettings` → `saveSettings`. `loadSettings` is 60s cached; use `loadSettingsFresh` for races. Never log/return `passwordHash/passwordSalt/sessionSecret/telegram.botToken`/UUIDs/`securePath`.
- Tests mirror `src/` under `test/`; worker tests only under `test/workers/` + `test/d1/` through `src/worker.ts`. Compat date `2026-08-01` + `nodejs_compat` must match in `wrangler.toml` and `vitest.config.ts`.
- Panel build: `shell.html` + `head.js`/`app.css`/JS parts spliced by `scripts/build-single-file.mjs` (`PANEL_JS_ORDER`). One shared IIFE scope, order matters, never rename top-level fn without grepping all parts. Never edit `src/ui/panel.html` directly. New `src/ui/panel/*.js` must be added to `PANEL_JS_ORDER`.
- **Ask before changing emitter/subscription URI output** — golden tests break on purpose. New formats/targets must be additive (`?target=` opt-in) and never alter existing `base64/singbox/clash/xray` bytes.
- Never commit `.dev.vars*`, `wrangler.local.toml`, passwords, KV dumps. No secrets for local dev.
- New UI strings need `en` + `fa` in `dict.js`, RTL-safe, `44px` coarse targets, `prefers-reduced-motion`, focus-visible, `aria-live` for toasts/errors.
- `dist/` is gitignored; `src/ui/panel.html` is git-kept generated output — rebuild it via `npm run build` and commit it.

## Batches (scope)

### B1 — Subscription engine + subconverter config
- Additive `?target=` values: `mixed` (existing base64 behavior), `surge`, `quanx`, `loon` alongside current `base64/singbox/clash/xray`. Auto-detect from `?target=` explicit > `?clash|?sb|?surge|?loon` flags > UA tokens (`surge`, `quantumult`, `loon`) > default `mixed`. Never change existing format bytes.
- New settings: `subName` (filename + `Content-Disposition` + `Profile-web-page-url`), `subUpdateIntervalHours` reuse for `Profile-Update-Interval`, `subConverter { api, config, emoji, list, udp, xudp, tls13, appendType, sort, expand }`, `skipCertVerify` bool.
- Quick-sub: `GET /{KEY}`-style token alias route → `302 /sub?token=` (naming must not collide with `securePath`; put behind existing secure prefix).
- `cnIspCode` passthrough query support on `/sub` (accepted, forwarded to converter URL, no behavior change when absent).
- Panel: Subs cards show per-target rows + copy/QR/download, converter config card in Advanced with validation + test button.
- Out of scope: running subconverter itself; we only build the upstream URL and hot-patch plain-text responses (UUID/HOST substitution already exists — keep).

### B2 — Preferred-IP (ADD.txt equivalent)
- Extend `customEndpoints` syntax (additive parser, never-throw): `IP:port#remark`, `https://…` remote list, `sub://…[#remark][?proxyip=true]`, `*` wildcard segment, `$socks5|http|https|turn|sstp://…` chain suffix in remark. Invalid lines are reported, never throw.
- New settings: `preferredLocal bool`, `preferredCount` (1–2000), `preferredPort` (-1 = random from `CF_TLS_PORTS`, else explicit), `preferredRemoteUrl` (SUB generator HOST), `proxyIpFlag` handling (`proxyip=true` entries → egress pool candidates).
- API: `GET/POST` preferred-list equivalent of `admin/ADD.txt` (name TBD under existing `api/` namespace) + `getADDAPI`-style validator endpoint that fetches a remote URL and previews parsed entries (timeout + size cap, no secrets logged).
- Panel: endpoints editor with import-preview (valid/invalid grouping), count/port controls, validator button, `proxyip=true` badge.
- Out of scope: per-ISP `ct/cu/cmcc` CIDR generation (defer; note as follow-up).

### B3 — Proxy check + locations
- New authed `api/` endpoint `proxy-check`: input `{protocol: socks5|http|https|turn|sstp, param: user:pass@host:port}` → dials `cloudflare.com:443` via existing egress dialer, `GET /cdn-cgi/trace`, returns `{ok, ip, loc, responseTimeMs}`. Bounded timeout, never leaks credentials in logs/errors.
- New authed `api/` endpoint `locations`: proxies `https://speed.cloudflare.com/locations` (cache 1h, size cap). No map JS dependency vendored; panel renders a lightweight list + optional Leaflet via CDN only if user opens the modal (lazy `<script>` injection, offline-safe fallback to table).
- Panel: Tools card with single-proxy check form + result, locations browser.
- Out of scope: vendoring Leaflet; full world-map polish is follow-up.

### B4 — CF usage + access logs + TG events
- New settings: `cf { email, globalApiKey, accountId, apiToken, usageApiUrl }` (masked on read like `botToken`), `cfUsage { success, pages, workers, total, max, updatedAt }` cached.
- New authed `api/` endpoints: `cf-usage` (manual refresh via GraphQL or `usageApiUrl`, never logs keys), `access-log` (paginated read of KV/D1-backed request log — storage TBD: prefer D1 counters table if exists else KV with 4MB cap + 30min dedup for `Get_SUB`-class events).
- Telegram: extend existing setup/remove with per-event toggles (`onSubscribe, onSaveConfig, onAdminLogin`) reusing `api.telegram.org` sender; `OFF_LOG`-equivalent `telegram.silent` flag. Never send secrets/UUIDs.
- Panel: Usage card with progress bar (`used/max %`), `Subscription-Userinfo`-style hint, log viewer card (paginated table), TG event toggles.
- Out of scope: exact edgetunnel GraphQL query parity if API shape differs; document what we query.

### B5 — Protocols / transports (largest, riskiest)
- Settings (all default-off, additive): `protocol: vless` stays canonical; add `trojan { enabled, password, path }`? and `ss { enabled, method, tls }`? — exact shape decided in plan; `transport: ws` canonical + `grpc { mode: gun|multi, userAgent }`, `xhttp { mode, extra }`; `tlsFragment: null | { preset: Shadowrocket|Happ }`; `zeroRtt bool` (`?ed=2560` in path); `randomPath bool`; `skipCertVerify bool` (shared with B1); ECH already exists (`echEnabled/echAuto/echServerName`) — add `echDns` + `echSni` only.
- Worker: trojan/ss handshake + grpc/xhttp uplink/downlink only behind flags; when flags off, byte-identical behavior (golden tests must pass unchanged).
- Emitters: extend URI builders additively for new protocols; existing `vless://` output immutable without explicit user approval (per AGENTS.md boundary — implement behind `protocol` selection so default output is unchanged; note any golden update in PR description).
- Panel: Protocols cards for new selects/toggles with help modals; transport path preview.
- Out of scope (explicit): full `PROXYIP` env semantics, `GO2SOCKS5` env; keep `proxyIps/proxyIpPoolUrl` model.

### B5b — Camouflage modes
- Extend `camouflage.mode: off | static` with `nginx` (default static page) + `reverse` (custom URL reverse-proxy with host replace, text-only rewrite, `Cache-Control: no-store`) + `minimal` (`1101`-style tiny page). Exact names decided in plan.
- Panel: select + URL field (visible only for `reverse`) with domain validation.

### B6 — Login/admin polish
- Login: auth auto-redirect guard (`HEAD` authed ping with `sessionStorage` counter, max 1 auto-redirect), `redirect: manual` handling so valid-cookie POST doesn't misreport "wrong password", caps-lock hint? (small), keep TOTP + lockout behavior.
- Admin chrome: expert/raw-JSON toggle (read `settings-get`, edit JSON, `settings-save` with validation errors), `settings-reset` confirm already exists — surface as prominent danger button, version footer with update-dot states, `?`-hint help modals for ECH/pool/routing cards, HOSTS/`proxyip=true` badges. No UUID easter-egg/fireworks (explicitly out — noise).
- Out of scope: IR geo modal, BPB redirect, background-iframe camouflage on login.

## Acceptance (per batch)
- TDD: failing `vitest` test first (`test/` mirror), then implementation, then `npm run typecheck` + `npx vitest run <batch>` + `npm run build` (panel drift check) green.
- Worker batches need `test/workers/` coverage through `src/worker.ts`.
- No golden emitter output change unless documented + approved in PR.
- `src/ui/panel.html` rebuilt, `node --check` passes (build does it), `test:ui` walk passes if touched login/panel.
- Docs updated (`docs/CHANGELOG.md` entry per batch).
