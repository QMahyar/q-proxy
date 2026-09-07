# Q Proxy Admin Panel — Deep UI Audit (Final Report)

**Scope:** entire panel UI (`src/ui/panel/*`, `src/ui/login.html`, `src/ui/camo.html`) assembled into `src/ui/assets.ts`; read-only.
**Input:** `.pi/ui-audit/audit-findings.json` — 17 dimension blocks, **239 findings** (6 critical / 47 high / 95 medium / 91 low raw; several cross-dimension duplicates). Every headline finding was spot-checked against live source during report writing and confirmed.
**Owner pains:** (1) WARP buried in Settings subtabs — **confirmed in 8 dimensions**; (2) main sub links not reachable — **largely refuted** (Home is the best-served object in the panel) but everything *around* the link rots; (3) Users page purposeless when empty — **confirmed in 9 dimensions**.

---

## 1. Executive summary — ten harsh verdicts

1. **The best interaction engineering in this product genre hangs on an inverted skeleton.** A two-tab shell (`shell.html:43-44`) hides the panel's two entity products — Users and WARP — as subtabs #9 and #10 of a 10-pill settings strip behind a mobile fade mask. The dictionary still ships a dead `nav.warp:'WARP'` key (dict.js:3, zero references) proving a top-level design existed and was demoted without cleanup. The single cheapest high-impact fix (promote two tabs, back-compat redirects) is an IA decision that has already been made once — and reversed — leaving fossils in two languages.
2. **Two shipstopper bugs sit in the core flows.** The Users table column headed "Subscription URL" *can never render a URL*: `users.js:10-15` branches on `u.token`, which the hashed-token API contract provably never returns on list rows, so every row permanently shows the toast string "New token ready" as a cell. And `securePath` renders, confirms and redirects as if it saves (`settings.js:33,478-485`) while `handleSaveSettings` strips it server-side (`api/settings.ts:63`) — an admin who rotates the panel path is dumped on a URL that never becomes real.
3. **The light theme fails WCAG at every semantically loaded pixel.** Success ≈1.9:1, warning ≈1.7:1, danger ≈2.8:1, hints/table headers ≈2.5:1, and empty-state titles are hardcoded `#e5e7eb` — **≈1.1:1, literally invisible on white** (`app.css:228`) — on exactly the screens (empty Users, empty subs) that have nothing else to look at. Three CRITICAL failures close with ~4 lines of CSS tokens.
4. **Destructive actions are guarded inconsistently — and the panel knows better.** Reset-to-defaults confirms; **settings import overwrites the entire config with no confirmation** (`actions.js:46-62`), **WARP preset delete is a one-click 16px X** (`actions.js:117-124`), and the Discard bar **silently destroys every unsaved section** (`actions.js:44-45`). Bulk-user confirm never even names the action being confirmed ("3 selected" / "Apply to 3 user(s)?").
5. **The bundle is an archaeology site.** ~64–70 dead dict keys (13.4% of 523) — two entire removed features (IP Checker, Ports/CDN) fully translated in EN **and** FA — plus a dead `ports` renderer branch, orphaned `#i-play`/`#i-stop` SVGs, a checker-targets special case in shared validation code, and a **Ctrl+K shortcut advertised in the shortcuts modal that focuses a `#settings-search` element that exists nowhere in the DOM** (`chrome.js:79`). The dead-key guard blocklists 16 historical keys instead of detecting new ones.
6. **The sub URL is the product, and the UI treats it as furniture.** Six scattered surfaces (Home rows, wizard step, WARP detail, users token cell, info page, UA auto-negotiation), none complete; per-user per-format variants already exist server-side (`routes.ts:74-80`) with zero UI; the browser-facing "Panel info" page renders as an importable subscription row *with a QR button*; format labels are triplicated with inconsistent naming ("Base64/Mixed" vs "Base64 / v2rayNG"); sub-URLs go stale after a protocols-only save (`settings.js:481`).
7. **The Users page is a write-only CRUD shell that defeats its own purpose.** Expiry, quota (`todayHits`/`dailyReqLimit`), protocol scope, token hint, and a whole `/activity` endpoint exist server-side and are withheld; the zero-user state is one gray line inside a dead 6-column table while the same codebase ships a proper icon/title/CTA empty-card twice elsewhere (WARP, Home subs). "Daily request limit" labels a **subscription-download quota, not traffic** — the copy never says so.
8. **WARP has the worst reach/depth ratio in the panel.** Five interactions from login to a usable config; the 17-format deliverable is card #4 *behind the raw subscription token*; failed loads render three silent blank cards with no retry; the 17 formats are an ungrouped dump with a bare download icon on every row; and the endpoint preset select **lies about state on custom-endpoint accounts and can silently destroy typed-in endpoints with one stray scroll-wheel click** (`warp.js:75`, `actions.js:396`).
9. **The interaction layer is a tale of two codebases.** Optimistic toggles with rollback, per-field server-error mapping, focus traps, and best-in-category RTL mirroring — next to: undo that doesn't work inside the inputs you edit and pushes the *post*-edit state; half the mutations without double-submit protection (section-save disables the *wrong button*); copy-to-clipboard that reports success unconditionally; dirty-tracking that re-collects and JSON-stringifies all ten hidden panels on every keystroke; and 258 KB shipped raw under `Cache-Control: no-store` with no ETag (`panel-page.ts:9`) while esbuild's minifier sits unused in the same build script.
10. **The bilingual ambition is genuine and leaks at every seam.** 523/523 EN/FA parity is the strongest i18n in the category — and yet ~30 user-visible strings bypass the dict entirely (17 WARP format labels, 22 Amnezia parameter labels duplicated across two arrays, shell skip-link/aria-labels/noscript), all ~50 server validation errors arrive as English prose the client's `err.*` translation bridge can never fire on, the FA default is hardcoded with no `navigator.language` detection (first paint is Persian for everyone), and a single `dir="ltr"` on the ECH preview renders Persian text backwards.

---

## 2. Scorecard

| # | Dimension | Verdict | Worst finding |
|---|-----------|---------|---------------|
| 1 | i18n census (EN/FA dict) | **Healthy parity, corpse layer on top** | `err.*` contract vestigial — every failed save shows raw English prose in a Persian-default panel (high) |
| 2 | Inventory / screen map | **Inverted skeleton; correct furniture in the wrong house** | WARP + Users as settings subtabs #9/#10 behind a 2-tab topbar (high) |
| 3 | Field census (UI vs fields.ts) | **Registry discipline real; two zombies and one broken control** | `securePath`: UI fakes a complete save flow the server strips — admin-trap (**critical**) |
| 4 | Users page purpose | **Write-only CRUD defeating its purpose** | Token column can never show a URL; "New token ready" toast reused as a permanent cell (**critical**) |
| 5 | IA & navigation | **Excellent interaction on the wrong structure** | Ctrl+K advertised in the shortcuts modal focuses an element that does not exist (high) |
| 6 | Visual design (light/dark/EN) | **Dark theme competent; light theme fails WCAG everywhere it matters** | Empty-state title `#e5e7eb` ≈1.1:1 on white — invisible (**critical**) |
| 7 | Mobile & responsive | **Rare responsive layer, desktop-first patches** | Topbar utility cluster never reflows: 375px overflows, 320px breaks (high) |
| 8 | FA / RTL | **Best bilingual/RTL implementation in category; per-node escapes** | ECH live preview hardcoded `dir="ltr"` renders Persian backwards (high) |
| 9 | WARP UX | **Consumer surface treated as config afterthought** | Preset select lies about state and can silently destroy custom endpoints (high) |
| 10 | Subscription delivery | **Strong backend, roughly half exposed, no hub** | No Subscriptions hub: the product is scattered across 4 surfaces, none complete (high) |
| 11 | Copy & microcopy | **Strongest asset in the panel, rotting at the edges** | Settings import = full config overwrite with zero confirmation (high) |
| 12 | First-run & onboarding | **Scripted happy path solid; every fork punished** | Self-service setup forces an immediate *second* password change for a passphrase the human chose (high) |
| 13 | Accessibility (WCAG 2.2 AA) | **Strong baseline, not conformant — the hard 20% never finished** | Modal validation errors are silent to screen readers: no live region, no focus move, toast suppressed (**critical**) |
| 14 | Polish & product feel | **Engineering above rivals; product shell betrays it** | IA buries the two entity domains as subtabs 9/10 (high) |
| 15 | Interaction patterns | **Real craft; busy/loading/undo degrade to bare text and dead combos** | Discard bar destroys ALL unsaved sections with no confirmation (high) |
| 16 | Settings field-by-field | **Drift-free registry; three write-only settings and bimodal label quality** | `localDns` and the entire Sources subtab save values nothing consumes (high) |
| 17 | Code organization & performance | **Best architecture in genre; zero dead-weight or perf pass ever run** | 258 KB panel shipped unminified, `no-store`, no ETag — compressor already in the build script (high) |

---

## 3. Findings by dimension

Severity: **C** critical · **H** high · **M** medium · **L** low. Effort: S ≤ ½ day, M 1–3 days, L > 3 days. "[dup → §n]" = same root cause catalogued elsewhere.

### DIM 1 — i18n census (dict coverage, unused keys, hardcoded strings) — 12 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| L | **Parity is 100%** (positive) | `dict.js:3` EN 523 keys, `:20` FA 523 — programmatic diff: 0 missing either way; safe fallback `dict.js:39` | Keep; add 3-line test asserting `Object.keys(en) === Object.keys(fa)` | S |
| M | **70/523 keys (13.4%, ~6.8 KB) are dead** — removed IP-checker + Ports/ProxyIP tabs | `dict.js:3-40`; `checker.*` ×19, `ports.*` ×17, `proxyip.*`, `nav.warp`/`nav.checker`, `warp.view.*` … zero `t()` refs | Delete all ×2 languages; extend dead-key guard (`test/ui/assets.spec.ts:179`) to computed "every key referenced" | S |
| H | **`err.*` contract vestigial** — server sends English prose the bridge can never translate | `settings.js:510-515` bridge vs `validate.ts` ~77 prose strings at 50 `fail()` sites; 4 of 10 `err.*` keys dead | Decide once: (a) server emits `err.*` codes + FA batch, or (b) delete bridge + dead keys and stop pretending. (a) is the professional choice | L |
| M | **Two hand-maintained dicts** duplicate 12 keys verbatim | `login.html:128-129` (43 keys) vs `panel/dict.js` — `common.reveal/hide/close/theme*`, `toast.networkError`, `app.name`… | One shared catalog consumed at build time by both pages | M |
| L | **17 WARP format labels hardcoded EN** — biggest dict bypass | `warp.js:2` `WARP_F`, rendered `warp.js:96`; '(ZIP)', 'legacy', '(base64)' are prose | `warp.fmt.*` dict keys; generate WARP_F from `src/warp/formats/registry.ts` | S |
| L | **Amnezia labels duplicated in two arrays; I1 dict-keyed, the other 10 not** | `warp.js:66` `AMZ` vs `:81` `AMZK` identical 11 rows; `warp.amnezia.i1` exists | One module-level `AMZ_FIELDS` with dict-keyed labels | S |
| L | **"Panel info" magic string shared server→2 clients, untranslated in FA** | `status.ts:54` label; filters at `home.js:90`, `actions.js:544` | Server-declared kind/flag; client maps to dict label | S |
| M | **Static a11y strings stay English in FA**: skip link, 2 aria-labels, noscript | `shell.html:19,53,67,83`; `login.html:121` | `a11y.*` keys set in `buildShell()` | S |
| L | **`home.status.total` dead; Requests-total number renders unlabeled** | `home.js:120` vs dict key — RTL readers can't tell today from lifetime | Wire the existing key | S |
| L | **No unused-key detection** — guard only blocklists 16 historical keys | `test/ui/assets.spec.ts:179-194` | Computed coverage test scanning `t()` usage; retro-catches everything here | S |
| L | **Default language hardcoded `fa`**, no `navigator.language` | `dict.js:37`, `head.js:1` `\|\|'fa'`; EN admin's first paint is Persian | `navigator.language` sniff or document the owner-first choice | S |
| L | **Zero used-but-missing keys** (positive) | All dynamic families (`tabs.settings.*`, `accent.*`, `users.status.*`) resolve | Nothing — keep descriptor pattern | S |

