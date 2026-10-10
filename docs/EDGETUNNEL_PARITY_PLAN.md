# Edgetunnel Parity — PLAN (files per batch)

Conventions: settings in `src/types/settings.ts` + `src/settings/validate.ts` + `src/settings/defaults` (DEFAULT_SETTINGS) + `src/settings/migrate.ts` (bump `SETTINGS_VERSION` 3→4 once, in B1); public masking in `src/settings/sanitize.ts` (or wherever `PublicSettings` is built — grep `SENSITIVE_SETTING_PATHS`); API routing in `src/core/routes.ts` + `src/core/router.ts`; panel parts in `src/ui/panel/*.js` (+ `PANEL_JS_ORDER` in `scripts/build-single-file.mjs` if a new part file is added — prefer extending existing parts, no new files unless >300 lines); i18n in `src/ui/panel/dict.js`; styles in `src/ui/panel/app.css`; tests mirror under `test/`.

## B1 — Subscription engine + subconverter config
- `src/types/settings.ts`: add `subName: string`, `skipCertVerify: boolean`, `subConverter: { api, config, emoji, list, udp, xudp, tls13, appendType, sort, expand }` (+ defaults in `DEFAULT_SETTINGS`).
- `src/settings/validate.ts` (+ `test/settings/*`): validators for new fields (URL, token-safe `subName`, bool coercion).
- `src/settings/migrate.ts`: `3→4` migration filling defaults.
- `src/core/ua.ts` (+ `test/core/ua*`): extend `SubFormat` with `"surge" | "quanx" | "loon"` (keep `"mixed"` as alias of `base64`? decide: `mixed` = existing base64 list response, `surge/quanx/loon` = new plain-text converter passthrough or minimal native emit if trivial, else converter-URL builder). `classifyUA` gains surge/quantumult/loon tokens + explicit `?target=`/`?clash|?sb|?surge|?loon` precedence (precedence lives in handler, tokens here).
- `src/subscription/targets.ts` (NEW, small): `resolveTarget(url, ua)` → `{ target, isConverter }`. `src/subscription/converter.ts` (NEW): `buildConverterUrl(settings, mixedUrl, target)` (never logs secrets).
- `src/subscription/render.ts` (+ `test/subscription/*`): `SUB_CONTENT_TYPES` gains `surge/quanx/loon` (`text/plain`), `renderSubscriptionBody` routes converter targets via fetch+höt-patch (UUID/HOST substitution reuse) with timeout + size cap.
- `src/handlers/subscribe.ts` (+ `test/workers/subscribe*` + `test/handlers/*`): `?target=`/`?b64`/`cnIspCode` handling, `Content-Disposition: attachment; filename=subName` for non-browser UA, `Profile-Update-Interval` header from `subUpdateIntervalHours`, quick-sub alias route (name under secure prefix, e.g. `/{securePath}/q` — exact in code; add to `src/core/routes.ts`).
- `src/core/routes.ts` + `src/core/router.ts`: new route kind/entries (no breaking changes).
- Panel: `src/ui/panel/subs.js` (per-target rows, converter status), `src/ui/panel/sections-registry.js` + `settings.js` (Advanced → converter card), `dict.js` (en/fa), `app.css` (badges only).
- Tests: `test/core/ua.spec.ts` (new tokens), `test/subscription/converter.spec.ts` (URL builder), `test/subscription/render.spec.ts` (new content types, golden unchanged for old formats), `test/workers/subscribe-targets.spec.ts` (headers, disposition, cnIspCode passthrough).

