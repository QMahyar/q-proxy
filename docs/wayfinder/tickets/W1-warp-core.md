# W1 — WARP core: KV schema + x25519 + WARP API client + account CRUD
Type: task (AFK) · Phase: WARP integration · Blocked by: nothing

## Question
Port warp-generator's WARP core into Q Proxy under the one-KV invariant: `qproxy:warp:*` keys in QPROXY_KV; hand-rolled x25519 (no npm); WARP registration client (api.cloudflareclient.com/v0a4005/reg) with retry/backoff + cleanup-on-failure; conf/wg:// import parsers; account CRUD + token regenerate routes under `/{sp}/api/warp/*` (session+CSRF); sanitizeAccount (strip private_key).

## Answer

DONE (2026-08-24). All layers built, tested, and verified live:

- **x25519** (`src/crypto/x25519.ts`): hand-rolled BigInt Montgomery ladder, zero deps. Verified against RFC 7748 vectors (2 single-shot + DH exchange) + keypair/shared-secret roundtrips.
- **Parsers** (`src/warp/config.ts`): `.conf` INI (allowlisted keys, dup-Interface reject, derived public key, Reserved/ClientId → 3 bytes, Amnezia params w/ range rules) + `wg://`/`wireguard://` URIs (userinfo/query private key, dash/comma addresses, enable_amnezia gate, well-known peer fallback). ParseResult, never throws.
- **Registration client** (`src/warp/api.ts`): POST /v0a4005/reg, 2 retries + exponential backoff w/ jitter + Retry-After, defensive envelope unwrapping ({data:{result}} etc.), client_id → reserved bytes, cleanup DELETE on failure. WarpApiError carries status + Retry-After.
- **Store** (`src/warp/store.ts`): `qproxy:warp:*` keys in QPROXY_KV (one-KV invariant); two-key write + rollback; token index; presets (default/iran/china seeded once); global amnezia; validateAmnezia (ranges, Jmin≤Jmax, H non-overlap, I1 notation); resolveAmnezia (global ⊕ overrides, zeros dropped); sanitizeAccount strips private_key.
- **Routes** (`/{sp}/api/warp/{…}`, handlers/api/warp.ts sub-path dispatch): account list/generate/import/get/update/delete/regenerate-token, presets CRUD (delete blocked in-use), settings/amnezia GET/PUT. Session + CSRF on mutations; UUID-guarded KV access.
- **Tests**: 29 unit (vectors, parsers, store, api w/ stubbed fetch incl. retry + envelope shapes) + workers router roundtrip (401, CSRF 403, import→rename→regen→amnezia→delete→404). Full suite 505/505.
- **Live verified** (wrangler dev + browser session): presets seeded (default 5 / iran 50 / china 50), import roundtrip with hasPrivateKey:false in response, amnezia PUT persisted, bad config → VALIDATION, and a REAL WARP device registration (ipv4 172.16.0.2, ipv6 2606:4700:11…, reserved [96,114,52]) followed by clean delete + device cleanup.

Bugs caught by tests during the build: IPv4 validator matched single octet not dotted quad; Map.get undefined-vs-null crash in URI parser; amnezia key case mismatch (jc vs Jc); invalid Reserved silently accepted; regenerate-token test compared against mutated field.