### DIM 2 — Inventory / screen map (IA of record) — 16 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **WARP + Users are subtabs #9/#10 behind a 2-tab topbar** (pain 1) | `shell.html:43-44` = whole nav; `settings.js:124-125`; dead `nav.warp` proves a cut 4-tab design | Restore top-level `#/warp`, `#/users` tabs with redirects | S |
| H | **Users empty state is one hint row in a dead table** (pain 3) | `users.js:29` vs `.empty-card` used at `warp.js:61` + `home.js:100` | Reuse `.empty-card` with 'Create first user' CTA; hide table chrome at n=0 | S |
| M | **Whole IP-Checker feature lives as dead strings + 2 code fossils** | `checker.*` ×20 ×2 langs; `settings.js:564` checker-targets branch; `lib.js:3` `MAX_TARGETS` | Delete namespace + branch + constant | S |
| M | **Dead 'ports' renderer with no data model** | `settings.js:222-227` `case 'ports'`; `updatePortMasters` :344; zero `type:'ports'` FL fields | Delete case + helpers + `ports.*` keys | S |
| M | **Stale subtab names match no section key** | `tabs.settings.ports`/`proxyip` vs live `addresses`/`egress` (`settings.js:71,80`) | Purge + add SECTIONS↔dict drift test | S |
| M | **UI identifies server row by magic-string label** | `home.js:90` filters `label!=='Panel info'` against `status.ts:54` | Server-side format/kind discriminator | M |
| M | **`#/settings/warp/<id>` has zero nav entries; unknown hashes silently rewrite to General** | `home.js:59-60` silent coercion; reachable only via card hover or transient redirect | Breadcrumb + "not found" notice instead of silent rewrite | S |
| L | **Ctrl+K targets a search field that does not exist** (dup → §5.1) | `chrome.js:79` + advertised `chrome.js:40` | Build palette (~40 lines) or delete row+handler | S |
| M | **Two parallel save affordances, one a no-op on most sections** | per-section Save `settings.js:318` vs applybar `shell.html:71`; no-op on users/warp/sources (`:477`) | One model; never render Save on fieldless sections | M |
| M | **Sources 'Helpers' buttons write results into a hidden panel** | `warp.js:10-12` actions → `#pool-list` exists only in Egress panel; 'source-doh' duplicates 'pool-fetch' | Render inline or remove; one parametrized action | M |
| L | **Proxy pool rendered by two divergent copy-paste renderers** | `home.js:159-172` (top-8, no meta) vs `warp.js:21-47` (top-16, sorted, add-button) | One `renderPoolInto(box,{limit,showActions})` | S |
| L | **Users data fetched/rendered by two independent paths**; Home WARP DOM balloons 7+17×N | `home.js:165-172` vs `users.js:26-34`; `warpSubsHtml` per-account details | Single loader + collapsed link-chips | S |
| L | **'Requests total' unlabeled — its dict key is dead** (dup → §1) | `home.js:120` | Wire `t('home.status.total')` | S |
| L | **Language switcher exists twice** (topbar + General) | `shell.html:46` vs `settings.js:36,253-255`; third copy in boot `actions.js:527-530` | Keep topbar; delete General field | S |
| M | **settings.js is a 48 KB / 621-line monolith** — registry + 13 renderers + TOTP crypto + user modal + section IO | `settings.js:30-126, 273-300, 362-470` | Split at existing joints: sections/fields-render/totp/section-io | M |
| L | **~100 dead keys ship both languages; dict never per-language-split** | dict.js 65 KB concatenated, both langs always | Drift test; consider emitting active language only | S |

### DIM 3 — Field census (UI vs `src/settings/fields.ts`) — 9 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **Census headline is healthy** (positive) | 76 descriptor paths vs 68 FL paths; diff = 1 documented pseudo-field (`__privateDoh`) + 9 justified API-managed rows; drift-tested 19/19 | Update AGENTS.md's stale "66 leaf fields" claim | S |
| **C** | **`securePath` is a dead control that fakes a complete save flow** | `settings.js:33` renders gen+copy+confirm; `:478-485` confirm + success redirect; `api/settings.ts:63` **deletes the key**; `routes.ts:60-62` still honors a value nothing can set | (a) honor via dedicated mutation endpoint, or (b) delete control + confirm keys + redirect; show read-only path. (b) ≈ 30 min | M |
| M | **`language` is a zombie registry entry** — renders in General, writes only a cookie | `settings.js:39` no `data-bind`; `actions.js:398` cookie+reload; `settings.language` never persisted from panel | Drop from registry (topbar is the control) or make it bind | M |
| M | **Client-side pre-validation covers 8 of ~55 editable paths** | `SCALAR_RULES` (`settings.js:573-576`): 4 num, 2 uuid, 1 domain, securePath | Generate rules from `SETTING_FIELD_DESCRIPTORS`; extend drift test | M |
| M | **Same-looking list fields have three invalid-line behaviors** — silent drop (proxyIps/nat64), hard fail (remoteSubUrls), validate-anything (allowedIps/alpn) | `validate.ts` `sanitizeStrArray` vs `urlListField`; identical UI rendering `settings.js:82-84,229` | One policy per family; surface dropped-line counts; relax client url validator to accept http:// | M |
| M | **Dead 'ports' branch + ~44 orphaned keys ×2 langs** (dup → §2.4) | `settings.js:222,405,429,564` | One removal pass + reverse dict-drift assertion | S |
| L | **Dead validation metadata**: `vtype:'url'` consumed by nothing | `settings.js:85` vs `SCALAR_RULES` builder `:573-575` | Register `{kind:'url'}` (3 lines) or remove annotation | S |
| L | **Descriptors without UI are all justified** (positive) | password/seed/totp ×8 verified against dedicated flows (`fields.spec.ts:12`) | Document `API_MANAGED_PATHS` | S |
| L | **AGENTS.md says "66 leaf fields"; table has 76** | AGENTS.md Architecture Map | Update or de-number | S |

### DIM 4 — Users page purpose — 12 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| **C** | **Token column can never show a URL** — dead branch against hashed-token API; per-row copy/QR never render; cell shows toast text forever | `users.js:10-15` `u.token?…` vs `api/users.ts:188-201` + `test/users/api.spec.ts:115` "create exposes the full token" only | Render `tokenHint` with explicit state; delete dead branch; make rotate a first-class re-issue via `#m-rot` | M |
| H | **Zero-user state is one muted line in a bare table skeleton** | `users.js:29` 'No users yet' + select-all chrome; contrast `warp.js:61`, `home.js:100` | `.empty-card` + 'Create first user' CTA; mention 50-user capacity | S |
| H | **The table withholds nearly everything the API already sends** — no expiry, no limit value, no today count, no protocol scope, no override badge | `api/users.ts:188-191` sends all of it; `userChip` (`users.js:3-6`) collapses to 4 states; `todayHits` fetched then used only in `>=` | Expiry countdown, "23/100 today", protocol chips, override badge; merge redundant Enabled column | M |
| H | **'Daily request limit' is a subscription-download quota, not traffic — copy never says so** | `users-sub.ts:77-84` consumes on sub fetch only; hourly auto-refresh burns 24/day; tunnel traffic consumes zero | Relabel "Daily subscription fetch limit" + reset semantics (00:00 UTC) in both locales | S |
| M | **Per-user activity feature is triple-dead** — `/activity` endpoint has zero UI callers; `bytesUp/bytesDown` written by nothing; sparkline data unusable | `api/users.ts:175-180`; sole write `store.ts:818` `requests:1` | Wire a per-user detail view or delete the dead byte plumbing | M |
| M | **Create shows the token exactly once, no URL text, no 'shown once' warning**; clipboard failure has no feedback | `actions.js:493` fire-and-forget `copyText` + `#m-qr` (no URL field) vs `#m-rot` which has the right pattern | Route create through the rotation-style share sheet | S |
| M | **Address-override drift: UI sends a strict subset of the API** — `host`/`sni` overrides are API-only; editing out-of-band overrides makes them vanish on save | `shell.html:77` + `actions.js:489-492` vs `api/users.ts:90-113` | Add host/SNI inputs or drop from API | S |
| M | **Users is subtab #9 with no per-user detail route** while WARP accounts got deep links + a detail renderer | `settings.js` SECTIONS; `showSection` has no users branch | Top-level Users view; per-user detail mirroring WARP pattern | L |
| L | **Dead 'Apply changes' bar on Users/WARP/Sources** — injected section-save silently no-ops | `settings.js:318` + `:477` empty patch return | Skip bar for card-based sections | S |
| L | **Bulk can set but never clear expiry**; no bulk protocol/limit edits though server would accept clearing | `actions.js:153` requires `v`; `parseBulkOp` accepts `expiresAt:null` | Add 'Never (clear)' option; extend or document | S |
| L | **No search/sort/filter for up to 50 rows; no capacity indicator; 50-cap surfaces as raw English error** | `api/users.ts` POST `MAX_USERS`; no search UI | "7/50 users" chip + status filter + name search (client-side over `S.users`) | S |
| L | **Modal validation gaps**: empty protocol pick submits `[]` → raw English server text; limit 0/10001+ likewise | `actions.js:482-496` | Client guard + localized error before submit | S |

### DIM 5 — Information architecture & navigation — 10 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **Advertised Ctrl+K search is a dead affordance** | `chrome.js:79` queries `#settings-search` — grep: zero occurrences anywhere; `chrome.js:40` advertises it | Build the palette (10 subtabs need it) or delete row+handler | M/S |
| H | **Users + WARP: entity CRUD wearing a settings costume, past the mobile fade mask** (dup → §2.1) | `settings.js:124-125` zero-field entity cards; instant-PUT actions bypass the snapshot/apply contract | Promote to top-level tabs + back-compat redirects | M |
| H | **Users empty state bare** (dup → §4.2) | `users.js:29` | `.empty-card` + Add-User CTA + Home card button | S |
| M | **First WARP config costs 5 actions + burrow; Home shows zero WARP affordance until an account exists** | `home.js:98` gates on accounts.length; `actions.js:461,467` hard-jump into Settings | Home WARP chips + 'Set up WARP' empty CTA; land on `#/warp/:id` | M |
| M | **Home sub-URLs go stale after a protocols-only Apply** — the exact CTA path the empty state pushes | `settings.js:481` refreshes only for general/addresses; `S.subs` written only by bootstrap | Extend refresh to `protocols` | S |
| M | **'Panel info' HTML page mislabeled as a subscription format, ranked last of 7 identical rows** | `status.ts:93-101` appends `?view=html` entry; `home.js:97` renders all rows equal | Distinct link row ('Open info page ↗'), not a copy-field | S |
| M | **Regenerate-token does not auto-copy; user-create does** — the *destructive* flow is the weaker one | `actions.js:493` vs `actions.js:144` | Copy before `showRotation` on regen too | S |
| L | **~40 dead i18n keys from prior IA iterations** (dup → §1.2) | dict.js both langs | Purge + drift test | S |
| L | **Silent route coercion**: unknown subtab → General, unknown hash → Home, Settings tab hardcodes general | `home.js:55-61`; `shell.html:44` | sessionStorage last-section + toast on coercion | S |
| L | **Wizard is one-shot, un-reopenable, and step-1 CTA closes the wizard while navigating** | `actions.js:545,549` inline onclick clicks wiz-skip → sets `qp_wizard_done` | Navigate without dismissing; add Escape + 'Replay setup guide' | S |

