# Feature scope locked

**Status:** Decided (2026-08-24)

## Question

Which features ship in v1.1, in what order, and what is explicitly excluded?

## Answer

User-fixed order (each feature: in-depth research → implement complete → test → docs):

1. **F1 Import/Export settings** — JSON file + share link (secrets stripped) + remote URL import.
2. **F2 Routing rules** — bypass LAN, block ads/malware/QUIC, custom bypass/block lists; injected into clash/singbox/xray emitters (emitters stay pure).
3. **F3 ECH** — enable + serverName; emitted across share URIs + all emitters; validated against Xray fixtures.
4. **F4 User center** — multi-user sub tokens, quotas, expiry, enable/disable, per-user filters; single admin manages.
5. **F5 First-run wizard** — post-setup 3-step: protocols → first sub URL → done; skippable.
6. **F6 Panel self-update** — version check vs GitHub releases + guidance (no auto-deploy).
7. **F7 Telegram bot** — LAST. Token+chatId, webhook, /status /sub /killswitch /usage.

Excluded: WARP/WireGuard (separate project), breadcrumbs, web fonts, Durable Objects.

Visual identity port (V1) is gated: ask user "is this the time?" — only on yes, re-review warp-generator fresh, then implement. All functional UX (empty states, popovers, validation timing) lands before visuals but styling stays neutral until V1.
