# Edgetunnel Parity — TASKS (TDD, batch by batch)

Branch: `feat/edgetunnel-parity`. Spec: `docs/EDGETUNNEL_PARITY_SPEC.md`. Plan: `docs/EDGETUNNEL_PARITY_PLAN.md`.

## Subagent contract (paste into every batch prompt)
1. TDD mandatory: write the failing test FIRST (`test/` mirror; worker coverage under `test/workers/` through `src/worker.ts`), run it red, then implement, then green.
2. Gates per batch: `npm run typecheck`, `npx vitest run <touched>` (then full `npm test` before finishing), `npm run build` (rebuilds `src/ui/panel.html`; commit it), `node scripts/ui-walk.mjs` if login/panel touched.
3. Constraints: zero runtime deps; strict TS; named exports; parsers return `{ok|reason}` never throw; `AppError` for requests; `validateSettings→saveSettings`; mask secrets; never edit `src/ui/panel.html` by hand; new `panel/*.js` → add to `PANEL_JS_ORDER`; en+fa strings; no golden emitter change without flagging.
4. Small diffs, no drive-by refactors. Update `docs/CHANGELOG.md`.

## B1 — Subs targets + converter [ ]
- [ ] `test/core/ua.spec.ts`: surge/quanx/loon tokens + precedence cases (fail first).
- [ ] `src/core/ua.ts`: new formats + tokens.
- [ ] `test/subscription/converter.spec.ts`: URL builder (emoji/list/udp/xudp/tls13/append/sort/expand, secret-free).
- [ ] `src/subscription/targets.ts` + `converter.ts`.
- [ ] `test/subscription/render.spec.ts`: new content types; old goldens byte-identical.
- [ ] `src/subscription/render.ts`: route converter targets w/ timeout+cap.
- [ ] `test/workers/subscribe-targets.spec.ts`: `?target/flags/b64/cnIspCode`, disposition, interval header, quick-sub alias.
- [ ] `src/handlers/subscribe.ts` + `src/core/routes.ts` + `router.ts`.
- [ ] Settings `subName/skipCertVerify/subConverter` + validate + migrate 3→4 + sanitize mask test.
- [ ] Panel `subs.js` + registry + `dict.js` + `app.css`; rebuild; `test:ui`.
- [ ] Gates green + CHANGELOG.

## B2 — Preferred-IP syntax + validator [ ]
- [ ] `test/nodes/preferred.spec.ts`: syntax matrix (direct/https/sub/`*`/`$proto`/proxyip flag/invalid).
- [ ] `src/nodes/preferred.ts`.
- [ ] Settings `preferredLocal/Count/Port/RemoteUrl` + validate.
- [ ] `generate.ts` integration + `test/nodes/generate.spec.ts` delta.
- [ ] `test/workers/preferred-validate.spec.ts` + `src/handlers/api/preferred.ts` + routes (timeout+cap).
- [ ] Panel editor + preview + validator + badges + i18n; rebuild.
- [ ] Gates green + CHANGELOG.

## B3 — Proxy check + locations [ ]
- [ ] Parse reuse test (redacted errors).
- [ ] `src/handlers/api/proxy-check.ts` + routes + `test/workers/proxy-check.spec.ts` (timeout, redaction).
- [ ] `src/handlers/api/locations.ts` + `test/workers/locations.spec.ts` (cap, cache header).
- [ ] Panel Tools card (form+result+table, lazy map w/ fallback) + i18n; rebuild.
- [ ] Gates green + CHANGELOG.

## B4 — CF usage + access log + TG events [ ]
- [ ] Settings `cf/cfUsage/telegram.*` + validate + mask tests.
- [ ] `test/cf/usage.spec.ts` + `src/cf/usage.ts` (URL-vs-keys, no key logs).
- [ ] `test/workers/cf-usage.spec.ts` + handler.
- [ ] Access-log storage decision (reuse counters/D1 else KV) + `test/workers/access-log.spec.ts` + handler (pagination+caps).
- [ ] Telegram toggles + sender gating tests.
- [ ] Panel usage bar + log viewer + TG toggles + i18n; rebuild.
- [ ] Gates green + CHANGELOG.

## B5b — Camouflage modes [ ]
- [ ] `test/handlers/camouflage.spec.ts`: mode matrix + https-force + cap/timeout.
- [ ] `src/handlers/camouflage.ts` + settings `CamouflageMode` extension + validate.
- [ ] Panel select + conditional URL + i18n; rebuild.
- [ ] Gates green + CHANGELOG.

## B5 — Protocols/transports (flag-gated) [ ]
- [ ] Settings group + cross-field validation tests.
- [ ] `test/protocols/trojan.spec.ts` + `src/protocols/trojan.ts` (never-throw).
- [ ] `test/protocols/shadowsocks.spec.ts` + `src/protocols/shadowsocks.ts`.
- [ ] Tunnel grpc/xhttp flag-gated + `test/workers/tunnel-transport.spec.ts` (ws identical).
- [ ] Emitters additive + golden-unchanged proof.
- [ ] Panel cards + i18n; rebuild.
- [ ] Gates green + CHANGELOG. FLAG any golden diff explicitly.

## B6 — Login/admin polish [ ]
- [ ] `login.html` guard (counter≤1, manual redirect) — cover via walk script extension.
- [ ] Expert JSON modal + reset surfacing + help modals + badges + footer dot (simplified: `-` = preview).
- [ ] `dict.js` en+fa, `app.css` additions, rebuild, `test:ui`.
- [ ] Gates green + CHANGELOG.

## Final — review + PR + babysit [ ]
- [ ] Full `npm run typecheck`, `npm test`, `npm run build`, `test:ui` green on branch.
- [ ] `ocr_review` (if available) or manual diff review; verify no secrets, no golden drift, panel.html rebuilt.
- [ ] Squash-clean commits per batch; push; `gh pr create --base dev` with spec summary + test evidence + golden note.
- [ ] Babysit CI (`gh pr checks --watch`), fix failures, merge only if green (`gh pr merge --squash` after approval/CI).