### DIM 6 — Visual design (light/dark/EN) — 14 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| **C** | **Light theme never re-derives status colors** — success #34d399 ≈1.9:1, warning #fbbf24 ≈1.7:1, danger #f87171 ≈2.8:1 on white; applybar label, field errors, kill-switch chips, pool glyphs all fail | `app.css:5` block remaps neutrals only; consumers `:91,201,206,210,211,270` | `--success:#059669;--warning:#d97706;--danger:#dc2626` in light block (~4 lines) | S |
| **C** | **`--text-faint` and `--text-ghost` collapse to the same #94a3b8** (~2.5:1) — field hints (highest-frequency text), table headers, metadata | `app.css:5`; consumers `:90,104,173,190,203,229,244,298` | `--text-ghost:#64748b`, `--text-faint:#475569` | S |
| **C** | **Empty-state title hardcoded `#e5e7eb`** — ≈1.1:1 in light; light override fixes only the container | `app.css:228`; `:17` | `color:var(--text)` + light icon tint | S |
| H | **Accent switching silently half-broken in light mode** — cascade forces the cyan ramp over every chosen accent; Violet in light = cyan buttons in violet tints | `app.css:2-4` data-accent blocks vs `:6` light `--cyan` override, equal specificity, later wins | Derive ramp from `--accent-rgb` per theme or scope the light override | M |
| H | **The 4 accent swatches are noise with semantic cost**: green accent = `--success` exactly, amber = `--warning`; swatch previews misrepresent applied color | `app.css:1,3,4,56-59`; collision surface `:206-212` | Cut to one brand accent, or pick non-colliding hues + token-generated swatches | S |
| H | **`.token-panel` borders with undefined `var(--line)`** → border-color = currentColor, full-strength text-colored border on the WARP token panel, both themes | `app.css:246` (no fallback; `:216` uses fallback form) | Define `--line:var(--border)` or use `var(--border)` | S |
| M | **Hardcoded white-alpha chrome invisible in light**: `.seg`, `.subtab`, `.stat-chip` lose containers | `app.css:154,197,78`; light overrides only `:7-20` | Tokenize onto `--surface/--surface-2` | S |
| M | **Type/radius scales defined then abandoned**: `--fs-xl`/`--r-sm`/`--r-lg` 0 uses; card titles 2px above body; 6 distinct radii | `app.css:1` vs `:62,63,197,228,229`; login `--fs-2xl` | Bind to tokens; add `--fs-2xl:24px`; collapse radii | M |
| M | **No spacing scale exists** — orphan `var(--s-4,16px)` proves it was planned and dropped; rem/px zoom story inconsistent | `app.css:40`; paddings 4–48px magic numbers | `--s-1…--s-6` sweep; pick px or rem | L |
| M | **False hover affordance + ornament overload**: static cards lift/glow; spinring + button shine + 2 drifting blobs + noise + gradient title stack | `app.css:66,31-35,41-43,116-118` | Delete lift on non-clickable cards, spinring, shine; tie blobs to accent | S |
| L | **Icon sprite drift**: dead `#i-play`/`#i-stop`; mixed stroke widths 2.5/2; data-URI chevron; 9px help glyph | `shell.html:31-32,26,29`; `app.css:100,106` | Delete dead symbols; normalize strokes; token-color chevron | S |
| L | **18px swatches / 14px help triggers fail WCAG 2.5.8** on fine pointers | `app.css:53,99` | 24px hit areas | S |
| L | **`--ring` (and 4 more tokens) defined in both themes, never used** — focus rings hardcoded with mismatched .7/.65 alphas | `app.css:1,5` vs `:25,143,165` | Use `var(--ring)`; delete dead tokens | S |
| L | **Dark elevation nearly flat**: 3% white cards on #05080f with 6% borders; nested surfaces out-contrast parents | `app.css:1,63` | `--surface:.045`, `--border:.08`, `--surface-2:.07` | S |

### DIM 7 — Mobile & responsive — 10 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **Topbar utility cluster never reflows**: 4 decorative 18px swatches + lang seg + 3 icon buttons ≈ 20% of a 375px viewport; 320px risks sideways scroll | `shell.html:46-56`; only mobile rule `app.css:303` wraps tabs | Hide `.swatches` ≤767px; collapse icons into overflow menu | M |
| H | **44px touch sweep misses the actual chrome**: 18px swatches, 32px subtabs (only nav to 10 sections), 34px tabs, 28px toast close, 34px back | `app.css:53,197,48,291,260,302` | Extend the `:302` block with `.swatch/.subtab/.tab/.toast__close/.back-btn/.seg` | S |
| M | **Worker-status stat-grid mispairs on mobile**: unlabeled spacer cells shift every label one cell right | `home.js:120,174` triplets vs `app.css:297,303` | Hide spacers with `.h-cell` or restructure to a dl | S |
| M | **QR modal is a dead end on a phone**: no copy, no URL text, no enlarge, canvas clamped 64vw, fixed DPR | `shell.html:72` + `qr.js` | Copy + `navigator.share` + DPR-correct canvas + tap-to-fullscreen | M |
| M | **`env(safe-area-inset-*)` is dead code** — 3 rules written for notches, viewport meta lacks `viewport-fit=cover` | `shell.html:5` vs `app.css:267,273,280` | Add `viewport-fit=cover` to shell+login | S |
| M | **Users table cardification works, but select-all lives in the hidden thead** → bulk mode half-usable; 6 stacked labeled blocks per row | `users.js:8,11-17` vs `app.css:303` | Move select-all into bulkbar; `overflow-wrap:anywhere` on URL cell | S |
| L | **Subtab rail (the de-facto mobile nav) never sticks** | `app.css:192-197` no sticky | `position:sticky` under topbar ≤767px | S |
| L | **Unconditional 28px fade mask ghosts the last top tab** — with exactly 2 tabs it can never scroll | `app.css:194-196` both `.tabs` and `.subtabs`, LTR+RTL | Apply only on actual overflow (JS toggle) | S |
| L | **No landscape/short-viewport handling, no `hover:none` guards, tablets keep phone home layout** | breakpoint inventory `app.css:61,64,73,232,274,300-303` | One landscape rule + `@media(hover:hover)` guard | M |
| L | **What already works** (positive): 16px inputs kill iOS zoom, dvh bottom-sheets, `data-l` table labels, RTL scroll fades | `app.css:302,273-274` | Preserve; don't "simplify" the `.input` dual-class trick | S |

### DIM 8 — FA / RTL — 11 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **ECH live preview hardcoded `dir="ltr"` renders Persian backwards** — trailing parenthetical stranded, colon misplaced | `settings.js:192` vs FA strings; `country.hint` does it right with `dir="auto"` | `dir="auto"` + `<bdi>` around hostname | S |
| H | **Requests-total renders with NO label; its FA string exists, orphaned** (dup → §1.9) | `home.js:120` | Add the label cell | S |
| M | **~88 dead keys per language**, incl. an entire unwired `checker.*` module (dup → §1.2) | dict.js both blocks | Purge + drift test | S |
| M | **Four hardcoded English strings survive the FA panel**: skip link, lang group label, subtabs tablist, noscript | `shell.html:19,53,67,83` — buildShell retro-localizes everything else | Bind the stragglers in buildShell | S |
| L | **Digit policy split-brain**: FA prose uses Persian digits, every JS-rendered number is Latin | dict FA strings vs `home.js:120,167`, `warp.js:67` | One documented rule; `faNum()` helper or convert stragglers | M |
| L | **Dates/times obey the browser, not the panel language**; raw ISO fragments in RTL prose; no Jalali (fine — document it) | `warp.js:28,59` | `Intl.DateTimeFormat('fa-IR'/'en-US')` helper | M |
| L | **No Persian webfont loaded** — Vazirmatn aspirational; Tahoma-class fallback; 1.5 line-height cramped at 11–12px hints | `app.css:1,23` | Self-host Vazirmatn woff2 (~90 KB) or bump `[dir=rtl]` line-heights | M |
| L | **WARP accordion marker '▸' not mirrored in RTL** | `app.css:257` vs mirrored `.back-btn` `:263` | `[dir=rtl]` variant | S |
| L | **FA microcopy drift**: 'Shadowsocks' transliterated once, two 'resolver' terms, ECH label over-long | dict.js FA block | One-terminology sweep in one FA diff | S |
| L | **Latin-typography styling dead-codes on FA**: uppercase + .08em tracking on table headers | `app.css:223,62` | Scope tracking to `[dir=ltr]` | S |
| L | **RTL mirroring coverage is genuinely excellent** (positive baseline — do not regress) | `app.css:113,141-142,185-186,196,263,282`; deliberate LTR forcing on all URL/token fields | Rule for new containers: `dir="auto"` default, `dir="ltr"` + isolate for URLs | S |

### DIM 9 — WARP UX — 12 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **WARP has no top-level presence** — subtab #10, invisible on Home until an account exists; `nav.warp` key exists untranslated-by-use | `shell.html:43-44`; `settings.js:125`; `home.js:98-103`; `dict.js:3` | Restore top-level WARP tab (key already translated) | S |
| H | **5 interactions login→usable config; the deliverable is then card #4 behind the raw token** | `warp.js:74-89` order: token panel → account card → endpoints → **17 URLs** → Amnezia → delete | Reorder: URLs first, token collapsed | S |
| H | **Failed WARP load renders three silent blank cards** — no error, no retry; worst failure surface in the panel | `warp.js:5-6,56-57` catch → null → bail after shells injected | Error card + Retry (users pattern exists); loading placeholder | S |
| H | **17 formats are an ungrouped, undifferentiated dump** — same icon every row, content types invisible, 'legacy' unexplained, rendered twice | `warp.js:2,89,92` | Group into client families + hints + content-type tags + Amnezia-variants toggle; one renderer + drift test | M |
| M | **Preset 'In use' badge designed, translated, never wired** — blast radius visible only at click time via raw English toast | `dict.js` `warp.presets.inuse` 0 refs; `api/warp.ts:297` | Compute counts from `S.warp.accounts`; disable delete when >0 | S |
| M | **Preset deletion: one-click 16px X, no confirmation** — the only destructive WARP action without one (dup → §11.4) | `actions.js:117-120` vs `:86-95` | `confirmDialog` wrap | S |
| H | **Endpoint preset select lies about state on custom-endpoint accounts and can silently destroy custom endpoints** — the only silent-data-loss path in WARP | `warp.js:75` no option selected for custom → browser shows first preset; `actions.js:396` instant PUT on any change | 'Custom (n endpoints)' placeholder + confirmDialog before switching away | S |
| M | **No WARP+/license handling of any kind** — anonymous free devices; tier invisible; no device counts; rate limits unmentioned | `src/warp/api.ts:110` register payload; grep 0 hits | Minimum: document free-tier + device-count chip; or license-binding parity | M |
| M | **Generate modal has no inline error field** — the one action that talks to Cloudflare and gets rate-limited has the weakest error surface | `shell.html` m-warp-generate vs `wi-error`/`wp-error` patterns | Add `wg-error` + retry-delay rendering | S |
| M | **Amnezia UI: 12-field cryptic wall, duplicated constants, toast-only errors, free-text inputs** | `warp.js:59-61,66,81-89`; `actions.js:126-131` | One AMZ constant + help triggers + effective-value diff + client validation + disclosure | M |
| L | **Home WARP summary shows a bare meaningless count 'AccountName · 17'** + ~100 DOM nodes per account | `warp.js:92` | `{n} formats` key; link-chips instead of full rows | S |
| L | **Dead i18n/nav archaeology + ghost Ctrl+K** (dup → §5.1) | `dict.js:3`; `chrome.js:79` | Prune or wire `nav.warp` | S |

