# W2 — WARP subscriptions: endpoint expansion + 17 formats + cache
Type: task (AFK) · Phase: WARP integration · Blocked by: W1

## Question
expandEndpoints normalization; format registry: wireguard-conf ZIP (hand-rolled store-only ZIP), throne wg:// (+amnezia), wireguard://, singbox endpoint + legacy (±amnezia), xray, clash (reuse yaml-writer, ±amnezia), v2rayn, surge, loon, surfboard, egern; public routes `/{sp}/sub/wg/{token}/{format}`; Cache API + purge on account/preset/amnezia changes; subscription headers per warp-generator (410 for expired/revoked tokens).

## Answer

DONE (2026-08-25). All 17 formats shipped, tested, live-verified:

- **expand** (`src/warp/expand.ts`): preset/custom endpoint resolution, dedupe by ip:port, IPv6 bracketing, CIDR completion (/32, /128), bare hosts, multi-row tagging, dns (account ⊕ preset ⊕ 1.1.1.1), amnezia resolution (global ⊕ overrides).
- **emitters** (`src/warp/formats/`): conf.ts (ZIP ×2, throne ×2, wireguard-uri, v2rayn), singbox.ts (endpoint schema ×2, legacy ×2, xray), proxies.ts (clash ×2, surge, surfboard, loon, egern). Pure functions; registry.ts maps 17 format names → emitter + content-type + extension.
- **ZIP** (`src/warp/zip.ts`): hand-rolled store-only (method 0), CRC32 (verified against 0xCBF43926 standard vector), local headers + central directory + EOCD.
- **Route** `/{sp}/sub/wg/{token}/{format}` (GET/HEAD, public — token is the secret, UUID-guarded): handlers/warp-sub.ts; edge Cache API 60s; headers: Content-Type/Disposition per format, Profile-Update-Interval from settings, Profile-Title b64, Subscription-Userinfo, profile-web-page-url, X-WG-Version.
- **Purge** (`src/warp/cache.ts`): per-token (all formats) on account update/delete/regenerate; purge-all on preset create/update/delete and global amnezia change.
- **Tests**: zip (CRC vector + structure + roundtrip), formats (26 assertions incl. full URI shapes, amnezia gating, legacy vs endpoint schema, surge vs surfboard client-id, zip entry names), workers route roundtrip (throne/singbox/zip + 404s + camouflage fallthrough for bad UUID). Full suite 525/525.
- **Live verified** (wrangler dev + browser): imported account → all 17 formats fetched through the public route: every one 200 with correct Content-Type + Content-Disposition; throne URI shape `wg://engage…:2408?private_key=…` confirmed; singbox 5 endpoints + route.final; clash name/wireguard present and reserved correctly omitted (zero reserved); ZIP valid PK header (2558 bytes, 5 conf entries); amnezia variants consistently larger than vanilla. Test account deleted after.

Bugs caught during the build: route matcher nested under wrong segment (sub/wg unreachable → camouflage), rest.length off-by-one, throne URI missing `?` before first param, loon missing ` = ` separator, resolveAmnezia leaking zero-valued S*/I1 keys, regex literal `/` unescaped in spec.