## B2 — Preferred-IP syntax + validator
- `src/nodes/preferred.ts` (NEW, pure parser): `parsePreferredLine(line): {ok,value:{kind: direct|https|sub, host?, port?, remark?, proxyIp?}}|{ok:false,reason}` + `parsePreferredList(text)` grouping `{valid[], invalid[{line,reason}]}`. Handles `IP:port#remark`, `*` wildcard (kept literal + `expandWildcard` helper marked test-only deterministic via injected rand), `sub://`, `https://`, `$proto://` chain suffix, `proxyip=true`.
- `src/types/settings.ts`: `preferredLocal: boolean` (default true), `preferredCount: number` (default 16), `preferredPort: number` (default -1), `preferredRemoteUrl: string` (default ""), keep `customEndpoints: string[]` as storage (no rename).
- `src/settings/validate.ts`: range checks (count 1–2000, port -1 or 1–65565 — note edgetunnel uses -1 sentinel + `CF_TLS_PORTS` random).
- `src/nodes/generate.ts` (+ `test/nodes/generate.spec.ts`): consume `preferred*` when building nodes (dedup, cap `maxNodesPerFormat`); `proxyip=true` entries → tag egress candidates.
- `src/handlers/api/preferred.ts` (NEW) + `routes.ts`/`router.ts`: `preferred-validate` POST `{url?, text?}` → `{valid[], invalid[]}` with fetch timeout 8s + 256KB cap.
- Panel: `src/ui/panel/subs.js` (import-preview grouping already exists — extend to new syntax), `sections-registry.js` (addresses card: count/port/remote controls), `fields-validate.js` (`host_port` extension or new `preferred_line` rule), `dict.js`, `app.css`.
- Tests: `test/nodes/preferred.spec.ts` (syntax matrix), `test/workers/preferred-validate.spec.ts` (mock fetch, caps, no secret leak).

## B3 — Proxy check + locations
- `src/handlers/api/proxy-check.ts` (NEW): `{protocol, param}` → parse via existing endpoint parser (`src/nodes/*` — reuse `host_port` logic, never throw) → `dialTcp` via `src/tunnel/egress.ts` with 10s budget → TLS → `GET /cdn-cgi/trace` → parse `ip=/loc=` → `{ok, ip, loc, responseTimeMs}`; errors → `AppError` with `param` redacted (host only, no creds).
- `src/handlers/api/locations.ts` (NEW): GET proxy `https://speed.cloudflare.com/locations`, edge-cache 1h, 1MB cap, `Cache-Control: no-store` to client? (decide: `public, max-age=3600`).
- `src/core/routes.ts`: `ApiRouteName` += `"proxy-check" | "locations"`; `router.ts` `API_ROUTES` wiring (`auth: write` for check, `read` for locations).
- Panel: `src/ui/panel/subs.js` or new `tools.js`? Prefer extend `subs.js` Utils card (no new file) — check form + result line + locations `<details>` table; lazy-Leaflet: if map wanted, inject CDN `<script>` on demand with table fallback (document in code comment why CDN-lazy is acceptable).
- Tests: `test/handlers/proxy-check.spec.ts` (redaction, timeout), `test/workers/locations.spec.ts` (caps, cache header), unit parse tests reuse B2 parser.

## B4 — CF usage + access log + TG events
- `src/types/settings.ts`: `cf: { email, globalApiKey, accountId, apiToken, usageApiUrl }` (all default ""), `cfUsage: { success, pages, workers, total, max, updatedAt } | null`, `telegram: { enabled, botToken, chatId }` += `onSubscribe, onSaveConfig, onAdminLogin: boolean` + `silent: boolean`.
- `src/settings/*`: validators (email/URL shapes, empty allowed), sanitize masks `cf.*Key|cf.*Token` + `botToken` (extend existing masking), migration defaults.
- `src/cf/usage.ts` (NEW): `fetchCfUsage(settings)` — `usageApiUrl` JSON (`{success,pages,workers,total,max}`) else GraphQL stub returning `{ok:false, reason}` when keys absent (real GraphQL only if keys present; never log keys). `src/handlers/api/cf-usage.ts`: authed refresh + cached read.
- Access log: check `src/core/counters.ts` + D1 schema (`src/settings/store.ts ensureD1Schema`) — reuse counters table if present; else `src/log/access.ts` (NEW) KV-backed with cap + dedup; `src/handlers/api/access-log.ts`: paginated `?page&limit` read (max 100/page).
- `src/handlers/api/telegram.ts` (extend): event sender honoring new toggles + `silent`; existing `setup/remove` unchanged.
- Panel: `home.js` (usage progress bar in Status card), `settings.js`/registry (CF card + TG toggles), new log viewer in `home.js` or `subs.js`? Put Log card in Home (status-adjacent) reusing `states.js` skeletons; `dict.js`, `app.css` (progress bar).
- Tests: `test/cf/usage.spec.ts` (URL-vs-keys precedence, key redaction), `test/workers/cf-usage.spec.ts`, `test/workers/access-log.spec.ts` (pagination, caps), `test/handlers/telegram-events.spec.ts` (toggle gating).