### DIM 10 — Subscription delivery — 14 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **No Subscriptions hub: the core product is scattered across four surfaces, none complete** — Home rows, wizard step 2, WARP detail, users token cell; info page as cryptic row | `shell.html:43-44`; `home.js:93-100`; `actions.js:546`; `warp.js:73-79`; `users.js:8-13` | `#/subs` hub: per-format main links, per-user links (incl. never-exposed per-format variants), WARP formats, info-page footer link | L |
| H | **WARP buried as subtab #10; dead nav key** (dup → §9.1) | `settings.js:117` | Top-level tab | M |
| M | **Users empty state bare** (dup → §4.2) | `users.js:29` | `.empty-card` | S |
| M | **Per-user per-format subscription URLs exist server-side but the UI never exposes them** | `routes.ts:74-80` 4-segment user-sub route; `users-sub.ts:52-53`; `negotiate.ts:14-16` | Format expanders in user rows — pure client-side concat | S |
| M | **'Sub update interval (hours)' setting is silently ignored** — `Profile-Update-Interval` hardcoded 60 min for 5/6 formats; only Surge consumes it; a test enshrines the dead behavior | `headers.ts:7,41,49-54`; `test/subscription/headers.spec.ts:63-66` | Derive from setting or relabel honestly; golden test moves on purpose (ask first) | M |
| M | **Remote-sub merge is base64-only, admin-only, zero feedback** — Clash/sing-box/Surge/Loon/QX never see remote lines; per-user links force-drained | `render.ts:53-60`; `users-sub.ts:90` | Extend field hint + per-URL last-fetch status row (addr-probe pattern exists) | M |
| L | **UA negotiation and URL params completely unexplained in the UI** — the most clever mechanism, undocumented | `ua.ts:10-33`; `negotiate.ts:12-24` | One collapsible 'How links negotiate' hint | S |
| L | **QR encoder caps at version 25 with a dead-end toast; every download named `q-proxy-subscription.png`** | `qr.js:17-18`; `actions.js:26-34` | Context filename + 'copy instead' on overflow | S |
| L | **Format labels triplicated with inconsistent naming**; Home formats chip disagrees with visible list | `status.ts:46-53` vs `subscribe.ts:15-22` vs `warp.js:1` | Single exported FORMAT_LABELS map + drift test | S |
| L | **No one-click client import/download** — copy→switch-app→paste loop while the server already emits attachment headers; rivals ship deep links | `home.js:56`; `subscribe.ts` Content-Disposition | Download buttons + safe deep links in expanders | M |
| L | **Cache/versioning behavior implemented well, invisible to admin** — 60s throttle, versioned edge cache key busts on save | `headers.ts:41-54`; `subscribe.ts:27-31` | One hint line under the subs card | S |
| L | **Ctrl/Cmd+K targets a nonexistent box** (dup → §5.1) | `chrome.js:79` | Remove or implement | S |
| L | **`SubscriptionMeta.updateIntervalHours` is a dead parameter threaded through the whole stack** | `headers.ts:7`; both call sites pass it; never read | Consume it or delete it (with finding 5) | S |
| L | **Home users card is a stats stub** — WARP gets real per-account link rows, users get a counter | `home.js:113-117,169-176` | Mirror warpSubsHtml or fold into hub | S |

### DIM 11 — Copy & microcopy — 19 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **64 dead dict keys (8.5%)** — two removed features + one rename fully translated EN+FA (dup → §1.2) | dict.js both blocks; zero `t()` refs | Delete + drift test | S |
| H | **17 WARP format labels bypass the dict entirely** (dup → §1.5) | `warp.js:2` | `warp.fmt.*` keys | S |
| H | **Settings import overwrites the entire config with NO confirmation** | `actions.js:46-62` — contrast reset-defaults which confirms | `confirmDialog` + filename display | S |
| H | **WARP preset deletion: one-click irreversible, no confirmation** (dup → §9.6) | `actions.js:117-124` | Confirm keys + dialog | S |
| M | **Bulk-user confirm reuses a status-chip string as its title and never names the action** — "3 selected" / "Apply to 3 user(s)?" covers enable AND delete | `users.js:49` | Per-action body keys mirroring `users.confirm_delete_body` | S |
| M | **Toast string 'New token ready' reused as a permanent cell for a MISSING token** (dup → §4.1) | `users.js:15` | Dedicated `users.token_missing` key | S |
| M | **Server validation messages render as raw English in FA** — 'must be a boolean' at the highest-attention copy moment (dup → §1.3) | `settings.js:532` bridge; `validate.ts` 83 `fail()` sites | Server codes + FA batch | M |
| M | **Hardcoded English chrome in shell.html** (dup → §8.4) | `shell.html:19,67,83` | Bind in buildShell | S |
| M | **Dead `case 'ports'` keeps `common.yes/no` alive and concatenates English 'all' onto translated aria-labels** | `settings.js:222-226` | Delete case + 2 keys | S |
| M | **Users empty state breaks the house grammar** (dup → §4.2) | `users.js:29` | Full empty-card pattern | S |
| M | **Jargon policy bimodal**: ECH glossed beautifully; NAT64 and sniCase defined in terms of themselves | `egress.nat64.help` (format only), `protocols.sniCase.hint` vs `protocols.ech.*` | `.short/.help` pairs reusing the ECH structure | M |
| L | **Helper copy name-drops a rival: '(edgetunnel-style)'** | `sources.tools.hint` | Behavior-first rewrite | S |
| L | **Dash typography drift**: ASCII hyphen vs em dash in 2 keys, EN+FA | `addresses.empty_hint`, `remote.nodes.help` | Replace | S |
| L | **Button capitalization inconsistent**: 'Generate Account' vs 'Add address' | dict.js both blocks | Sentence case everywhere | S |
| L | **FA-specific defects**: garbled 'fragment.split' (double superlative); invisible U+200F RLM in `chain.uri.hint` is a diff hazard | `dict.js:20` | Rewrite + directional-isolate with comment | S |
| L | **'AccountName · 17' bare count** (dup → §9.11) | `warp.js:92` | `{n} formats` | S |
| L | **Placeholder 'asdasd.workers.dev' ships in the primary Addresses field** | `settings.js:98` | 'myworker.workers.dev' | S |
| L | **Error-recovery inconsistent**: users table gets Retry, pool failure dead-ends; `toast.saveFailed` dead while fallback is 'Something went wrong' | `users.js:28` vs `home.js:158` | Retry on pool; prefer specific error codes | S |
| L | **Sampled-key verdict: tone, case, consequence-discipline genuinely good** (positive — protect it) | allowlist hint includes the KV recovery path; kill-switch confirm states reversibility | Audit only error-class keys: every error names the fix | S |

### DIM 12 — First-run & onboarding — 12 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **Fresh manual deploys: setup card reachable only by failing a login, and the login hint is false for that path** | `login.html:167` renderSetup only from `SETUP_REQUIRED` error path (`auth.ts:201`) | Probe `hasPassword` and render setup card directly | S |
| H | **Self-service setup marks the human-chosen passphrase as bootstrap → forces an immediate SECOND password change with contradictory copy** | `auth.ts:282` `passwordIsBootstrap:true` → force-change overlay for a password the human just picked | Marker distinction: forced rotation only for machine-generated deploy passwords | M |
| H | **WARP buried, zero first-run presence outside one wizard sentence that admits it lives in Settings** (dup → §9.1) | `home.js:73` | Top-level tab or Home CTA | M |
| M | **Home 'No subscriptions yet' empty state is dead code — buildSubUrls always returns 7 entries**; a zero-protocol panel serves confident URLs that download nothing | `home.js:100` vs `status.ts` buildSubUrls | Capability-gated warning variant ('returns no nodes') | M |
| M | **Users first-run: bare cell + meaningless 0/0 Home grid** (dup → §4.2) | `users.js:29`; `home.js:121,171-175` | Empty-card; hide zeros grid | S |
| M | **The wizard's own 'Open Protocols' CTA dismisses the wizard forever at the step it advertises**; no Escape; un-reopenable (dup → §5.10) | `actions.js:538-551` | Navigate without `qp_wizard_done`; Escape; replay entry | S |
| M | **Two first-run password screens present two different policies, neither fully enforced server-side** | setup: 8+upper+digit; force-change: length only; server enforces length only (`auth.ts:286,312`) | One policy, stated identically, enforced once | M |
| L | **Setup-card error handling blames the password for server failures; expiry is a dead end; success toast reuses the form title** | `login.html:172` catch-all | Map by code; docs link on expiry | S |
| L | **Day-zero backup banner claims 'no backup in over 30 days' 30 seconds after creation** | `chrome.js:27-40` last=0 falls through | Suppress until wizard done or reword | S |
| L | **First-run Home: two 'press the button' placeholder cards + unlabeled total + unexplained fragment mode** | `home.js:109,174-175` | Auto-load my-ip; label; hint | S |
| L | **Every fresh visitor's first paint is Persian** (dup → §1.11) | `login.html:127` etc. | navigator.language sniff | S |
| L | **The scripted happy path is solid** (positive): deploy → printed password → forced rotation → wizard → client config in under a minute | `deploy-direct.mjs:567-581`; boot chain | Preserve while fixing 1, 2, 6 | S |

### DIM 13 — Accessibility (WCAG 2.2 AA) — 16 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| **C** | **Modal validation errors are silent to screen readers** — no live region, no focus move, toast suppressed exactly when an inline error exists | `actions.js:468,479,495`; `shell.html:75-77` bare `<p>`s | `role="alert"`, `aria-invalid`+describedby, focus first invalid | M |
| H | **ARIA radiogroups ship `role="radio"` buttons with zero arrow-key support** — egress chips, fragment presets, home sub-mode, lang segment; Tab-per-chip is what the pattern forbids | `settings.js:218-221,237-247`; `actions.js:355-363` click-only | One shared keydown controller (arrows RTL-flipped, roving tabindex, Home/End) | M |
| H | **Every address-card and remote-node input renders an unassociated `<label>`** — 7–11 unnamed fields per card, the panel's most data-dense form | `settings.js:141,164`; `shell.html:77` | Generate for/id in the two `field()` helpers | S |
| H | **Light theme fails contrast for errors/success/warning/micro-labels** (dup → §6.1-6.3) | `app.css:5-6,91,173,203,210` | Light token ramp | S |
| L | **Positive baseline worth preserving**: skip link, toast live regions (`role=alert` on errors), `:focus-visible` ring, Escape+focus-return, correct lang/dir pre-paint, reduced-motion | `shell.html:19,82`; `lib.js:6,44`; `app.css:25` | Preserve in refactors | S |
| H | **Inline settings errors associate but never announce; no focus move on failed Apply** — user told 'N errors' but not what/where | `settings.js:510-519,660-667` | `role=alert` on `.field__error`; focus first `aria-invalid` | M |
| M | **Tablists lack roving tabindex** — 12 tab stops before content; arrows ignore RTL (contradicts APG) | `actions.js:456-457,497-505`; `home.js:74` | tabindex 0/-1 on selection; RTL flip in wireTabKeys | M |
| M | **`role=group` container holds `role=radio` children** (langseg) + keeps English aria-labels in FA | `shell.html:53,67`; `home.js:54` | `role="radiogroup"` + localized labels | S |
| M | **Field help tooltips unreachable for screen readers** — pop has no id, button no aria-describedby; content exists precisely for fields users get wrong | `settings.js:127-128` | id + describedby (announced on focus, no JS) | M |
| M | **Address probe status is color-only** — green/red dot with title-only tooltip | `settings.js:155`; `warp.js:35-47` | `role=img` + aria-label + non-color glyph | S |
| M | **Sub-24px targets**: 18px swatches, 14px desktop help triggers, invisible 1px port-master checkbox (dup → §6.12) | `app.css:53,99,302`; `settings.js:225` | 24px hit areas; visible label button | S |
| M | **Dirty/unsaved state has no accessible announcement** — applybar un-announced; literal `'*'` appended to subtab text | `settings.js:631-635`; `shell.html:71` | `role="status"` + visually-hidden '(unsaved)' | S |
| M | **Input/button borders ~1.3:1 in dark theme** (non-text contrast 1.4.11) — every field, ghost button, chip, off-switch | `app.css:1,106,122,136,186` | `--border-strong` → .22 (light too) | S |
| L | **Modal focus trap omits textarea and select** — works today by DOM luck; m-warp-preset contains a textarea (latent escape) | `lib.js:31-36,45` | Add `select,textarea` to selectors; describedby on confirm dialog | S |
| L | **QR canvas and traffic chart lack accessible names** for their content | `chrome.js:13-23`; `shell.html:72` | `role=img` + meaningful labels / hidden summary | S |
| L | **Static document.title across all views; English-only noscript** | `home.js:78`; `shell.html:83` | Per-view title; dict key | S |

