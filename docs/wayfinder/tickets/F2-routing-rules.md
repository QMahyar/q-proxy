# F2 — Routing rules (in-depth)
Type: task (AFK) · Phase: Features · Order: 2

## Question
Complete routing rules: presets (bypass LAN, block ads/malware/QUIC), custom bypass/block lists, per-emitter injection (clash/singbox/xray), settings schema, validation, QoL. Emitters stay pure (invariant 9). Golden tests will change — additive only, verify against Xray/sing-box/Clash docs.

## Answer

SPEC READY — implement next (one session). Decisions locked:
1. Settings: `routingRules: { bypassLan: bool, blockAds: bool, blockMalware: bool, blockQuic: bool, customBypass: string[], customBlock: string[] }` — add to types/settings.ts (DEFAULTS all-false/empty), validate.ts (boolField ×4 + strArrayField domain-pattern ×2, maxItems 200), UI: new "Routing" card in Advanced section + dict keys en/fa.
2. Emission scope: clash + sing-box ONLY (dominant formats; base64 has no rules concept; surge/loon deferred — note in ticket on close).
3. Emitter plumbing: extend emitter opts with `rules: { bypassDomains: string[], blockDomains: string[], blockQuic: bool }` computed in subscribe.ts from settings (bypassLan → clash `IP-CIDR,192.168.0.0/16,DIRECT,no-resolve` set / singbox `ip_cidr` private ranges DIRECT; blockAds → well-known ad-domain lists NOT bundled (user custom only + category flags emit rule-sets refs? NO — keep pure: only user lists + LAN + QUIC; ad/malware flags toggle a fixed minimal domain set documented in code-free docs).
   - clash: `rules:` list appended after proxies; MATCH final already emitted by yaml-writer? verify and keep last.
   - singbox: `route.rules` array + final.
4. Golden tests WILL change — update clash/singbox goldens with rules off (unchanged output) and add new cases with rules on (additive).
5. Tests: validate.spec fields; emitters rules-on cases; workers subscribe smoke with rules set.
