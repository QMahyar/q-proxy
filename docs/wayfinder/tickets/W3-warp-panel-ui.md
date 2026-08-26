# W3 — WARP panel UI: accounts, presets, amnezia
Type: task (AFK) · Phase: WARP integration · Blocked by: W1, W2, V1

## Question
New panel section (WARP): account list (avatar gradients, badges), generate/import modals, per-account detail (token panel, sub URL list with copy/QR), endpoint preset editor, global amnezia editor with presets (mild/aggressive), empty states. EN/FA dictionaries. Uses V1 design system.

## Answer

DONE (2026-08-25). WARP panel UI complete and live-verified:

- **Nav**: new top-level WARP tab (Home / Settings / WARP / IP Checker).
- **List view** (`#/warp`): stat chips (accounts/presets/formats), WARP Settings + Import + Generate buttons, account cards (gradient avatar tile with initial, name, date, preset/custom line, violet AMZ badge for overrides), dashed empty-card with glowing icon + both CTAs.
- **Detail view** (`#/warp/{id}`): back button (RTL-flipped arrow), token panel (gradient hairline, cyan mono token, Regenerate w/ confirm), account settings card (name save, preset select w/ instant save on change, optional DNS), Subscription URLs card — all 17 formats with gradient icons + copy + QR per row, Amnezia status card (reset-to-global when overrides exist), danger card delete w/ confirm.
- **Settings view** (`#/warp/settings`): Accounts|Settings segmented nav; Endpoint presets card (name + endpoint preview + count chip + edit + delete, delete blocked server-side when in use); Amnezia defaults card — 12 fields + I1, save w/ server validation.
- **Modals**: Generate (name optional → real device via CF API), Import (name + conf/URI textarea + inline field errors), Preset add/edit (name + endpoints textarea). Esc + backdrop + focus trap all wired.
- **i18n**: ~45 new keys EN/FA; format labels are proper nouns (untranslated by design).
- **Efficiency**: WARP data loads lazily on first WARP navigation (not at boot — boot stays 1 request); api() sessionStorage cache covers the 3 GETs.

Bugs caught live: wireEvents closing brace eaten during edit (syntax error at final IIFE — caught by node --check + empty render), browser 60s HTML cache served stale panel after rebuild (hard reload), FA-unsafe Save-label hack replaced with common.apply.