### DIM 14 — Polish & product feel — 16 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **IA buries WARP and Users as subtabs #9/#10** (dup → §2.1) | `shell.html:42-49`; `settings.js:30` | Top-level tabs; use the dead `nav.warp` key | M |
| M | **Users zero-state bare** (dup → §4.2) | `users.js:29`; `home.js:118-120` | `.empty-card` + repurpose Home card | S |
| M | **Shortcuts modal advertises a Ctrl+K search that does not exist** (dup → §5.1) | `chrome.js:79,40`; `dict.js:14` | Ship or remove | S |
| M | **Update check is a dead-end toast** — evaporates in 3.5s, no link/badge/auto-check; 'Could not reach GitHub' is the *expected steady state* for this audience with no guidance | `actions.js:60-70`; `version.ts:7` knows the repo | Persistent chip + releases link + auto-check | S |
| M | **Requests-total unlabeled, orphaned key** (dup → §1.9) | `home.js:120` | Wire label; guard lone-'v' version fallback | S |
| M | **Zero documentation/help links, no About, version buried bottom-right** — the panel can't link to its own docs/repo; Uptime Kuma and rivals all do | grep: one external href in the whole panel (`home.js:109`) | About modal: version, colo, repo+docs links | M |
| M | **Subscription acquisition is a flat 7-row list** — no deep links, no download, Panel-info URL QR'd like an importable sub; fragment re-bind is index-fragile | `home.js:84-92` | Deep links + download + hierarchy + data-attr binding | M |
| M | **Users table: unclamped URL cell overflows, no usage numbers, full re-render on toggle** — the Telegram bot shows counts the web panel hides | `users.js:14-15,29` | `.copy-field` treatment + quota column + in-place update | M |
| M | **Danger zone is a bare title+button card mid-section** — the only irreversible action, no description, no quarantine, `card--danger` defined but unused | `settings.js:40,269` | Last position + `card--danger` + consequence text + verb-specific confirm | S |
| M | **Modal behavior inconsistent**: the first-run wizard has no focus trap and ignores Escape; backdrop click closes only confirm/QR; abrupt dismissal | `actions.js:441-452`; `lib.js:45` | Include m-wizard; unify dismissal; exit animation | M |
| L | **~40 orphaned i18n keys + orphaned SVG symbols ride in the bundle** (dup → §1.2) | dict.js; `shell.html` symbols | Delete + CI usage assertion | M |
| L | **Favicon/branding gaps**: SVG-only favicon, no theme-color, no apple-touch, static title; login plainly self-identifies vs camo posing as a blog | `shell.html:8-9`; `login.html:9` | Raster fallback + theme-color + per-view title | S |
| L | **Motion polish uneven**: Home animates, Settings hard-swaps; late WARP data re-renders the whole home grid | `app.css` fadeUp vs `home.js` showSection | Light settings enter animation; patch one card | M |
| L | **Backup banner fires on brand-new installs alongside wizard + force-change** — onboarding pile-up (dup → §12.9) | `chrome.js:27-38` | Suppress until wizard done | S |
| L | **No print styles anywhere** — archiving the users list prints dotgrid, blobs, applybar | grep `@media print` = 0 | Small print block | S |
| L | **Icon/label nits**: text '?' among SVG icons with hardcoded `aria-label="?"`; copy glyph for add; X = close *and* delete; generic 'Yes, continue' on destructive confirms | `shell.html:55`; `warp.js:34`; `lib.js:47` | Keyboard SVG + plus glyph + verb-specific confirm labels | S |

### DIM 15 — Interaction patterns — 17 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **Ctrl/Cmd+K advertises a search box that does not exist** (dup → §5.1) | `chrome.js:79,40` | Implement or delete | S |
| H | **Discard bar silently destroys ALL unsaved sections** — no confirm; undo can't reliably rescue (post-edit pushes, 1s race) | `actions.js:44-45`; `settings.js:499-509`; `chrome.js:49-53` | confirmDialog + push discarded state as undo entries | S |
| H | **Undo/redo: invisible, section-scoped, debounced into a race, and disabled inside the inputs you edit** — `isEditable` guard runs first; pushes the POST-edit state | `chrome.js:44-53,63-72,74-83` | Push pre-edit state; coalesce per field; work in fields; Undo/Redo buttons on apply bar | M |
| H | **Double-submit protection for half the mutations; section-save disables the wrong (hardcoded `#apply-btn`) button** — token regen double-rotates, import double-applies | `settings.js:318,471-474`; `actions.js:46-63,141-144` | One `withBusy(el, fn)` helper everywhere | M |
| H | **Users empty state is a dead-end table frame** (dup → §4.2) | `users.js:29,8` | `.empty-card` + hide chrome | S |
| H | **Concurrent-edit staleness (60s KV + 30s sessionStorage) ships with zero UI affordance** — no revision, no 'changed since you opened this page' | `lib.js:18-26`; `settings.js:483` no If-Match; grep 0 hits | updatedAt/revision in bootstrap+save; warn+confirm on revision mismatch | L |
| M | **Apply-all runs a serial N-section commit; toast container caps at 3** — 5 dirty sections = 3 dropped success toasts; partial failure only summarized per-section | `actions.js:43`; `settings.js:471-501`; `lib.js:11` | Batch summary toast + progress label + cancel | M |
| M | **Loading grammar is one skeleton, one spinner, and seven bare 'Loading…' text nodes** | `actions.js:514`; `users.js:8`; `warp.js:16`; `home.js:115,157,177` | One loading component + skeleton variant | M |
| M | **Copy-to-clipboard reports success unconditionally; fallback swallows failure** — on http:// deployments (common for this product) the 'Copied' toast can lie about the panel's core artifact | `lib.js:37-38`; `actions.js:4-9` no failure branch | Boolean fallback + error toast + auto-select | S |
| M | **User creation copies silently and skips the rotation modal regeneration gets** — inconsistent ritual for the same secret | `actions.js:493` vs `:141-144` | Route create through the share sheet | S |
| M | **Dirty-state guarded on unload only, silent on in-app navigation; three confirm idioms coexist** (styled dialog, native confirm on 401, beforeunload) — browser dialogs appear in browser-locale English | `actions.js:453-456`; `home.js:63-72`; `lib.js:27` | One guard: hashchange intercept + confirmDialog listing dirty sections | M |
| M | **WARP preset select auto-PUTs with no pending state, no optimistic rollback** — failed PUT leaves UI asserting a state the server rejected | `actions.js:396` | Reuse the user-toggle optimistic pattern + debounce | M |
| M | **Settings import: no busy state, double-import possible, discards unsaved edits via the generic browser dialog** (dup → §11.3) | `actions.js:46-63` | Confirm + withBusy + purge `S.dirty` | M |
| M | **Main links: copy/QR only — no copy-all, no per-format download, country filter documented as a hint sentence instead of a control** (dup → §14.7) | `home.js:97-99`; `actions.js:18-25` | Download buttons + country select rewriter | M |
| M | **WARP reachability: subtab 10 of 10; home surfaces WARP only after it exists** (dup → §9.1) | `shell.html:30-33`; `home.js:98,103` | Owner IA decision | M |
| L | **Keyboard discoverability: bare '?' button; 5-row modal with a dead row; 'g h' chord with zero affordance** | `shell.html:55`; `chrome.js:37-42,80-82` | Bind '?' + Ctrl+/; kbd hints | S |
| L | **Modal focus trap omits SELECT/TEXTAREA — tab can escape m-warp-preset today** (dup → §13.14) | `lib.js:31-36` | Add selectors | S |

