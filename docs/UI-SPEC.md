# Q Proxy — UI Specification (v1)

> Authoritative UI/UX spec for the Q Proxy Cloudflare Worker panel. Implementers build exactly this.
>
> **Stack constraints:** server-rendered HTML strings from TypeScript (no framework), vanilla JS client bundle embedded in the worker, zero external CDNs/requests, bilingual EN + FA with RTL, modern dark theme, mobile-friendly. No WARP features anywhere in the UI.
>
> Inputs: `docs/research/01-bpb-panel.md` (§D Panel UI, §C Subscriptions), `docs/research/03-nahan.md` (§E dashboard tabs, bilingual page), `docs/research/04-protocol-formats.md` (share URIs, sub formats, CF port families).

---

## Table of contents

1. [Locked decisions](#1-locked-decisions)
2. [Design tokens](#2-design-tokens)
3. [Page inventory & wireframes](#3-page-inventory--wireframes)
4. [Component inventory](#4-component-inventory)
5. [Interaction specs](#5-interaction-specs)
6. [Accessibility & responsive rules](#6-accessibility--responsive-rules)
7. [i18n dictionary + FA translations](#7-i18n-dictionary--fa-translations)
8. [Implementation notes (vanilla JS)](#8-implementation-notes-vanilla-js)

---

## 1. Locked decisions

Recorded up front so implementation never relitigates them.

| # | Decision | Choice |
|---|----------|--------|
| D1 | Shell architecture | One authenticated page at `{sp}` containing all views (Home / Settings / IP Checker) switched client-side via hash routing (`{sp}#/settings/proxyip`). Login is a separate page. Deep-linkable, no reloads on navigation, one fetch pattern. |
| D2 | Fonts | System font stacks only. **No embedded woff2 in v1.** Stack declares `"Vazirmatn"` first so users who installed it get ideal Persian rendering; falls back through Noto Sans Arabic → Tahoma (solid Persian metrics everywhere). Post-v1 option: embed a ~70 KB Vazirmatn Regular/Bold subset behind a build flag if visual QA fails on a major platform. |
| D3 | QR codes | Client-side rendering only via a vendored qrcode library compiled into the worker bundle. No server QR endpoint, no CDN. |
| D4 | Auth model | Single admin, password-only (no username). Session = `HttpOnly; Secure; SameSite=Strict` cookie, 24 h. First run = forced set-password state of the login page. |
| D5 | Settings save | Explicit PATCH-per-section with optimistic concurrency (`If-Match: <rev>`). No autosave. Toggle switches flip optimistically and revert on failure. |
| D6 | Language | Cookie `qp_lang=en|fa`, 1 year, `Path=/`. Server renders the page in the cookie's language; toggle writes cookie then reloads preserving hash. Client dictionary serves dynamically-generated strings only (toasts, streamed table cells). |
| D7 | Sub URLs | `{sp}/sub[/format][?mode=fragment]`, `format ∈ mixed \| clash \| sing-box`, plus bare `{sp}/sub` universal row (UA negotiation server-side). |
| D8 | Secrets in UI | Credentials (UUIDs, passwords, secure path) render masked with reveal + copy + generate actions. |

---

## 2. Design tokens

### 2.1 Color palette (dark theme)

Single dark theme only — no light theme in v1.

```css
:root {
  /* Surfaces */
  --bg:            #0a0e14;   /* page background */
  --surface:       #101720;   /* cards, panels */
  --surface-2:     #16202b;   /* inputs, nested blocks, table headers */
  --surface-3:     #1d2937;   /* hover / active raised elements */

  /* Borders */
  --border:        #24303f;
  --border-strong: #33465c;

  /* Text */
  --text:          #e7eef5;   /* primary */
  --text-dim:      #96a7b8;   /* secondary, labels */
  --text-faint:    #61758a;   /* hints, placeholders */

  /* Accent (cyan = "network" semantics) */
  --accent:        #22d3ee;
  --accent-hover:  #5ce1f5;
  --accent-down:   #0ea5c9;
  --accent-ink:    #052430;   /* text/icons ON accent fills */
  --accent-bg:     rgba(34, 211, 238, .10);

  /* Status */
  --success:       #43d17c;  --success-bg: rgba(67, 209, 124, .12);
  --warning:       #f5b83d;  --warning-bg: rgba(245, 184, 61, .12);
  --danger:        #f4718a;  --danger-bg:  rgba(244, 113, 138, .12);

  /* Focus ring */
  --ring:          #7fe3f7;

  /* Overlays */
  --overlay:       rgba(4, 7, 10, .72);
}
```

Usage rules:

- Body text `--text`; labels/hints `--text-dim`; never `--text-faint` below 11 px.
- Primary buttons: `--accent` fill + `--accent-ink` label. Ghost buttons: transparent + `--border-strong` border.
- Danger actions (logout, secure-path regenerate, reset defaults): `--danger` text/border, `--danger-bg` hover fill; always pass through confirm dialog (§5.6).
- Status colors: kill-switch ON = `--danger`, healthy checker row = `--success`, degraded (<100 %) = `--warning`.
- No gradients. Flat surfaces separated by 1 px borders; depth comes only from overlay + modal shadows.

### 2.2 Spacing scale

4 px base grid; no arbitrary margins.

```css
:root { --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px; --s-8:64px; }
```

Card padding `--s-4` mobile / `--s-5` ≥768 px; gaps between form rows `--s-4`; section title → content `--s-3`; icon → label `--s-2`.

### 2.3 Typography

```css
:root {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
               Arial, "Vazirmatn", "Vazir", "IRANSansX", "Noto Sans Arabic",
               "Noto Sans", Tahoma, sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, Menlo,
               "Courier New", monospace;
  --fs-xs: 11px;   /* badges, table meta */
  --fs-sm: 12px;   /* labels, hints */
  --fs-md: 13px;   /* BASE — body, inputs, buttons */
  --fs-lg: 15px;   /* card titles */
  --fs-xl: 18px;   /* view titles */
  --fs-2xl: 24px;  /* login title */
}
```

- Base 13 px, line-height 1.5; headings 1.25. Weights: 400 / 600 / 700 only.
- `--font-mono` mandatory for: subscription URLs, share URIs, UUIDs, passwords, IPs, secure path, ports, latency. URLs get `word-break: break-all`.
- Same stack serves both directions; Persian glyphs resolve via Vazirmatn/Noto/Tahoma automatically.
- Latin digits everywhere (no Eastern-Arabic numerals) — data stays copy-safe.

### 2.4 Radius, shadow, motion

```css
:root {
  --r-sm: 6px;    --r-md: 10px;   --r-lg: 14px;   --r-full: 999px;
  --shadow-pop:   0 8px 24px rgba(0,0,0,.45);    /* dropdowns, toasts */
  --shadow-modal: 0 24px 64px rgba(0,0,0,.55);   /* modal dialogs */
}
```

Cards/inputs carry **no shadow** — 1 px `--border` only; shadows are for floating layers.

Motion: 120 ms ease-out color/background transitions; 160 ms transform/opacity; modal + toast entrance translateY(8px)→0 fade 160 ms; login failure shake ±6 px 240 ms. `prefers-reduced-motion: reduce` kills all transforms (opacity fades ≤80 ms stay).

---

## 3. Page inventory & wireframes

### 3.1 Route map

All panel routes live under the secret path `{sp}`. Mutations are `POST/PATCH` under `{sp}/api/...` and return JSON.

```
GET    {sp}                          App shell (Home/Settings/Checker views).
                                     302 → {sp}/login when no valid session.
GET    {sp}/login                    Login page; setup-mode variant when no
                                     password exists yet (first run).
GET    {sp}/logout                   Clears cookie → 302 {sp}/login.

POST   {sp}/api/auth/login           {password}  → 204 + Set-Cookie | 401 | 429
POST   {sp}/api/auth/setup           {password}  → 204 + Set-Cookie | 409 already-set | 400
GET    {sp}/api/state                Full snapshot (auth'd):
                                     { rev, lang, settings{…}, subs{…}, myIp? }
PATCH  {sp}/api/settings/:section    section ∈ general | protocols | ports |
                                     proxyip | fragment | chain | advanced
                                     Headers: If-Match: <rev>; body = changed fields only.
                                     → 200 {rev, warnings?} | 400 {errors:{field:msg}}
                                       | 409 {rev} stale | 401
POST   {sp}/api/settings/reset       {} → 200 {rev, settings}   (confirm-gated)
POST   {sp}/api/general/secure-path  {} → 200 {securePath, subs} (regenerate; confirm-gated;
                                                              rotates session secret too)
POST   {sp}/api/generate/:kind       kind ∈ uuid | vmess-uuid | trojan-pass | ss-pass | path
                                     → 200 {value}   pure generator; value lands in the
                                                     form and persists only via PATCH.
POST   {sp}/api/proxyip/check        {ips:[string]} → 202 {jobId}      (≤100 targets)
GET    {sp}/api/proxyip/check/:jobId → {status:"running"|"done"|"error", done, total,
                                        results:[{target,port,ok,avgLatencyMs,
                                                  successRate,country,city,isp}]}
DELETE {sp}/api/proxyip/check/:jobId → 204 cancel

GET    {sp}/sub                      Universal subscription (server-side UA negotiation).
GET    {sp}/sub/:format              format ∈ mixed | clash | sing-box; ?mode=fragment
ANY    *                             Camouflage/fallback per Advanced setting — never a
                                     panel-looking 404.
```

Auth rules: `{sp}`, `/logout`, and all `/api/*` require the session cookie (401 → client redirects to `{sp}/login`); `auth/setup` additionally requires that no password exists. `{sp}/sub*` is gated by knowledge of `{sp}` alone (secret-path auth, BPB-style) — browsers hitting it get landing/camouflage treatment, never the panel.

### 3.2 Login page — `GET {sp}/login`

Full-viewport centered card on `--bg`; no header/nav. Two variants driven by a server-injected boot flag.

```
┌──────────────────────────────────────────────┐
│                                              │
│                  ◆ Q Proxy                   │  ← wordmark --fs-2xl
│           cloudflare proxy panel             │  ← tagline --text-dim
│                                              │
│        ┌──────────────────────────┐          │
│        │  Passphrase              │          │  ← label --fs-sm
│        │  ┌────────────────────┐  │          │
│        │  │ ••••••••••      👁 │  │          │  ← input + reveal toggle
│        │  └────────────────────┘  │          │
│        │  ⚠ Wrong passphrase      │          │  ← error slot (hidden default)
│        │  ┌────────────────────┐  │          │
│        │  │      Sign in       │  │          │  ← primary btn full-width
│        │  └────────────────────┘  │          │
│        └──────────────────────────┘          │
│                                              │
│                  EN | فا                     │  ← lang segmented control
└──────────────────────────────────────────────┘
```

**Setup variant (forced first run).** Same card; title "Create passphrase"; fields = new passphrase + confirm; live strength hint line (`--warning/--accent/--success`); **no cancel/close — cannot be dismissed**; submit → auto sign-in → redirect `{sp}`. Server rejects `auth/setup` with 409 if a password already exists → client redirects to normal login mode. Card width 360 px (max 92 vw), radius `--r-lg`.

### 3.3 App shell — `GET {sp}`

Sticky top bar + view container. Views swap client-side via hash router: `#/home` (default), `#/settings[/section]`, `#/checker`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◆ Q Proxy    Home   Settings   IP Checker               EN|فا   ⏻  │ top bar (sticky)
├──────────────────────────────────────────────────────────────────────┤
│                          (active view)                               │
│            container max-width 1080px, centered                      │
└──────────────────────────────────────────────────────────────────────┘
```

Top bar: `--surface`, bottom `--border`. Logo start-aligned; primary tabs beside it (active = 2 px `--accent` underline); end cluster = language segmented control + logout icon-button (ghost-danger, confirm-gated). Mobile <768 px: tabs move to a second horizontally-scrollable pill row; end cluster keeps lang + logout.

#### View: Home (`#/home`) — dashboard

Subscriptions block first (most-used), quick stats second.

```
┌─ Subscriptions ────────────────────────────────────────────────────┐
│  Mode: ( Normal | Fragment )          ← seg control → ?mode= param │
│                                                                    │
│  Universal · auto-detect client                                    │
│  ┌──────────────────────────────────────────────┐  ┌────┐ ┌────┐   │
│  │ https://xxx.workers.dev/AbC123/sub           │  │ ⧉  │ │ ▦  │   │ copy-field + QR
│  └──────────────────────────────────────────────┘  └────┘ └────┘   │
│  Mixed · Base64                                                    │
│  │ …/{sp}/sub/mixed                                            │   │
│  Clash / Mihomo · YAML                                             │
│  │ …/{sp}/sub/clash                                           │   │
│  sing-box · JSON                                                   │
│  │ …/{sp}/sub/sing-box                                        │   │
└────────────────────────────────────────────────────────────────────┘
┌─ My IP & egress ─────────────────────────────────────── [Refresh] ─┐
│  Kill switch        ● PAUSED        ( toggle )                     │
│  Clients get HTTP 503; this panel stays reachable.                 │
│ ────────────────────────────────────────────────────────────────── │
│              Via Cloudflare targets     Via other targets          │
│   IP        104.28.x.x (mono)         198.51.100.7 (mono)         │
│   Country   🇺🇸 United States          🇩🇪 Germany                  │
│   City      Frankfurt                 Nuremberg                   │
│   ISP       Cloudflare, Inc.          Contabo GmbH                │
│   CF colo   FRA                       —                           │
│   fetched just now · refreshes on demand                           │
└────────────────────────────────────────────────────────────────────┘
```

QR button opens the QR modal for that exact URL. ≥1024 px the two blocks may sit side-by-side (grid 3fr / 2fr).

#### View: Settings (`#/settings/*`)

Pill sub-tab bar (horizontally scrollable) + card stack per section. Sticky save bar appears only when dirty.

```
[General] [Protocols] [Ports & Domains] [Proxy IP] [Fragment] [Chain proxy] [Advanced]

General:
│ Secure path                                                        │
│ ┌──────────────────────────────────┐ ┌────┐ ┌────┐                 │
│ │ AbC123xYz…              (masked) │ │ 🎲 │ │ ⧉ │   secret-field   │
│ └──────────────────────────────────┘ └────┘ └────┘                 │
│ Changing this invalidates every panel & sub URL.                   │
│ Kill switch                                ( toggle )              │
│ Language                                   [ English ▾ ]           │

Protocols (2×2 card grid ≥768 px, stacked mobile):
│ ┌ VLESS ──────────────┐  ┌ VMess ──────────────┐                   │
│ │ Enabled   (toggle)  │  │ Enabled   (toggle)  │                   │
│ │ UUID                │  │ UUID                │                   │
│ │ [•••••••] 🎲 ⧉ 👁   │  │ [•••••••] 🎲 🧹 👁  │  🧹=clear         │
│ └─────────────────────┘  └─────────────────────┘                   │
│ ┌ Trojan ─────────────┐  ┌ Shadowsocks ────────┐                   │
│ │ Enabled   (toggle)  │  │ Enabled   (toggle)  │                   │
│ │ Password            │  │ Password            Cipher [aes-…]  │
│ │ [•••••••] 🎲 ⧉ 👁   │  │ [•••••••] 🎲 ⧉ 👁   │                   │
│ └─────────────────────┘  └─────────────────────┘                   │
Disabled protocol: card dims (.55), inputs disabled, toggle live.

Ports & domains:
│ Custom domains                                  [ + Add domain ]   │
│ [ vpn.example.com          ] ⨯   [ cdn.example.org ] ⨯            │ editable rows
│ Port matrix (orange-clouded hosts serve all enabled ports)         │
│ TLS   443  2053  2083  2087  2096  8443                            │
│      [✓]   [✓]    [ ]    [✓]    [ ]    [✓]                         │ port-matrix
│ Plain 80   8080  8880  2052  2082  2086  2095                      │
│      [✓]   [ ]    [ ]    [ ]    [ ]    [ ]    [ ]                  │
│ Clean addresses (one per line)                                     │
│ ┌──────────────────────────────────────────────┐                   │
│ │ 91.98.x.x / fast.example.net                 │  line-editor      │
│ Remote subscriptions to merge (https:// URLs)                      │
│ ┌──────────────────────────────────────────────┐  line-editor      │

Proxy IP:
│ Mode: ( Auto public feed | Static list | NAT64 prefixes )          │ chip radio
│ Static list (host:port allowed)               [ Open IP Checker ]  │
│ ┌──────────────────────────────────────────────┐                   │
│ │ 152.53.x.x:443                               │  line-editor      │
│ NAT64 mode swaps textarea for IPv6 prefix list.                    │

Fragment:
│ Enable fragmentation                        ( toggle )             │
│ Preset: ( Low | Medium | High | Severe | Custom )                  │ chips fill+lock fields
│ Length min–max   [ 50 ] – [ 100 ]      Delay ms min–max [ 1 ]–[ 5 ]│
│ Packets          [ tls hello ▾ ]                                   │
│ Smart sweep      ( toggle )  sweeps 20 length ranges (1–5 … 100–200)
│                              in one profile; overrides manual length.

Chain proxy:
│ Enable chain proxy                          ( toggle )             │
│ Type ( SOCKS5 | HTTP )    Address [10.0.0.1]  Port [1080]          │
│ Username [optional]       Password [•••••••• 👁]                   │

Advanced:
│ DoH upstream                                                       │
│ [ https://cloudflare-dns.com/dns-query ]                           │
│ Your private DoH: {sp}/dns-query  ⧉          read-only + copy     │
│ Camouflage page            [ None (plain 404) ▾ ]                  │
│ Intercept speed tests      ( toggle )  fake throughput responses   │

Sticky bar when dirty:
│ ● Unsaved changes                     [ Discard ] [ Apply changes ]│
```

#### View: IP Checker (`#/checker`)

```
┌─ Proxy IP checker ─────────────────────────────────────────────────┐
│ Targets (one IP or host:port per line, max 100)                    │
│ ┌────────────────────────────────────────────┐                     │
│ │ 152.53.x.x:443                             │  line-editor        │
│ │ bpb.example.com                            │                     │
│ └────────────────────────────────────────────┘                     │
│ ⚠ Invalid: 300.1.2.3                                 42 / 100      │
│ [ Run test ]  [ Stop ]                                             │
│ ████████████░░░░░░░░░░░░  12 / 42                                  │ progress (running)
│ Results                                                            │
│ Target            Location      ISP        Latency   Success     │
│ 152.53.x.x:443 🇩🇪 Nuremberg    Contabo     84 ms     100 % ✓     │
│ bpb.example.com 🇳🇱 Amsterdam   Leaseweb    132 ms    80 % ⚠      │
│ 300.1.2.3        skipped — invalid input                  ✗        │
└────────────────────────────────────────────────────────────────────┘
```

Rows stream in while the job runs (§5.3). Row status glyphs: ✓ success, ⚠ partial (<100 %), ✗ failed. Empty state text: "No results yet."

### 3.4 Modals

- **QR modal** — opened from any sub row's `▦`: 280×280 white-backed canvas QR, caption = encoded URL as a copy-field, hint line "Scan with your proxy client", Close.
- **Confirm dialog** — title/body/Cancel(ghost)/Confirm(primary or danger). Promise-based. Used by logout, secure-path regenerate, reset-to-defaults, kill-switch ON.
- No other modals in v1.

---

## 4. Component inventory

Each component = one server-side render function + one CSS block + (where interactive) delegated JS behavior. Names are canonical for code identifiers (`renderCard`, `.card`, `data-action="copy"`).

### 4.1 Card — `.card`

`<section class="card">`: bg `--surface`, border 1 px `--border`, radius `--r-md`, padding `--s-4`/`--s-5`. Optional `<div class="card__head">` with `.card__title` (--fs-lg, 600) and end-aligned actions. Dimmed variant `.card--dim { opacity:.55 }`.

### 4.2 Field — `.field`

Form atom wrapping every input:

```html
<div class="field" data-field="general.securePath">
  <label class="field__label" for="f-secure-path">Secure path</label>
  <div class="field__control"><!-- input / select / textarea / secret-field --></div>
  <p class="field__hint" id="f-secure-path-hint">Helper text.</p>
  <p class="field__error" id="f-secure-path-err" hidden></p>
</div>
```

Error state `.field--error`: control border `--danger`; error text shown, hint hidden; input gets `aria-invalid="true"` + `aria-describedby` pointing at the error id. Labels always visible (never placeholder-as-label). Inputs default `autocomplete="off" spellcheck="false"`.

### 4.3 Button — `.btn`

Variants: `.btn--primary` (accent fill), `.btn--ghost` (border only), `.btn--ghost-danger`, `.btn--icon` (36×36 icon-only, **requires** `aria-label`), `.btn--sm` (28 px dense rows). Height 38 px visual, ≥44 px touch hit area via padding on coarse pointers (§6.1). Radius `--r-sm`, weight 600. Disabled: opacity .45, no pointer events. Loading: inline spinner replaces label + `aria-busy="true"`.

### 4.4 Secret-field — `.secret-field`

Composite for sensitive/generated values:

```html
<div class="secret-field">
  <input class="input input--mono" type="password" value="…" readonly
         autocomplete="new-password" aria-label="Value">
  <button class="btn btn--icon" data-action="reveal"   aria-label="Reveal" aria-pressed="false">👁</button>
  <button class="btn btn--icon" data-action="copy"     aria-label="Copy">⧉</button>
  <button class="btn btn--icon" data-action="generate" aria-label="Generate">🎲</button>
</div>
```

Reveal toggles `type` + `aria-pressed`. Generate → `POST api/generate/:kind`, writes result into the input (now editable), marks section dirty, toasts "Generated — Apply to save." Display-only contexts (DoH URL) omit generate. Icons are inline SVG glyphs from the sprite (§8), not emoji.

### 4.5 Copy-field — `.copy-field`

Read-only value display + copy (subscription URLs, private DoH):

```html
<div class="copy-field">
  <code class="copy-field__value" dir="ltr">https://…</code>
  <button class="btn btn--icon btn--sm" data-action="copy" data-copy="https://…" aria-label="Copy">⧉</button>
</div>
```

Value: mono `--fs-sm`, single-line ellipsis (clipboard always gets the full string; QR shows it fully). Success: button glyph swaps to check for 900 ms + toast "Copied".

### 4.6 Toggle switch — `.switch`

```html
<label class="switch">
  <input type="checkbox" role="switch" data-bind="killSwitch">
  <span class="switch__track"><span class="switch__thumb"></span></span>
  <span class="switch__label">Kill switch</span>
</label>
```

Track 40×22, thumb 18, radius full. Off: track `--surface-3` + `--border-strong`; On: track `--accent`, thumb `--accent-ink`. Whole label is the hit target. Pending state during PATCH: track pulses opacity, pointer-events none. Native checkbox = free keyboard support.

### 4.7 Modal base + QR modal

Base: `position:fixed inset:0; background:var(--overlay); display:grid; place-items:center; z-index:100`. Panel: `--surface`, radius `--r-lg`, `max-width:min(360px,92vw)`, shadow-modal, padding `--s-5`. All modals: `role="dialog" aria-modal="true" aria-labelledby`, focus trap, Escape closes, backdrop click closes, focus returns to opener.

QR modal specifics: canvas 280×280 CSS px at 2× DPR; modules dark `#0a0e14` on white; quiet zone 4 modules; ECC M. Caption copy-field holds the exact encoded string. Opened by any element with `data-action="qr" data-qr="<url>"`.

### 4.8 Toast — `.toast-stack > .toast`

Fixed bottom-center (16 px above bottom + safe-area). Max 3 visible; success/info auto-dismiss 3.5 s, errors 6 s. Variants tint a 3 px start-border: ok/success, err/danger, info/accent. Optional single action button ("Reload", "Discard"). Container `role="status" aria-live="polite"`; errors additionally `role="alert"` on the toast. API: `toast(msgKey|msg, kind, opts?)`.

### 4.9 ip-table — `.egress-table`

Dual-column comparison table (Home). Semantic `<table>`; header cells `--fs-xs` uppercase `--text-faint` tracking .04 em; IP/colo cells `.mono dir="ltr"`. Columns: row-label (muted) + "Via Cloudflare" + "Via other". Rows: IP, Country (flag emoji + name), City, ISP, CF colo. <480 px: CSS-only collapse to stacked labelled blocks (`thead` visually hidden; each `td` shows its label via `::before`). Loading = skeleton shimmer bars; failure = one error row with inline Retry.

### 4.10 Port matrix — `.port-matrix`

Two `<fieldset>`s (TLS family 443/2053/2083/2087/2096/8443, plaintext family 80/8080/8880/2052/2082/2086/2095):

```html
<fieldset class="port-matrix"><legend>TLS ports</legend>
  <label class="port-cell"><input type="checkbox" value="443" checked><span>443</span></label> …
</fieldset>
```

Cells 52×40 px mono; checked = `--accent-bg` bg + `--accent` border + check glyph. Legend carries a master checkbox toggling all children (indeterminate when partial). Plaintext-family hint appears when a custom domain exists and TLS-only is enforced server-side (from save response `warnings[]`).

### 4.11 Tab bars

- Primary tabs: `<nav role="tablist">`, `role="tab"` anchors to hashes, `aria-selected`, 2 px accent underline on active.
- Settings sub-tabs `.subtabs > .subtab`: pill radius full; selected = `--accent-bg` bg + `--accent` text; container `overflow-x:auto` with edge fade masks.

Both manage `hidden` on their panels and update the hash without triggering scroll jumps.

### 4.12 Line editor — `.line-editor`

Multi-line list input (clean addrs, remote subs, proxy-IP list, checker targets): `<textarea rows="6" class="input input--mono" dir="ltr" spellcheck="false">`. On input (debounced 250 ms): split lines, trim, drop blanks; error slot lists offending lines ("Invalid: x", duplicates flagged); counter chip "n / max". Never mutates user text. Values are submitted as arrays.

### 4.13 Chip radio group — `.chip-row > .chip`

`<div role="radiogroup">` of `<button role="radio" aria-checked>` chips. Used for: proxy-IP mode, fragment presets, chain type. Selected chip: `--accent-bg` + `--accent`. Fragment preset selection fills length/delay inputs and disables them; "Custom" enables editing.

### 4.14 Segmented control — `.seg`

Compact exclusive switch (language EN|فا; subscription mode Normal|Fragment): height 32 px, same contract as chips, language instance carries `data-action="set-lang"`.

### 4.15 Progress bar — `.progress`

Checker progress: 6 px track `--surface-3`, fill `--accent`; `role="progressbar"` with aria-valuemin/max/now; numeric label "12 / 42" beside.

### 4.16 Select — `.select`

Native `<select>` styled: height 38 px, `--surface-2`, custom chevron via background SVG data-URI (end side flips in RTL through logical positioning). Used for cipher method, camouflage page, packets preset.

### 4.17 Status dot / chip — `.dot`, `.chip-status`

8 px dot or small pill for state at a glance (kill-switch PAUSED, job running). Colors per §2.1 status rules.

---

## 5. Interaction specs

### 5.1 Login flow states

State machine (server flag `mode` in boot payload decides initial render):

| State | Trigger | UI |
|---|---|---|
| `login:idle` | default | form enabled |
| `login:submitting` | submit | button spinner + disabled; no double-submit |
| `login:error` | 401 | field error "Wrong passphrase", shake animation, focus returns to password, text preselected |
| `login:locked` | 429 | error shows retry countdown from `Retry-After`; submit disabled until 0 |
| `login:success` | 204 | brief "Redirecting…" → `location = {sp}{next}` (`?next=` sanitized: must start with `/`, no `//`) |
| `setup:*` | boot mode=setup | forced variant; same submitting/error states; mismatch error when confirm ≠ password; success → `{sp}` |

Rate limiting is server-side (e.g. 5 failures / 15 min per IP) — the UI only reflects it. Language toggle on login works identically to §5.4 (cookie + reload).

### 5.2 Save-settings flow (PATCH semantics)

- Each settings section owns one form bound to section key; **snapshot** taken at load (`data-bind` fields → canonical JSON).
- Any `input`/`change` inside the section recomputes dirty = snapshot ≠ current; dirty toggles the sticky bar and enables Apply.
- Apply → collect only changed leaf fields → `PATCH {sp}/api/settings/:section` with `If-Match: rev`.
- **200**: update local `rev` + snapshot; toast "Saved"; apply any `warnings[]` as info toasts.
- **400** `{errors:{field:"err.key"}}`: render each under its `.field` (i18n key lookup), add `aria-invalid`, focus first invalid field, toast "Fix N errors".
- **409**: someone saved elsewhere → confirm dialog "Reload to get latest?" → reload.
- **Network fail / 5xx**: toast error; keep form state (nothing lost).
- **Optimistic toggles** (`killSwitch`, protocol enables, fragment enable/smart-sweep): flip instantly with pending pulse; revert visual state on failure. Scalar/text fields never pretend — they wait for Apply.
- Discard → restore snapshot into inputs, clear dirty.
- Kill switch ON additionally requires confirm dialog before flipping (destructive).
- Secure-path regenerate: confirm dialog (lists consequences) → POST → success modal shows new path once → hard redirect to `/{newSp}#/settings/general`.
- No autosave anywhere: saves are user-initiated so config churn stays deliberate.

### 5.3 Checker async polling

1. Validate targets client-side (dedupe, cap 100); invalid lines stay in the textarea with inline errors and are excluded.
2. `POST api/proxyip/check {ips:[…]}` → `202 {jobId}`; UI enters running state (progress bar 0/n, Stop enabled, Run hidden).
3. Poll `GET api/proxyip/check/:jobId` every **800 ms**; merge `results[]` incrementally into the table (append/update by target key); update progress `done/total`.
4. `status==="done"` → final paint, Run re-enabled, toast summary "{ok} healthy of {total}".
5. Stop → `DELETE …/:jobId` → poll until status confirms; partial results remain.
6. Robustness: poll pauses on `visibilitychange:hidden`; two consecutive poll failures stop polling and toast an error but keep partial results. Server executes checks concurrently (≤5 sockets, 5 s timeout each, aggregated over attempts) — jobs are isolate-local with short TTL; if a poll 404s mid-run, client surfaces "Job expired — run again" (acceptable v1 tradeoff).

### 5.4 Language toggle persistence & RTL mechanics

- Toggle sets `document.cookie = qp_lang=<en|fa>; Path=/; Max-Age=31536000; SameSite=Lax` then `location.reload()` preserving `location.hash`. Server reads cookie → renders `<html lang dir>` + translated strings + correct stylesheet direction. Full reload guarantees zero mixed-language leftovers; cost is one request, acceptable for a settings action.
- Client dictionary (embedded JSON, §7) covers all JS-generated strings in the active language; it is swapped atomically on reload.
- RTL implementation contract: **all layout uses CSS logical properties** (`margin-inline-*`, `padding-inline-*`, `inset-inline-*`, `border-inline-start`, `text-align:start/end`) — `[dir=rtl]` overrides exist only for directional glyphs (chevrons, arrows: `transform:scaleX(-1)` via `[dir=rtl] .icon-flip`) and the progress fill direction. Technical strings always wrap in LTR isolation: `<code dir="ltr">`, `unicode-bidi:isolate` (see §6.5).

### 5.5 Copy interactions

All copy actions go through one helper: `navigator.clipboard.writeText` → fallback `textarea+execCommand('copy')` (for non-secure-context previews). Success feedback: glyph swap + toast. QR modal copies the exact URI/URL string that was encoded.

### 5.6 Confirm dialog API

`confirmDialog({titleKey, bodyKey, danger?}) → Promise<boolean>`. Focus lands on Cancel for destructive actions, Confirm otherwise; Escape/backdrop = false.

---

## 6. Accessibility & responsive rules

### 6.1 Touch targets

Minimum hit area **44×44 px** on coarse pointers (media `(pointer:coarse)`) even when the visual control is smaller (icon buttons get transparent padding expansion); ≥8 px gap between adjacent targets. Desktop keeps compact sizes.

### 6.2 Focus & keyboard

- Global: `:focus-visible { outline:2px solid var(--ring); outline-offset:2px; border-radius:inherit }` — never removed.
- Tab order follows DOM order (views hidden with `hidden` attr are untabbable automatically).
- Tabs implement roving tabindex + Arrow/Home/End keys (WAI-ARIA tabs pattern).
- Modal trap: Tab cycles inside; Escape closes; focus restored to opener.
- Shortcuts: none required in v1 (avoid conflicts with RTL keyboard layouts).

### 6.3 Semantics & live regions

- Landmarks: single `<main>`, `<nav>` for tabs, `<header>`. One `<h1>` (view title).
- All inputs have persistent visible `<label>`s; hints/errors linked via `aria-describedby`; invalid controls set `aria-invalid`.
- Toast stack `role=status aria-live=polite`; error toasts `role=alert`.
- Progress bar exposes `role=progressbar` values; checker table updates announced via a visually-hidden polite region ("12 of 42 done").
- Tables use real `<th scope>`; port matrix uses `<fieldset><legend>`.

### 6.4 Contrast & motion

Text pairs used all pass ≥4.5:1 (`--text` ≈15:1, `--text-dim` ≈7:1 on surfaces; accent-on-ink buttons ≥8:1). Non-text indicators (borders/dots) ≥3:1. `prefers-reduced-motion` handled per §2.6.

### 6.5 Bidirectionality rules

- Every URL, UUID, IP, path, latency renders inside `dir="ltr"` + `unicode-bidi:isolate` container — prevents RTL punctuation mangling.
- Flags/emoji neutral; status glyphs placed at logical end of cell.
- Persian strings authored with proper ZWNJ (نیم‌فاصله) where orthographically required (dictionary below does this).

### 6.6 Breakpoints

Mobile-first. Breakpoints exactly **360 / 768 / 1024**:

| Range | Layout |
|---|---|
| <360 tested floor | no horizontal page overflow; long URLs scroll inside their own field; primary nav collapses to icons if needed |
| 360–767 | single column; top-bar tabs move to scrollable second row; cards padding `--s-4`; egress table stacked layout; sticky save bar full-width |
| 768–1023 | single column, roomier padding; protocol cards 2×2 grid; sub-tab pills comfortable |
| ≥1024 | content max-width 1080 centered; Home blocks may go 3fr/2fr grid; hover states active |

Touch-target rule applies ≤767 regardless of pointer precision detection quirks.

---

## 7. i18n dictionary & FA translations

### 7.1 Structure

- Dictionary = nested object with dot-namespaced leaves, authored once in TS (`src/ui/i18n.ts`): `dict.en["home.subs.title"]`, `dict.fa[...]`. Server resolves strings at render time from the active language; the **entire active dictionary** is also embedded in the page boot payload for client-side lookups (toasts, streamed rows).
- Placeholders use `{name}`; `t(key, {name:value})` interpolates. Missing key → key string returned (fail loud in dev).
- Persian copy uses ZWNJ (نیم‌فاصله) correctly and keeps technical tokens (Base64, YAML, DoH, NAT64, TLS…) in Latin script.
- Complete key list follows. This is the authoritative inventory — every UI string must come from here; no hardcoded copy anywhere.

### 7.2 Complete EN/FA table

| Key | English | فارسی |
|---|---|---|
| app.name | Q Proxy | Q Proxy |
| app.tagline | Cloudflare proxy panel | پنل پراکسی کلادفلر |
| nav.home | Home | خانه |
| nav.settings | Settings | تنظیمات |
| nav.checker | IP Checker | بررسی آی‌پی |
| nav.logout | Log out | خروج |
| lang.en | English | English |
| lang.fa | فارسی | فارسی |
| login.title | Sign in to Q Proxy | ورود به Q Proxy |
| login.password | Passphrase | گذرواژه |
| login.submit | Sign in | ورود |
| login.submitting | Signing in… | در حال ورود… |
| login.redirecting | Redirecting… | در حال انتقال… |
| login.error.wrong | Wrong passphrase | گذرواژه نادرست است |
| login.error.locked | Too many attempts. Try again in {seconds}s. | تلاش بیش از حد. بعد از {seconds} ثانیه دوباره امتحان کنید. |
| setup.title | Create passphrase | ساخت گذرواژه |
| setup.hint | Choose a strong passphrase to protect this panel. | برای محافظت از این پنل یک گذرواژهٔ قوی انتخاب کنید. |
| setup.new | New passphrase | گذرواژهٔ جدید |
| setup.confirm | Confirm passphrase | تکرار گذرواژه |
| setup.strength.weak | Weak | ضعیف |
| setup.strength.ok | OK | قابل قبول |
| setup.strength.strong | Strong | قوی |
| setup.rule | At least 8 characters, one uppercase letter and one digit. | حداقل ۸ نویسه شامل یک حرف بزرگ و یک رقم. |
| setup.error.mismatch | Passphrases do not match | دو گذرواژه یکسان نیستند |
| setup.submit | Save and continue | ذخیره و ادامه |
| common.apply | Apply changes | اعمال تغییرات |
| common.applying | Applying… | در حال اعمال… |
| common.saved | Saved | ذخیره شد |
| common.discard | Discard | نادیده گرفتن |
| common.cancel | Cancel | انصراف |
| common.close | Close | بستن |
| common.confirm | Confirm | تأیید |
| common.copy | Copy | کپی |
| common.copied | Copied | کپی شد |
| common.generate | Generate | تولید |
| common.generated | Generated — Apply to save. | تولید شد؛ برای ذخیره «اعمال تغییرات» را بزنید. |
| common.reveal | Reveal | نمایش |
| common.hide | Hide | پنهان |
| common.add | Add | افزودن |
| common.remove | Remove | حذف |
| common.resetDefaults | Reset to defaults | بازگشت به پیش‌فرض‌ها |
| common.unsaved | Unsaved changes | تغییرات ذخیره‌نشده |
| common.error | Something went wrong | خطایی رخ داد |
| common.loading | Loading… | در حال بارگذاری… |
| common.optional | optional | اختیاری |
| common.on | On | روشن |
| common.off | Off | خاموش |
| common.enabled | Enabled | فعال |
| common.disabled | Disabled | غیرفعال |
| common.yes | Yes | بله |
| common.no | No | خیر |
| common.retry | Retry | تلاش دوباره |
| common.openChecker | Open IP Checker | باز کردن بررسی آی‌پی |
| common.fixErrors | Fix {count} error(s) | {count} خطا را برطرف کنید |
| home.subs.title | Subscriptions | اشتراک‌ها |
| home.subs.desc | Import these URLs into your proxy client. | این نشانی‌ها را در کلاینت خود وارد کنید. |
| home.subs.mode.normal | Normal | عادی |
| home.subs.mode.fragment | Fragment | فرگمنت |
| home.subs.universal | Universal · auto-detect client | همگانی · تشخیص خودکار کلاینت |
| home.subs.mixed | Mixed · Base64 URI list | ترکیبی · فهرست Base64 |
| home.subs.clash | Clash / Mihomo · YAML | Clash / Mihomo · YAML |
| home.subs.singbox | sing-box · JSON | sing-box · JSON |
| home.stats.title | My IP & egress | آی‌پی من و مسیر خروجی |
| home.stats.refresh | Refresh | بازخوانی |
| home.stats.via_cf | Via Cloudflare targets | از طریق مقصدهای کلادفلر |
| home.stats.via_other | Via other targets | از طریق مقصدهای دیگر |
| home.stats.ip | IP | IP |
| home.stats.country | Country | کشور |
| home.stats.city | City | شهر |
| home.stats.isp | ISP | سرویس‌دهنده |
| home.stats.colo | CF colo | دیتاسنتر کلادفلر |
| home.stats.updated | Fetched just now · refreshes on demand | همین حالا دریافت شد · با درخواست به‌روز می‌شود |
| home.stats.failed | Could not fetch IP info. | دریافت اطلاعات آی‌پی ممکن نشد. |
| home.kill.title | Kill switch | کیل سوییچ |
| home.kill.paused | Traffic paused | ترافیک متوقف است |
| home.kill.active | Traffic serving | ترافیک فعال است |
| home.kill.desc_paused | Clients receive HTTP 503; this panel stays reachable. | کلاینت‌ها پاسخ ۵۰۳ می‌گیرند؛ این پنل در دسترس می‌ماند. |
| home.kill.desc_active | Proxy traffic is being served normally. | ترافیک پراکسی به‌طور عادی سرویس می‌شود. |

| tabs.settings.general | General | عمومی |
| tabs.settings.protocols | Protocols | پروتکل‌ها |
| tabs.settings.ports | Ports & Domains | پورت‌ها و دامنه‌ها |
| tabs.settings.proxyip | Proxy IP | آی‌پی پراکسی |
| tabs.settings.fragment | Fragment | فرگمنت |
| tabs.settings.chain | Chain proxy | زنجیرهٔ پراکسی |
| tabs.settings.advanced | Advanced | پیشرفته |
| general.securePath.label | Secure path | مسیر امن |
| general.securePath.hint | Secret prefix for this panel and all subscription URLs. | پیشوند محرمانهٔ این پنل و همهٔ نشانی‌های اشتراک. |
| general.securePath.regenerate | Regenerate | تولید جدید |
| general.securePath.confirm_title | Regenerate secure path? | تولید مسیر امن جدید؟ |
| general.securePath.confirm_body | Every panel URL, subscription link and QR you have shared stops working, and you are signed out everywhere. | همهٔ نشانی‌های پنل، لینک‌های اشتراک و QRهای به‌اشتراک‌گذاشته‌شده از کار می‌افتند و در همه‌جا از حساب خارج می‌شوید. |
| general.killSwitch.label | Kill switch | کیل سوییچ |
| general.killSwitch.hint | Instantly pause all proxy traffic (clients get 503). | توقف فوری همهٔ ترافیک پراکسی (کلاینت‌ها ۵۰۳ می‌گیرند). |
| general.language.label | Panel language | زبان پنل |
| protocols.vless.title | VLESS | VLESS |
| protocols.vmess.title | VMess | VMess |
| protocols.trojan.title | Trojan | Trojan |
| protocols.ss.title | Shadowsocks | Shadowsocks |
| protocols.enable | Enable {proto} | فعال‌سازی {proto} |
| protocols.disabled_hint | Disabled — no configs are generated for this protocol. | غیرفعال است؛ برای این پروتکل کانفیگی ساخته نمی‌شود. |
| protocols.uuid | UUID | UUID |
| protocols.password | Password | گذرواژه |
| protocols.cipher | Cipher method | روش رمزنگاری |
| ports.domains.label | Custom domains | دامنه‌های سفارشی |
| ports.domains.hint | Hostnames orange-clouded to this Worker; every enabled port serves them. | دامنه‌هایی که با رکورد ابری به این ورکر متصل‌اند؛ همهٔ پورت‌های فعال روی آن‌ها سرویس می‌شود. |
| ports.domains.placeholder | vpn.example.com | vpn.example.com |
| ports.matrix.legend_tls | TLS ports | پورت‌های TLS |
| ports.matrix.legend_plain | Plaintext ports | پورت‌های بدون رمز |
| ports.matrix.hint | Plaintext ports apply only to workers.dev hostnames without custom domains. | پورت‌های بدون رمز فقط برای نشانی workers.dev بدون دامنهٔ سفارشی اعمال می‌شوند. |
| ports.cleanAddrs.label | Clean addresses | آدرس‌های تمیز |
| ports.cleanAddrs.hint | One IP or hostname per line; added to generated configs as preferred addresses. | هر خط یک IP یا نام میزبان؛ به‌عنوان نشانی ترجیحی به کانفیگ‌ها اضافه می‌شود. |
| ports.remoteSubs.label | Remote subscriptions to merge | اشتراک‌های خارجی برای ادغام |
| ports.remoteSubs.hint | One https:// URL per line; fetched at subscription time and merged into the raw list. | هر خط یک نشانی https؛ هنگام ساخت اشتراک دریافت و به فهرست خام اضافه می‌شود. |

| proxyip.mode.label | Mode | حالت |
| proxyip.mode.auto | Auto · public feed | خودکار · منبع عمومی |
| proxyip.mode.list | Static list | فهرست ثابت |
| proxyip.mode.nat64 | NAT64 prefixes | پیشوندهای NAT64 |
| proxyip.list.label | Proxy IP list | فهرست آی‌پی پراکسی |
| proxyip.list.hint | One entry per line; host:port allowed. Used when the direct connection fails. | هر خط یک مورد؛ host:port مجاز است. زمانی که اتصال مستقیم شکست بخورد استفاده می‌شود. |
| proxyip.nat64.label | NAT64 prefixes | پیشوندهای NAT64 |
| proxyip.nat64.hint | One IPv6 prefix per line (e.g. 2a02:898:146:64::). | هر خط یک پیشوند IPv6 (مثلاً 2a02:898:146:64::). |
| checker.title | Proxy IP checker | بررسی آی‌پی پراکسی |
| checker.desc | Tests health, latency and success rate against Cloudflare speed endpoints. | سلامت، تأخیر و نرخ موفقیت را مقابل نقاط سرعت کلادفلر می‌سنجد. |
| checker.targets.label | Targets | مقصدها |
| checker.targets.hint | One IP or host:port per line — up to 100. | هر خط یک IP یا host:port — حداکثر ۱۰۰ مورد. |
| checker.run | Run test | اجرای تست |
| checker.stop | Stop | توقف |
| checker.running | Testing… | در حال تست… |
| checker.results | Results | نتایج |
| checker.empty | No results yet. | هنوز نتیجه‌ای نیست. |
| checker.col.target | Target | مقصد |
| checker.col.location | Location | موقعیت |
| checker.col.isp | ISP | سرویس‌دهنده |
| checker.col.latency | Avg latency | میانگین تأخیر |
| checker.col.rate | Success | موفقیت |
| checker.status.ok | Healthy | سالم |
| checker.status.partial | Partial | نیمه‌سالم |
| checker.status.failed | Failed | ناموفق |
| checker.skipped | skipped — invalid input | رد شد — ورودی نامعتبر |
| checker.summary | {ok} healthy of {total}. | {ok} مورد سالم از {total}. |
| checker.jobExpired | Test job expired — run again. | نتیجهٔ تست منقضی شد — دوباره اجرا کنید. |
| checker.tooMany | Maximum 100 targets. | حداکثر ۱۰۰ مقصد. |

| fragment.enable | Enable fragmentation | فعال‌سازی فرگمنت |
| fragment.preset.label | Preset | حالت آماده |
| fragment.preset.low | Low | کم |
| fragment.preset.medium | Medium | متوسط |
| fragment.preset.high | High | زیاد |
| fragment.preset.severe | Severe | شدید |
| fragment.preset.custom | Custom | سفارشی |
| fragment.length | Length min–max (bytes) | طول کمینه–بیشنه (بایت) |
| fragment.delay | Delay min–max (ms) | تأخیر کمینه–بیشنه (میلی‌ثانیه) |
| fragment.packets | Packets pattern | الگوی بسته‌ها |
| fragment.smartSweep | Smart sweep | جاروب هوشمند |
| fragment.smartSweep.hint | Sweeps 20 length ranges (1–5 … 100–200) in one profile and auto-selects the best; overrides manual length. | بیست بازهٔ طولی (۱–۵ تا ۱۰۰–۲۰۰) را در یک پروفایل می‌سنجد و بهترین را خودکار برمی‌گزیند؛ بر طول دستی اولویت دارد. |
| chain.enable | Enable chain proxy | فعال‌سازی زنجیرهٔ پراکسی |
| chain.type | Upstream type | نوع بالادست |
| chain.socks5 | SOCKS5 | SOCKS5 |
| chain.http | HTTP | HTTP |
| chain.address | Address | نشانی |
| chain.port | Port | پورت |
| chain.username | Username | نام کاربری |
| chain.password | Password | گذرواژه |

| advanced.doh.label | DoH upstream | بالادست DoH |
| advanced.doh.hint | DNS-over-HTTPS resolver used behind your private endpoint below. | مبدل DoH که پشت نقطهٔ خصوصی زیر استفاده می‌شود. |
| advanced.doh.private | Your private DoH endpoint | نقطهٔ خصوصی DoH شما |
| advanced.camouflage.label | Camouflage page | صفحهٔ استتار |
| advanced.camouflage.none | None (plain 404) | بدون استتار (۴۰۴ ساده) |
| advanced.speedtest.label | Intercept speed tests | رهگیری تست سرعت |
| advanced.speedtest.hint | Answer speedtest providers with synthetic throughput instead of proxying them. | به سرویس‌های تست سرعت پاسخ ساختگی بدهید تا از پراکسی عبور نکنند. |
| qr.title | Scan to import | برای افزودن اسکن کنید |
| qr.hint | Open your proxy client and scan, or copy the link. | کلاینت خود را باز کنید و اسکن کنید یا لینک را کپی کنید. |
| confirm.logout_title | Log out? | خارج می‌شوید؟ |
| confirm.logout_body | Your session cookie is cleared on this device. | کوکی نشست این دستگاه پاک می‌شود. |
| confirm.reset_title | Reset to defaults? | بازگشت به پیش‌فرض‌ها؟ |
| confirm.reset_body | All sections revert to factory values on next save. This cannot be undone. | همهٔ بخش‌ها پس از ذخیرهٔ بعدی به مقادیر کارخانه‌ای برمی‌گردند. قابل بازگشت نیست. |
| confirm.killswitch_title | Pause all traffic? | توقف همهٔ ترافیک؟ |
| confirm.killswitch_body | All clients lose connectivity immediately. The panel stays reachable so you can undo this. | همهٔ کلاینت‌ها بلافاصله قطع می‌شوند. پنل در دسترس می‌ماند تا بتوانید این را برگردانید. |
| confirm.yes | Yes, continue | بله، ادامه |

| toast.settingsSaved | Settings saved | تنظیمات ذخیره شد |
| toast.saveFailed | Save failed | ذخیره ناموفق بود |
| toast.conflict | Settings changed elsewhere. Reload? | تنظیمات جای دیگری تغییر کرده است. بارگذاری مجدد؟ |
| toast.pathRegenerated | New secure path ready | مسیر امن جدید آماده شد |
| toast.killOn | Traffic paused | ترافیک متوقف شد |
| toast.killOff | Traffic resumed | ترافیک از سر گرفته شد |
| toast.langChanged | Language updated | زبان تغییر کرد |
| toast.passSet | Passphrase created — welcome! | گذرواژه ساخته شد — خوش آمدید! |
| toast.networkError | Network error — check your connection. | خطای شبکه — اتصال خود را بررسی کنید. |

| err.required | Required field | این فیلد الزامی است |
| err.url | Enter a valid https:// URL | یک نشانی معتبر https:// وارد کنید |
| err.domain | Invalid domain name | نام دامنه نامعتبر است |
| err.ip_or_host | Not a valid IP or hostname | IP یا نام میزبان معتبر نیست |
| err.ipv6_prefix | Invalid IPv6 prefix | پیشوند IPv6 نامعتبر است |
| err.port | Port must be 1–65535 | پورت باید بین ۱ تا ۶۵۵۳۵ باشد |
| err.uuid | Invalid UUID | UUID نامعتبر است |
| err.path | Use 8–32 letters or digits | فقط ۸ تا ۳۲ نویسهٔ حرفی/رقمی مجاز است |
| err.pass_short | At least 8 characters | حداقل ۸ نویسه |
| err.pass_weak | Add an uppercase letter and a digit | یک حرف بزرگ و یک رقم اضافه کنید |
| err.number | Enter a valid number | عدد معتبر وارد کنید |
| err.minmax | Min must be ≤ max | کمینه باید از بیشنه کمتر یا مساوی آن باشد |
| err.duplicate | Duplicate entry: {value} | مورد تکراری: {value} |
| err.invalid_line | Invalid line: {line} | خط نامعتبر: {line} |

### 7.3 FA typography notes

- ZWNJ (U+200C) is already encoded in the strings above (می‌شود، می‌گیرد، به‌اشتراک‌گذاشته‌شده…). Never strip it during minification.
- Prose hints end with the Persian full stop «.»؛ technical tokens keep ASCII punctuation.
- Persian digits appear only where natural in prose (۱۰۰، ۵۰۳); all data values and form inputs stay Latin digits.
- Parentheses mirror automatically via the bidi algorithm — never hand-mirror them.

---

## 8. Implementation notes (vanilla JS)

### 8.1 Bundle layout

```
src/ui/
├── tokens.css        design tokens (§2) + base reset
├── components.css    component styles (§4)
├── i18n.ts           dict.en / dict.fa (§7), t(), interpolate()
├── render/
│   ├── login.ts      renderLogin(mode)
│   ├── shell.ts      topbar + view containers
│   ├── home.ts       subscriptions block, egress card
│   ├── settings/     one file per section (render + field defs)
│   └── checker.ts
├── client.ts         vanilla JS bundle, injected inline
└── vendor/qrcode.ts  vendored MIT qrcode generator
```

Server renders pages as template strings; CSS + JS are minified and embedded as constants in the worker (BPB-style). Everything is same-origin: **no external request of any kind** — fonts are system-only (D2), icons come from an inline SVG sprite (`<symbol id="i-copy">` etc., referenced via `<use>`), QR lib is vendored.

### 8.2 Server-side rendering rules

- A single `esc()` helper wraps **every** dynamic interpolation into HTML or attribute context; it must escape ampersand, angle brackets, and both quote styles to entities. No exceptions, including values the server itself generated.
- Per-page boot payload arrives as a JSON island: `<script type="application/json" id="q-boot">` containing `{ mode, lang, rev, settings, subs, myIp? }`. Client parses it guarded by try/catch. User-derived strings never get injected into JS source — only through this island.
- Panel responses carry: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, CSP restricting everything to `'none'` except `connect-src 'self'` and the inline style/script slots required by embedding.
- HTML stays valid with zero framework assumptions; each view is a function returning a string so sections are unit-testable as pure text transforms.

### 8.3 Client state pattern

```js
const S = {
  boot: JSON.parse(document.getElementById('q-boot').textContent),
  rev: null,          // optimistic-concurrency revision from server
  snapshots: {},      // sectionKey -> canonical JSON string at load/save
  dirty: new Set(),   // section keys with unsaved changes
  job: null,          // checker jobId + poller handle
};
```

- Field registry: every input carries `data-bind="section.field"` and `data-type="bool|num|list|str"`. `collect(section)` walks matching elements, coerces types, returns only values differing from snapshot (lists = trimmed deblanked line arrays).
- Dirty tracking recomputes on `input`/`change` (delegated); toggles mark dirty immediately; successful Apply replaces the snapshot and clears the flag; `beforeunload` warns while any section is dirty.
- Hash router: `hashchange` parses `#/view[/section]`, toggles `hidden` on views + panels, syncs `aria-selected`, scrolls to top. Initial route = `location.hash` or `#/home`; unknown hashes fall back to home (replaceState, no history spam).
- Event delegation: one `click` listener dispatches on `closest('[data-action]')` through an `ACTIONS` map (copy, reveal, generate, qr, set-lang, logout, run-test, stop-test, apply, discard…); one `input`/`change` listener handles dirty + line-editor validation. No per-element listeners.

### 8.4 Fetch wrapper

One `api(path, {method, body, timeoutMs})` helper used by every client call:

- `fetch(..., {credentials:'same-origin'})` with header `X-QP-Action: 1` on mutations — custom-header requirement doubles as CSRF defense-in-depth next to `SameSite=Strict`.
- `AbortController` timeout (15 s default; checker poll 8 s).
- Status handling: 204 → empty object; 401 → hard redirect to login URL; other non-2xx → throw `{status, data}` where `data.errors` maps field → i18n key.
- JSON parse failures normalize to a network-error toast via a single catch in the action dispatcher.

### 8.5 Shared client utilities

- `toast(keyOrText, kind, opts)` — builds DOM via `createElement`/`textContent` only (never `innerHTML` with dynamic data), auto-dismiss timers, pause on hover, max-3 stack.
- `confirmDialog(opts)` — promise wrapper over the confirm modal; focus management per §6.2.
- `copyText(s)` — async clipboard API with `execCommand` fallback for non-secure contexts.
- QR renderer — vendored lib draws to canvas at device-pixel ratio 2, ECC M, quiet zone 4.
- Poller — `setTimeout` chain (not setInterval) with visibilitychange pause; cancels cleanly on Stop/navigation.
- i18n lookup `t(key, params)` reads the active-language dictionary embedded in boot payload; unknown keys return the key itself (visible in dev, logged).

### 8.6 Hard rules

1. Zero external network requests from panel pages — no CDN fonts/scripts/icons/analytics. CI greps the built bundle for `https?://` occurrences outside comment-free allowlist (protocol URIs in dictionaries are data, not requests).
2. No `innerHTML` with unescaped interpolation; no `eval`/`new Function`.
3. All timings/durations live as named constants at the top of `client.ts` (TOAST_MS, POLL_MS…).
4. The bundle must stay under ~120 KB minified including CSS + both dictionaries + qrcode lib; check size in CI.

---

## 9. Design direction summary

1. Flat dark slate surfaces (`#0a0e14→#1d2937`) separated by hairline borders — depth only for modals/toasts.
2. One cyan accent (`#22d3ee`) carries all interactivity; semantic green/amber/rose reserved for status truth.
3. 13 px system-font UI, mono for every technical value, Latin digits everywhere.
4. Single authenticated shell, hash-routed views: Home / Settings / IP Checker.
5. Subscriptions block is the hero of Home; per-format copy-fields with inline QR one tap away.
6. Settings = seven pill sub-tabs of cards; explicit Apply bar appears only when dirty; PATCH-per-section with rev conflict detection.
7. Toggles act optimistically and revert honestly; destructive actions always confirm first.
8. Checker streams results into a progressive table fed by an 800 ms polling loop.
9. Bilingual by contract: dot-namespaced dictionary, cookie-persisted language, logical-property CSS so RTL costs zero extra layouts.
10. Accessible baseline: 44 px touch targets, visible focus rings, aria-wired tabs/modals/toasts, 360 px floor.