## B5 — Protocols/transports (flag-gated, additive)
- `src/types/settings.ts`: `protocolExtra` group — exact names: `trojanEnabled/trojanPassword/trojanPath`, `ssEnabled/ssMethod/ssTls`, `transport: "ws" | "grpc" | "xhttp"` (default `"ws"`), `grpcMode: "gun" | "multi"`, `grpcUserAgent: string`, `tlsFragment: "off" | "shadowrocket" | "happ"`, `zeroRtt: boolean`, `randomPath: boolean` (keep `randomizeSniCase`, add `echDns/echSni` only if trivial; else skip ECH expansion).
- `src/settings/validate.ts`: cross-field rules (e.g. trojan+ss paths must differ from `vlessPath`; `transport != ws` requires path set).
- `src/protocols/trojan.ts` + `src/protocols/shadowsocks.ts` (NEW, follow `src/protocols/vless.ts` + `common.ts` never-throw parsers) + `test/protocols/*`.
- `src/tunnel/*`: grpc/xhttp relay paths flag-gated (smallest viable: handshake + pipe reuse `relay.ts`); when `transport === "ws"` code path byte-identical.
- `src/nodes/share-uri.ts` + `src/nodes/emitters/*` (+ golden `test/nodes/*`): additive builders for trojan/ss URIs + `?ed=2560` when `zeroRtt`, fragment params when `tlsFragment != off`. Existing vless goldens untouched.
- Panel: `sections-registry.js` protocols cards (transport select, grpc fields, fragment preset select reusing `fpreset`? separate `tlsFragment` chips), `fields-validate.js`, `dict.js`, `app.css`.
- Tests per new file + `test/workers/tunnel-transport.spec.ts` (ws default unchanged, grpc/xhttp behind flag).

## B5b — Camouflage modes
- `src/types/settings.ts`: `CamouflageMode` += `"nginx" | "reverse" | "minimal"`; `camouflage: { mode, reverseUrl? }` (name: `reverseUrl: string` default "").
- `src/handlers/camouflage.ts` (+ `test/handlers/camouflage*` + `test/workers/*`): `nginx` = current static, `minimal` = tiny `1101`-style page, `reverse` = fetch upstream origin+path, rewrite text hosts, `no-store`, 8s timeout + 2MB cap, non-text passthrough.
- `src/settings/validate.ts`: `reverse` requires `https://` URL.
- Panel: `sections-registry.js` camouflage select + conditional URL field (`fields-render.js` conditional already? check — else simple show/hide in `settings.js`), `dict.js`.
- Tests: mode matrix, SSRF-ish guard (http→https upgrade? edgetunnel forces https — mirror it), cap/timeout.

## B6 — Login/admin polish (no new worker APIs except reset surfacing)
- `src/ui/login.html`: auth ping (`GET api/auth/status`, `cache: no-store`) + `sessionStorage _auth_auto_redirect` counter (max 1), `redirect: manual` login POST handling, keep lockout/TOTP/strength meter. Verify `BASE` path math unchanged; run `npm run test:ui`.
- Panel `src/ui/panel/chrome.js` + `shell.html`: expert JSON toggle modal (GET settings → textarea → PUT save with error mapping), danger reset button placement (wires existing `data-action`), footer version (`__APP_VERSION__` already in `#app-foot` — add update-dot? needs an endpoint: reuse `status` handler's version field; no external version check — dot shows `preview` when version contains `-` else `current`; document simplification vs edgetunnel's latest-check).
- Panel `cards.js`/`fields-render.js`: `help` buttons → existing modal pattern (check `m-confirm` reuse or small `m-help`), `proxyip=true` badge style in `app.css`, per-card `?` hints for ECH/pool/routing.
- `dict.js`: all new strings en+fa. `app.css`: progress bar, badges, modal additions only (no theme rework).
- Tests: `test/ui/*` (existing walk) + new `test/ui/login-guard.spec.ts`? (if harness allows DOM-less logic extraction — else cover via `test:ui` walk script extension `scripts/ui-walk.mjs`).

## Cross-batch infra (do once, B1)
- `SETTINGS_VERSION` bump + migration test.
- `src/ui/panel.html` rebuild per batch (`npm run build`), commit rebuilt file.
- `docs/CHANGELOG.md` entry per batch.
- Batch order: B1 → B2 → B3 → B4 → B5b → B5 → B6 (B5b before B5 because camouflage is small; B6 last as pure UI).