### DIM 16 — Settings field-by-field — 26 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **`localDns` is a write-only setting** — rendered, validated, saved, consumed by nothing in any emitter/handler/tunnel path | `settings.js:102`; `fields.ts:110`; `validate.ts:525-529`; grep: no consumer | Delete field+descriptor+dict keys (recommended) or wire into sing-box DNS | S |
| H | **`sourceUrls` / the entire Sources subtab saves a list nothing consumes**; pool resolves from proxyIps/proxyIpPoolUrl/DoH only; duplicates the Egress pool card | `warp.js:10-13`; `fields.ts:117`; `proxyip-pool.ts:196-203` | Merge Sources into Egress; delete the field | M |
| M | **`addresses[].city` collected and validated but never used in generation** | `settings.js:153`; `validate.ts:276-290`; naming uses country only | Remove the input (or wire into renderName — speculative) | S |
| M | **Fragment presets leave split/packets editable but silently ignored** outside custom mode; the fpreset renderer also drops the passed `fragment.enable` label | `settings.js:346-356` vs `fragments.ts:13-20` | Hide (not disable) unless custom; accurate help | S |
| M | **Server validation errors for `camouflage.url` / `chainProxy.uri` / `telegram.*` can never render inline** — leaf-key failures vs dotted UI binds | `validate.ts:538-540,496-498,564,572` vs `showFieldError` matching | Qualified keys or client-side leaf→path mapping + regression test | S |
| M | **Developer jargon with zero explanation**: 10 raw uTLS fingerprints (incl. '360','qq'), packets wire tokens ('1-3'), ALPN tokens that silently fail server-side | `settings.js:65`; `home.js:4-5` | Help popovers + ALPN preset chip row | M |
| M | **Untitled General card mixes securePath, profileTitle, debugLogging, and the panel-lockout IP allowlist**; language sits under the 'Kill switch' card; KV-incantation hint with no popover | `settings.js:31-40` | Titled 'Panel access' card; move language out | S |
| M | **Six routing rules live inside a card titled 'Camouflage page'**; the dedicated `routing.title` key exists unreferenced | `settings.js:113-122` | Own 'Routing rules' card | S |
| M | **Relay-pool widget duplicated across three surfaces** — Egress card, Sources card, Home card; two renderers, three fetch paths, divergent state | `warp.js:8-13,21-47`; `home.js:105-112,158-171` | One pool card + one renderer | S |
| L | **Dead UI machinery**: 'ports' binder branch, updatePortMasters, checker-targets MAX_TARGETS remnant (dup → §2.4) | `settings.js:222,405,429,564`; `home.js:2` | Delete | S |
| M | **~60 dead i18n keys (~12% of dict) shipped in both languages** (dup → §1.2) | dict.js | dict-lint step in build | S |
| L | **requestsTotal unlabeled** (dup → §1.9) | `home.js:120` | Wire label | S |
| M | **Users empty state bare hint row inside table chrome** (dup → §4.2) | `settings.js:41` / `users.js:29` | Empty-card; suppress header/bulkbar at n=0 | S |
| H | **WARP buried as subtab #10; nav keys prove earlier design** (dup → §9.1) | `settings.js:124-125` | Owner IA decision | L |
| M | **`remoteDns` has no hint despite silently driving egress DNS and sing-box; hostname input silently rewritten to a DoH URL** | `settings.js:101`; `singbox-json.ts:285-286`; `egress.ts:91`; `validate.ts:511-524` | short+help + normalized-URL preview + preset chips | S |
| M | **`chainProxy.uri` holds credentials but renders as plain text input** (unlike telegram.botToken's secret type) | `settings.js:97` | 'secret' renderer with reveal | S |
| L | **`camouflage.url` always visible regardless of mode; no hint on content or its SSRF constraint** | `settings.js:115`; `validate.ts:533-540` | showIf(mode==='proxy') + hint | S |
| L | **ECH tri-state rendered flat with no linkage** — precedence readable only from code; preview line is the right pattern, keep it | `settings.js:67-69` vs `ech.ts:10-20` | showIf chain | S |
| M | **Behavior numbers (urlTest/sub interval/maxNodes) have no hints; `maxNodesPerFormat` silently truncates every format** | `settings.js:110-112`; `generate.ts:276` | Hints + inline note when below current node count | S |
| L | **nameTemplate exposes two byte-identical placeholder pairs** ({IP_NAME}/{LABEL}, {HOST}/{WORKER}); no live preview | `naming.ts:72-77` | Drop aliases + live example | S |
| L | **`addresses.card.hint` is stale textarea-era copy ('One entry per line') for a card-grid control; hint and help duplicate** | `dict.js:3` | Rewrite hint for the card UI | S |
| L | **Fragment min>max inversion caught only server-side after a failed save** | `settings.js:233-236`; `validate.ts:783-790` | Inline cross-check on blur | S |
| L | **Backup import copy says 'Paste an exported settings JSON' but the control is a file picker** | `general.backup.import_hint` vs `actions.js:46-61` | Fix copy EN+FA | S |
| L | **Defaults sanity: `language:'fa'` boots non-Persian admins into RTL; NAT64 community prefixes hardcoded and unsurfaced** | `types/settings.ts:214,219` | Wizard language step; 'replaceable defaults' note | S |
| L | **Pain 2 largely refuted — Home is the link surface — but Settings has zero links surface**; only the DoH private endpoint is copyable there | `home.js:88-99`; `settings.js:243-245` | Compact 'Your links' card on Addresses | S |
| L | **`telegram.chatId` has no hint on how to obtain it** — the most common setup failure; card hint stops one step short | `settings.js:108` | getUpdates/@userinfobot hint | S |

### DIM 17 — Code organization & performance — 13 findings

| Sev | Finding | Location · Evidence | Fix | Eff |
|-----|---------|---------------------|-----|-----|
| H | **Panel ships raw, unminified — 258 KB raw / 65 KB gzip, ~190 KB wasted** — while esbuild `minify:true` is already used in the same build file; BPB minifies+embeds | `build-single-file.mjs:24-29`; `docs/research/01-bpb-panel.md:10` | `esbuild.transformSync({minify:true})` on assembled JS+CSS; keep sources readable | M |
| M | **`Cache-Control: no-store` on a byte-identical 258 KB page — no ETag, no 304**, while the API layer one directory over does conditional requests correctly and the client implements 304s | `panel-page.ts:9` vs `api/bootstrap.ts:12` + `lib.js:22-24` | Deploy-hash ETag + `no-cache` revalidation (panel + login) | S |
| M | **dict.js ships both languages always, unsplit, non-lazy** — 52 KB source / 18 KB gzip, half unused at any moment | `dict.js:2-21`; `panel/README.md:16` documents concat, never weight | Per-language split in the splice builder, or document the inline trade-off | M |
| M | **68 dead dictionary keys** incl. a complete fake 'IP Checker' (dup → §1.2) | `dict.js:3,20` | Delete + build-time drift check | M |
| M | **settings.js is a 621-line grab bag** — registry, 13 renderers, users modal, diff/save engine, validators, and a full Base32/HMAC-SHA1 TOTP crypto stack | `settings.js:291-300` raw crypto.subtle bit-slicing | Extract `totp.js` + users modal; order-preserving in the splice build | M |
| L | **Dead code inside settings.js**: unreachable 'ports' renderer, orphaned TLS_PORTS/PLAIN_PORTS, ghost checker reference (dup → §2.4) | `settings.js:222,405,429,564`; `home.js:1` | Delete with drift guard | S |
| L | **Duplicate helpers**: AMZ/AMZK identical arrays 40 lines apart; renderPool twins across files (dup → §9.10) | `warp.js:66,81,21`; `home.js:159` | `AMZ_FIELDS` constant; `renderPoolInto` | S |
| H | **Dirty-tracking is O(all sections) per keystroke** — every input event re-collects and JSON-stringifies all ten hidden panels + 3 querySelectorAll passes + 1s undo push | `settings.js:456-461,441-447`; `actions.js:412-424` | O(1) per-section diff via `el.closest('[id^="sp-"]')`; global sweep only on save | L |
| M | **Home re-renders wholesale and double-fires probe APIs** — `fresh:true` bypasses the in-flight dedup layer; each boot probe runs up to 8 tcpProbes ×2 | `home.js:103,156,168`; `lib.js:18`; `proxy-pool.ts:37-42` | Targeted WARP-block update; drop `fresh:true` on boot | M |
| L | **Ghost Ctrl+K** (dup → §5.1) | `chrome.js:53,79` | Ship or remove | S |
| L | **Always-on decorative GPU work**: 2×900×500 blobs with 44/56s infinite drift + 130px blur, conic spinring, feTurbulence noise on a settings page | `app.css:32-37,43-44,301` | Pause on settings view; pre-blurred radial-gradient | S |
| L | **innerHTML/esc discipline is consistently applied — and that is a convention, not a guarantee**; no lint rule exists by design | `lib.js:2`; ~500 esc() sites traced, no XSS found | `h()` helper or build-time gate on un-escaped attribute concat | L |
| L | **Correctness nits**: `validIpOrHost` dot-checks reduce to `RE_HOST.test(s)`; `randomPass` has modulo bias over 62-char alphabet | `settings.js:541-545,601-604` | Collapse branches; rejection sampling (redraw ≥248) | S |

---

## 4. Competitor comparison

Sources: `docs/research/01-bpb-panel.md` (BPB-Worker-Panel), `docs/research/02-edgetunnel.md` (cmliu/edgetunnel), `docs/research/03-nahan.md` (itsyebekhe/nahan). "Pro patterns" = Cloudflare dash / Tailscale / Uptime Kuma / Linear conventions cited by the audit. Note: `.pi/ui-audit/competitors.json` was not present on disk; the repo's research docs were used instead.

| Capability | Q Proxy | BPB ([repo](https://github.com/bia-pain-bache/BPB-Worker-Panel)) | edgetunnel ([repo](https://github.com/cmliu/edgetunnel)) | nahan ([repo](https://github.com/itsyebekhe/nahan)) | Pro patterns |
|---|---|---|---|---|---|
| **UA-based format negotiation** | ✅ `ua.ts:10-33` sniffing + `?target=` override — but undocumented in UI | ❌ `?app=` query required; wrong link → camouflage 404 (research §C.1/G1) | ✅ UA sniff + params (`_worker.js:332-346`) | ✅ UA sniff + browser-vs-client split (`_worker.js:816-839`) | Behavior should be *explained*, not just implemented |
| **Browser info page for subs** | ✅ `?view=html` (`subscribe.ts:93-97`) — but rendered as an importable sub row with a QR button, ranked last | ❌ none | ❌ none | ✅ bilingual RTL `subscription.html` w/ usage bars (`_worker.js:636-715`) | nahan's info page is the model |
| **`subscription-userinfo` / update headers** | ⚠️ none; `Profile-Update-Interval` hardcoded 60 min while a setting claims otherwise (`headers.ts:41-54`) | ❌ no userinfo, no interval (research §C.5) | ✅ userinfo + interval from live usage (`:325-330`) | ✅ userinfo + `profile-update-interval: 12` (bytes fake-estimated, `:771-781`) | Honest, derived headers |
| **Panel asset delivery** | ❌ **258 KB raw, unminified, `no-store`, no ETag** (`panel-page.ts:9`, `build-single-file.mjs:24-29`) | ✅ minified, gzipped, base64-embedded (`scripts/build.js`) | ⚠️ UI hosted on external GitHub Pages site (`_worker.js:4`) — supply-chain dependency | ❌ 458 KB `dashboard.html` fetched from GitHub raw at request time (`_worker.js:501-503`) | Hashed ETag + minify + gzip |
| **Multi-user** | ✅ real model (≤50 users, hashed tokens, quota/expiry/protocol scope) — **UI withholds nearly all of it** | ❌ single UUID + single trojan pass (research §G2) | ❌ single UUID derived from password (research §G1) | ✅ strongest management plane: quotas/expiry/pause/per-config UUIDs/connLimit | Tailscale-style entity pages with deep links |
| **One-click client import** | ❌ copy/QR only; no deep links, no download buttons | ✅ per-sub QR/copy/download + server-side QR PNG + `sing-box://` deep links | ✅ quick-sub 302 redirect (`:86-89`) | ✅ QR codes + per-profile sync links | BPB's import buttons set the floor |
| **Empty states / onboarding** | ⚠️ empty-card pattern exists and is applied twice; Users gets a bare line; wizard self-destructs at its own CTA | ✅ forced first-run Set-Password modal (401+`isPassSet`) | ❌ none | ✅ `setup.sh` wrangler wizard + installer bots | CF dash: explain value at the moment of emptiness |
| **Self-update from UI** | ⚠️ check-only dead-end toast; no releases link, no auto-check (`actions.js:60-70`) | ✅ full self-redeploy via CF API incl. junk-code padding (research §F1) | ❌ none | ✅ cron auto-update + optional obfuscation + panel fan-out (`:937-1004`) | Persistent update chip + changelog link |
| **i18n / RTL** | ✅ **best in category**: 523/523 parity, idiomatic FA, meticulous RTL mirroring — leaks at ~30 hardcoded strings + server errors | ⚠️ FA-oriented, single catalog | ❌ Chinese identifiers, mojibake changelog | ✅ bilingual EN/FA RTL info page + FA/EN Telegram bot | Complete coverage incl. error paths |
| **A11y** | ⚠️ strong baseline (skip link, live regions, focus traps, reduced-motion) — not AA: silent validation errors, radiogroups without keyboard, light-theme contrast | ❌ no a11y story | ❌ none | ❌ none | WCAG 2.2 AA as CI gate |
| **Security posture of panel** | ✅ PBKDF2 tiers, HMAC sessions w/ revocation floor, CSRF header, KV login throttle; ⚠️ securePath trap | ❌ plaintext pwd in KV, non-constant-time compare, no rate limit, JWT irrevocable (research §G3-4) | ❌ double-MD5 tokens, UA-bound cookie, `insecure:true` TLS client (research §G2-4) | ❌ masterKey default `"admin"`, no sessions, secrets plaintext in D1 (research §H6-7) | Constant-time + rate limit + revocation |
| **Engineering hygiene** | ✅ strict TS, dual vitest pools, drift tests, zero runtime deps | ❌ no tests (research §G14) | ❌ 6.6k-line single file | ❌ 9k-line single file, cover-story naming | Tests + drift guards as CI |

**Net position:** Q Proxy beats every rival on engineering discipline, i18n/RTL, security posture, and multi-user *backend* — and loses to BPB on panel delivery weight, to BPB/edgetunnel on client import UX, and to nahan on surfacing user-facing subscription info. Its distinctive failure mode is not missing capability but **unexposed capability**.

---

## 5. Target IA

```text
TARGET IA — Q Proxy panel (5 top-level tabs, Settings shrinks 10→6 subtabs)

TOP-LEVEL NAV (topbar .tabs; replaces current Home+Settings only, shell.html:42-44)
├─ Home          #/home                — dashboard: worker status, IP/egress summary, kill-switch card (sole surface), first-run chips, 3-row subscription teaser with "View all" → #/subs
├─ Subscriptions #/subs   [NEW hub]    — the product: every URL this worker serves — main per-format links with per-format expanders, per-user links, WARP formats, info-page link as labeled footer row (not an importable row)
├─ Users         #/users  [PROMOTED from Settings subtab #9] — scoped per-user links: list with expiry countdown / daily fetch quota / protocol scope, create + rotate via one ShareSheet
├─ WARP          #/warp   [PROMOTED from Settings subtab #10] — accounts grid, endpoint presets, Amnezia defaults, 17 output formats grouped by client family, URLs-first detail page
└─ Settings      #/settings/<sec>      — pure configuration only, no entity CRUD:
   ├─ General    — profile identity (profileTitle, debugLogging), new "Panel access" card (allowedIps + securePath decision + session), Backup/Danger zone, TOTP; kill-switch and language controls REMOVED (owned by Home card and topbar segment respectively)
   ├─ Protocols  — VLESS/VMess/Trojan/SS cards + Common options with an "Advanced TLS" collapsible (ECH trio, alpn, sniCase, fingerprint) via the proven showIf mechanism
   ├─ Addresses  — per-address cards (city input removed), defaultPort, nameTemplate, remote-sub merge, remote nodes
   ├─ Egress     — mode chips, proxyIps/nat64 lists, pool URL + pool tools; absorbs the Sources subtab wholesale (sourceUrls deleted)
   ├─ Tunnel     — fragment presets chip row + chain proxy card (two lone single-card subtabs merged into one)
   └─ Advanced   — DoH trio (+udp53), "Routing rules" own card (wires the dead routing.title key), Telegram, behavior numbers (urlTestIntervalSec, subUpdateIntervalHours, maxNodesPerFormat) under one disclosure

Back-compat: parseRoute (home.js:55-62) gains 'subs'/'users'/'warp' views; #/settings/users → #/users and #/settings/warp[/:id] → #/warp[/:id] 301-style redirects (history.replaceState, same pattern as home.js:63-64). Hash routes only — no worker route changes, so test/workers/router.spec.ts is untouched.
```

**Explicit decisions**

1. **Subscriptions hub: YES.** Main links are on Home today (pain 2 "largely refuted"), but the URL product is scattered across 4 surfaces, none complete (DIM 10), and per-user per-format variants already exist server-side with zero UI (`src/core/routes.ts:74-80`). The hub is the single place the three duplicate format-label tables merge (`subscribe.ts:15` FORMAT_LABELS, `status.ts:45` buildSubUrls, `warp.js:2` WARP_F) so hub, info page, and WARP detail can never disagree.
2. **Expert mode: NO.** Do not hide fragment/chain/egress/advanced behind a mode toggle — a hidden-state dimension multiplies the test matrix and recreates exactly the burial problem being fixed (8 dims confirmed pain 1 = content buried, not too many tabs). After the merges Settings has 6 honest subtabs of grouped cards; lone-card scatter is solved physically (Tunnel merge), not with a mode flag. Advanced content gets collapsibles within existing subtabs instead.
3. **Kill switch: Home card is the only surface** (DIM 2: "keep the Home card, remove the settings copy"); the `[data-kill]` document-wide sync (`home.js:130`) makes this safe. An emergency action is not a setting.
4. **Language: topbar segment is the only control**; the General 'lang' field is a cookie-only zombie (`settings.js:39` vs `actions.js:398` — never persisted into `settings.language`).
5. **Tab labels stay short** (Home, Subs, Users, WARP, Settings) so 5 tabs fit 375px phones once the unconditional `.tabs` mask is removed (DIM 7); new dict keys `nav.subs`/`nav.users` added, `nav.warp` finally wired.

**Page merges**

- Users + WARP out of Settings → top-level `#/users` and `#/warp` tabs (DIM 2/5/9/10/14; the dead `nav.warp` key dict.js:3,20 proves a dropped top-level design; parseRoute home.js:55-62 gains two views with back-compat redirects from `#/settings/{users,warp}[/:id]`).
- NEW Subscriptions hub `#/subs` consolidating the 4 scattered URL surfaces: Home sub list (home.js:93-100), Users rows (users.js:8-13), WARP formats (warp.js:73-79), 'Panel info' row (status.ts:54) — plus the never-exposed per-user per-format variants (`src/core/routes.ts:74-80`, DIM 10) behind expanders; 'Panel info' becomes a labeled footer link, killing the home.js:90 label-magic-string special case.
- Sources subtab → Egress: its only unique field `sourceUrls` is consumed by nothing (fields.ts:117, warp.js:10-13; pool resolves from proxyIps/proxyIpPoolUrl/DoH only) and its pool-fetch/source-doh buttons duplicate the Egress pool card — one relay-pool surface (DIM 5/16), with pool-fetch/source-doh/home-pool-refresh collapsed into one parametrized action (actions.js:214-218, DIM 15).
- Fragment + Chain proxy → single 'Tunnel' subtab (two lone single-card sections, settings.js:87-97, DIM 5).
- `routingRules.*` out of the camouflage card → own 'Routing rules' card in Advanced, wiring the dead `routing.title` key (DIM 16).
- Panel-access controls → titled 'Panel access' card in General: allowedIps joins securePath (or its replacement) instead of sitting untitled next to profileTitle (DIM 16).
- Kill switch → Home card only; General instantbool removed (DIM 2 vs DIM 5 dissent noted; shared `setKillSwitch`/`syncKillUI` already keeps `[data-kill]` surfaces in sync).
- Language → topbar `#langseg` only; General 'lang' registry row removed (settings.js:39 zombie — control writes a cookie, never persists `settings.language`; DIM 2/3).
- Create-time auto-copy (`#m-qr` auto-open actions.js:493) + token-rotation modal (`#m-rot` shell.html:78) + QR modal (shell.html:72) → **ONE ShareSheet component** (URL text + copy + QR + download + shown-once warning) used by user create, user rotate, and WARP regen (DIM 4/7).
- Users data: `loadHomeUsers` (home.js:165-172) and `loadUsers` (users.js:26-34) → single GET api/users + `S.users` subscription; one shared user-status helper for the Home card and the table (DIM 2/4); Home Users card becomes stats + 'Add user' + 'View all' link, deleting the ghost Manage button (home.js:115).
- WARP internals: AMZ+AMZK → one `AMZ_FIELDS` constant (warp.js:66/81); renderWarpDetail + warpSubsHtml format loops → one `renderFormatRows` helper with a registry.ts drift test (warp.js:88-95, DIM 9/17); renderPool + renderHomePool → one `renderPoolInto(box,{limit,showActions})` (warp.js:21-47, home.js:159-172); 7× `invalidateWarp();loadWarpIfNeeded()` pipelines → one `warpMutate()` (DIM 15).
- WARP detail page reordered: Subscription URLs first, device token collapsed (warp.js:74-89 — today the deliverable is the 4th card behind the raw token after 5 interactions, actions.js:459-464).
- Empty states → one shared `.empty-card` builder with icon/title/message/CTA (conformant today: home.js:100, warp.js:61; violator: users.js:29); loading idioms → one loading component with skeleton variant (actions.js:514 / users.js:8 / warp.js:16) (DIM 10/12/15).
- Save model: global applybar + Ctrl+S stay; per-section Save rows removed or demoted to scroll-to-applybar anchors; the no-op Apply bars injected on users/warp/sources panels deleted (settings.js:318, shell.html:71, DIM 2/4).
- login.html:128-129 inline dict merges with panel dict.js into one build-time catalog (12 duplicated keys today); login renderSetup + panel force-change card merge into one shared password-change component with one shared rule set (login.html:172, settings.js:273, DIM 1/11/12).
- Mobile CSS: the two touch-target media queries (app.css:300,302) merge into one block that also covers `.swatch/.subtab/.tab/.back-btn/.toast__close`, and all ≤767px rules fold into one ordered block; login.html:107's hand-copied coarse-touch subset comes from the same assembler-injected snippet (DIM 7).

**Removals**

- `settings.localDns` — write-only field: rendered (settings.js Advanced), validated (fields.ts:110, validate.ts:525-529), consumed by nothing in any emitter/handler/tunnel path — delete field + descriptor + dict keys (recommend deletion over the speculative 'wire into sing-box DNS').
- `settings.sourceUrls` — validated and saved but read by nothing; delete with the Sources subtab (fields.ts:117, warp.js:10-13, DIM 16).
- `addresses[].city` — collected (settings.js:153) and validated (validate.ts:276-290) but never used in generation; naming uses country only — remove the input (or wire into renderName, but that's speculative).
- `securePath` control — dead control that dumps admins on a nonexistent URL: UI renders/confirms/redirects as if it saves but handleSaveSettings strips it (settings.js:31-33 vs api/settings.ts:63) while resolveSecureRoute still honors a value nothing can set (routes.ts:60-62). Recommendation: delete the field, its confirm.* keys and the FL row (P0 stop-gap: render read-only). If the owner wants URL obscurity, that needs a dedicated honored write path — **flagged product decision**.
- Dead 'ports' renderer machinery: `case 'ports'` in bindHtml (settings.js:222-229), `data-type==='ports'` arms in readBind/writeBind (settings.js:405,429), updatePortMasters + call sites (settings.js:340-352, 326, 506), TLS_PORTS/PLAIN_PORTS (home.js:1) — no FL field ever used type 'ports'.
- IP-checker sediment: checker-targets branch (settings.js:564), MAX_TARGETS (lib.js:3), orphaned `#i-play`/`#i-stop` SVG symbols (shell.html:31-32), dead Ctrl+K handler + `#settings-search` lookup (chrome.js:79) and the `shortcuts.search` row (chrome.js:40/53) — the advertised search box does not exist; delete until a real palette ships.
- Users table dead code: `u.token?userSubUrl(u.token)` branch, its never-rendered copy/QR clip markup, the 'New token ready' toast-string-as-placeholder in the token cell (users.js:10-15), and the dead `data-qr` payload on the copy button (users.js:12, DIM 15).
- ~70 dead dict keys ×2 languages: checker.* (20), ports.* (23), proxyip.* (9 — string-duplicates of live egress.* keys), nav.checker, tabs.settings.ports, tabs.settings.proxyip, warp.settings, warp.view.accounts, warp.view.settings, warp.presets.inuse (unless wired to the preset row), toast.saveFailed, toast.langChanged, wizard.s1_title, app.name, common.theme/_light/_dark/_toggle, common.yes/no (only the ports case used them), onboarding.setup.expired (panel copy), err.url/err.ip_or_host/err.ipv6_prefix/err.port + the vestigial err.* translation bridge (settings.js:510-515) — **keep-and-wire instead of deleting: nav.warp (new tab), home.status.total (label fix home.js:120), routing.title (routing card)**; add a computed unused-key guard to test/ui/assets.spec.ts:179 so none can return.
- Unreachable/dead branches: home.js:100 empty-subs branch (buildSubUrls always returns entries) → replace with a capability-gated warning; 'source-doh' action (actions.js:214-218); wizard step-1 inline onclick skip that silently dismisses onboarding (actions.js:545); settings.js:85 `vtype:'url'` annotation (never consumed); no-op `includes('.')` conditions in validIpOrHost (settings.js:541-545); ignored fragment.enable label arg to FL (settings.js:89).
- Visual dead weight: tokens `--ease-bounce/--accent-hover/--accent-down/--shadow-sm`, `.home-grid` hover translateY lift on non-clickable cards (app.css:66), `.btn--primary` ::after shine sweep + `.logo-tile` conic spinring, undefined `var(--line)`/`var(--s-4,16px)` fossils, `title="yes/no"` attribute (settings.js:225), hardcoded `aria-label="?"` overwritten at boot (shell.html:55), unconditional 28px `.tabs` mask that can never scroll with 2+ tabs (app.css:194).
- Home `<details>`-collapsed per-account WARP URL list (warpSubsHtml, warp.js:99-107) once `#/warp` + the hub expose link-chips — it duplicates the detail page behind a hidden two-step copy path.
- 'Panel info' as a copyable/QR importable row (status.ts:54, home.js:96-97) — re-expressed as a labeled footer link in the hub; duplicate nameTemplate placeholders `{IP_NAME}/{WORKER}` (byte-identical to `{LABEL}/{HOST}` in naming.ts:72-77); addresses.card.hint/help duplication; users 'disabled' status chip duplicating the enabled toggle in the same row (keep the toggle).
- **Flagged decisions, not silent deletes:** user_activity bytesUp/bytesDown plumbing (zero writers — delete unless a per-user detail view is committed, DIM 4); Profile-Update-Interval hardcoded 60 min vs the subUpdateIntervalHours setting (headers.ts:41,49-54 — derive or relabel, golden test will move on purpose).

---

## 6. Roadmap — P0 / P1 / P2 with effort

### P0 — stop the bleeding (10 items; total ≈ 1.5–2.5 weeks, mostly S-sized)

| # | Item | Effort |
|---|------|--------|
| 1 | **Promote WARP + Users to top-level tabs** with back-compat redirects — owner pain 1, confirmed by 8 dimensions; `nav.warp` key already exists EN+FA; parseRoute + shell.html + dict are the only touch points | M |
| 2 | **Users zero-state**: reuse the existing `.empty-card` pattern with 'Create first user' CTA, hide table chrome at n=0, add Add-User to the Home card | S |
| 3 | **Users token column**: render `tokenHint`, delete the dead `u.token` branch and the toast-as-placeholder cell — CRITICAL functional bug, the column can never show a URL (users.js:10-15 vs api/users.ts:188-201); pair with relabel 'Daily request limit' → 'Daily subscription fetch limit' + reset semantics (users-sub.ts:77-84) | S |
| 4 | **Light-theme token completion** (~4-line CSS): remap `--success/--warning/--danger` for light, split `--text-faint/--text-ghost`, `.empty-title` → `var(--text)` — closes three CRITICAL WCAG failures at once (app.css:5,228) | S |
| 5 | **Destructive-action confirmations**: settings import overwrites everything with NO confirm (actions.js:46-62), WARP preset delete is a one-click 16px X (actions.js:117-124), Discard bar destroys all unsaved sections silently (actions.js:44-45) — three S-sized confirmDialog wraps, the worst safety gaps in the panel | S |
| 6 | **WARP failure surface**: error card + Retry on failed load (today: three silent blank cards, warp.js:5-6,56-57) and detail-page reorder URLs-first / token collapsed | S each |
| 7 | **securePath: stop the fake save** — delete the control or honor it via a dedicated flow (flagged product decision) | S/M |
| 8 | **Metric honesty**: wire the orphaned `home.status.total` label onto the unlabeled Requests-total cell (home.js:120) and replace the unreachable empty-subs branch with a capability-gated warning — also fixes the RTL orphaned-string finding (DIM 8) | S |
| 9 | **Sub-URL staleness**: `refreshSubUrls` after a protocols-only Apply (settings.js:481) — the main pain-2 residual | S |
| 10 | **Wizard funnel**: step-1 CTA navigates to Protocols WITHOUT setting `qp_wizard_done`, add Escape, add a 'Replay setup guide' entry (actions.js:538-551); pair with the auth.ts bootstrap fix (self-claimed setup must not force a second password change, DIM 12) if it fits the same PR | S |

### P1 — structure and honesty (6 items; ≈ 4–6 weeks)

| # | Item | Effort |
|---|------|--------|
| 1 | **Subscriptions hub `#/subs`**: per-format main links with expanders, per-user links, WARP formats, info-page footer link; single exported FORMAT_LABELS map consumed by hub + info page + WARP detail (subscribe.ts:15, status.ts:45, warp.js:2); one `renderFormatRows` helper so a new registry.ts format can never silently miss the UI, with a fields.spec-style drift test | M/L |
| 2 | **Settings IA merge pass**: Sources→Egress (delete sourceUrls), Fragment+Chain→Tunnel, routing-rules card, Panel-access card, Advanced TLS collapsible — 10→6 subtabs; hash-route-only, no worker router change; add nav.subs/nav.users dict keys | M |
| 3 | **Dead-feature purge with regression guards**: full removals list (§5) executed as one pass + computed unused-dict-key guard (test/ui/assets.spec.ts:179), orphan-SVG and orphan-renderer-case assertions — the sediment spans 6+ dimensions and currently costs ~65 KB of shipped dictionary per page load | M |
| 4 | **WARP UX depth**: group the 17 formats into client families with hints + content-type tags + Amnezia-variants toggle; endpoint preset select honesty — 'Custom (n endpoints)' placeholder and a confirmDialog before switching away from custom endpoints, the only silent-data-loss path in WARP (warp.js:75, actions.js:396) | M |
| 5 | **Users read surface**: expiry countdown, quota used/limit, protocol scope, override badge columns — the API already sends all of it (api/users.ts:188-191) and the 4-state chip is currently the entire read surface; ShareSheet merge for create/rotate lands here | M |
| 6 | **Home first-run companion**: 'Generate your first WARP account' empty CTA + WARP chips on Home so WARP exists on the dashboard before the first account (home.js:98, actions.js:461, DIM 5/9) | S |

### P2 — polish and hardening (6 workstreams; ≈ 6–8 weeks, parallelizable)

| # | Item | Effort |
|---|------|--------|
| 1 | **Accessibility**: shared radiogroup keyboard controller (arrows RTL-flipped, roving tabindex, Home/End); label for/id generation in addrCardHtml + remoteNodeCardHtml + shell override labels; `role=alert` live regions + focus-first-invalid on modal and Apply errors | L |
| 2 | **Performance**: minify JS+CSS in assemblePanel (build-single-file.mjs:24-29, 258 KB→~130 KB), deploy-hash ETag + no-cache revalidation for panel/login (panel-page.ts:9), per-language dict split, O(1) per-section dirty tracking (settings.js:441-467), `withBusy` helper applied to ~10 unprotected mutations, Undo/Redo buttons on the apply bar, one optimistic-toggle helper for kill-switch/user-toggle/preset-select | M |
| 3 | **Mobile**: topbar reflow (hide `.swatches` ≤767px, collapse icon cluster), unified touch-target block, QR/ShareSheet with copy + `navigator.share` + DPR-correct canvas, `viewport-fit=cover` on shell/login metas | M |
| 4 | **FA/RTL polish**: `dir=auto` on the ECH live preview (settings.js:192), translate the 4 hardcoded shell strings (skip link, lang group, tablist label, noscript → `a11y.*` keys via buildShell), faNum/fmtTime/fmtDay i18n utility, WARP format labels → `warp.fmt.*` keys, Vazirmatn font + documented digit policy, RTL line-height bump for 11–12px hints | M |
| 5 | **Contract cleanups**: settle the err.* contract once (server emits err.* codes + FA batch, or delete the bridge — currently two half-implementations); generate client-side validation rules from SETTING_FIELD_DESCRIPTORS to close the 8-of-55 parity gap; one invalid-line policy per list family (silent-drop vs hard-fail vs validate-anything); derive Profile-Update-Interval/Cache-Control from subUpdateIntervalHours in one helper (headers.ts + throttleHeaders); per-URL last-fetch status for remote-sub merge; update-check chip with releases link next to the version row; user_activity plumbing decision (delete or build per-user detail) | M |
| 6 | **UI code organization**: extract totp.js + users modal out of the 621-line settings.js grab bag; one section-scoped dirty/snapshot module replacing S.snap/UR stacks/S.dirty/scheduleDirtyPush | S/M |

---

## 7. Sources

**Audit input**
- `.pi/ui-audit/audit-findings.json` — 17 dimension blocks, 239 findings (6 critical / 47 high / 95 medium / 91 low). All per-finding citations below resolve to this file's evidence fields.
- ⚠️ `.pi/ui-audit/competitors.json` **does not exist on disk**; competitor analysis sourced from `docs/research/` instead.

**Competitor teardowns (repo docs, with canonical repos)**
- `docs/research/01-bpb-panel.md` — BPB-Worker-Panel v5.1.1: https://github.com/bia-pain-bache/BPB-Worker-Panel
- `docs/research/02-edgetunnel.md` — cmliu/edgetunnel v2.x: https://github.com/cmliu/edgetunnel (original history: https://github.com/zizifn/edgetunnel)
- `docs/research/03-nahan.md` — itsyebekhe/nahan v3.0.0: https://github.com/itsyebekhe/nahan
- Pro patterns referenced by audit dims 6/14/15: Cloudflare dash, Tailscale, Uptime Kuma, Linear

**Repo context**
- `AGENTS.md` (project instructions; note stale "66 leaf fields" claim vs 76 descriptor paths)
- `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` (deployment/KV context)

**Most-cited file:line evidence (verified live during this report)**

| Claim | Citation |
|---|---|
| Two-tab topbar is the entire nav | `src/ui/panel/shell.html:42-44` |
| Dead `nav.warp` key (2 hits = en+fa dict lines only) | `src/ui/panel/dict.js:3,20` |
| securePath stripped server-side | `src/handlers/api/settings.ts:63` |
| securePath fake save flow | `src/ui/panel/settings.js:33,478-485` |
| Dead `u.token` branch / toast-as-cell | `src/ui/panel/users.js:8-16` |
| Users API sends hashed `tokenHint`, never `token` on rows | `src/handlers/api/users.ts:188-201`; `test/users/api.spec.ts:115` |
| Light theme token block (no status colors; faint==ghost) | `src/ui/panel/app.css:5` |
| Invisible empty-state title | `src/ui/panel/app.css:228` |
| Unminified, `no-store` panel page | `src/handlers/panel-page.ts:9`; `scripts/build-single-file.mjs:24-29` |
| Ctrl+K → nonexistent `#settings-search` | `src/ui/panel/chrome.js:79,40` |
| Sub-URL staleness after protocols-only save | `src/ui/panel/settings.js:481` |
| Per-user per-format routes with no UI | `src/core/routes.ts:74-80`; `src/handlers/users-sub.ts:52-53` |
| Hardcoded 60-min Profile-Update-Interval | `src/subscription/headers.ts:41,49-54` |
| Users-sub daily quota semantics | `src/handlers/users-sub.ts:77-84` |
| WARP detail order (token before URLs) | `src/ui/panel/warp.js:74-89`; `src/ui/panel/actions.js:459-464` |
| Silent blank WARP failure | `src/ui/panel/warp.js:5-6,56-57` |
| Three dict/label tables for the same formats | `src/handlers/subscribe.ts:15`; `src/handlers/api/status.ts:45-55`; `src/ui/panel/warp.js:2` |
| Cookie-only language zombie | `src/ui/panel/settings.js:39` vs `src/ui/panel/actions.js:398` |
| Write-only fields | `src/ui/panel/settings.js:102` (localDns), `warp.js:10-13` (sourceUrls), `settings.js:153` (city); `src/settings/fields.ts:110,117` |

---

**Report status:** complete. No repository files were modified (read-only audit). Three open product decisions are flagged for the owner, not silently decided: **securePath** (delete vs honor via dedicated flow), **user_activity bytesUp/bytesDown** (delete vs build per-user detail), and **err.* contract direction** (server codes + FA batch vs bridge removal).