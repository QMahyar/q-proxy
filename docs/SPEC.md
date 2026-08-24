# Q Proxy — Product Specification v1

> Status: approved scope. Evidence base: `docs/research/01-bpb-panel.md`, `02-edgetunnel.md`, `03-nahan.md`, `04-protocol-formats.md`.
> Decisions below are final for v1; changes require reopening an item in §6 or an owner decision record.

---

## 1. Product Overview

Q Proxy is a single-user, self-contained Cloudflare Worker control panel that unifies the strongest capabilities of BPB Panel, edgetunnel, and nahan into one auditable TypeScript codebase, with all WARP functionality deliberately excluded. It terminates VLESS, VMess, Trojan, and Shadowsocks over WebSocket with early-data support, fronts them with direct-first egress that self-heals through a proxyIP list or NAT64 construction, and can route all TCP egress through socks5 or HTTP(S) chain proxies. A hardened management plane — one regenerable secret path gating panel, APIs, subscriptions, the private DoH endpoint, and proxy sockets alike; PBKDF2 password auth with revocable cookie sessions; forced first-run setup; fake-Cloudflare-1101 camouflage — protects a KV-backed, versioned settings store with environment-variable overrides. Subscriptions are User-Agent-negotiated across mixed/base64, Clash/mihomo YAML, sing-box full configs (sfa-style with urltest best-ping groups), Surge, and Loon, alongside Xray-format fragment profiles including the smart-fragment sweep, remote-subscription merging, estimated Subscription-Userinfo reporting, and client-side QR codes in a bilingual English/Persian (RTL) UI. The build emits a zero-runtime-dependency single-file bundle deployable identically by Cloudflare dashboard paste or wrangler, with no phone-home traffic, no embedded third-party hosts, and every pure function unit-testable outside workerd.

---

## 2. Feature Matrix

Source panels: **B** = BPB Panel, **E** = edgetunnel, **N** = nahan, **New** = none of them (spec-driven). Status: **v1** ships in first release, **v2** deferred (documented, not built), **EXC** excluded permanently or by scope decision.

### A. Data plane (tunnel)

| # | Feature | Source | Status | Acceptance criteria |
|---|---------|--------|--------|---------------------|
| F-01 | VLESS over WebSocket server | B+E+N | v1 | A v2rayNG client importing a generated `vless://` link completes a TCP relay through the worker (bidirectional bytes verified against an echo target); UUID auth rejects non-matching 16-byte IDs; MUX (cmd=3) is refused. |
| F-02 | VMess over WebSocket server (AEAD only) | New | v1 | A client configured from a generated `vmess://` base64-JSON link (`aid:"0"`, `scy:aes-128-gcm`) relays TCP bidirectionally; legacy alterId>0 / AES-CFB handshakes are rejected with connection close. Highest-risk item: pure WebCrypto implementation (MD5 + AES-GCM KDF path), no CFB. |
| F-03 | Trojan over WebSocket server | B+E+N | v1 | A trojan client whose password hashes (SHA-224 hex) to the stored 56-byte header authenticates; wrong hash or missing CRLF at bytes 56–57 closes without response leak; cmd≠1 rejected. |
| F-04 | Shadowsocks over WebSocket server (AEAD) | E | v1 | An SS client with `aes-128-gcm` or `aes-256-gcm` and SIP002 link format relays TCP bidirectionally; EVP_BytesToKey + HKDF-SHA1 subkey derivation matches RFC/test vectors; invalid salt fails closed. Dedicated `/ss` path makes early data safe (fixes E's misparse-disable rationale). |
| F-05 | WS early data via `Sec-WebSocket-Protocol` | B+E+N | v1 | Generated configs advertise `ed=2048`; server decodes base64url early payload (cap 8 KB, oversized → reject) and processes it as first stream bytes; absent/empty header takes normal path. |
| F-06 | Dedicated per-protocol WS paths (no runtime sniffing) | Design fix (E §G8) | v1 | Endpoints are `/{sp}/vl/<suffix>`, `/vm/<suffix>`, `/tr/<suffix>`, `/ss/<suffix>`; request to protocol-A path with protocol-B frame is closed; no cross-protocol byte sniffing exists in code. |
| F-07 | DNS-only UDP → DoH conversion (VLESS cmd=2) | B+E+N | v1 | VLESS UDP to port 53 is answered by forwarding the DNS packet as DoH to the configured upstream (setting-driven, not hardcoded); UDP to any other port throws and closes; emitted configs mark `udp:false` outside DNS mapping. |
| F-08 | Direct-first egress with zero-byte failover | B+E+N | v1 | TCP egress dials destination directly with first payload pre-written; if remote closes having delivered zero bytes, exactly ≤2 retries occur through proxyIP/NAT64 candidates, reusing queued client data; generation counters prevent stale writes across redials. Unit-tested state machine; integration-tested with unreachable first hop. |
| F-09 | ProxyIP list (entries, ports, resolution, random pick) | B+E+N | v1 | Settings accept comma/newline entries `ipv4`, `[ipv6]`, `host`, `host:port`; host entries resolve A/AAAA via DoH at use time with 10-min isolate cache; retry picks uniformly at random; entries are validated and error-listed per field. No author-controlled default entries exist (empty default). |
| F-10 | NAT64 prefix mode | B+N | v1 | Given prefix list + target hostname, worker resolves IPv4 then constructs `[prefix][hex-encoded-v4]` literal and uses it as retry candidate; prefixes validated as IPv6 network literals; unit tests cover conversion vectors. |
| F-11 | Chain-proxy egress: socks5 + http/https | E (minus TURN/SSTP/trojan-upstream) | v1 | Configured chain (`scheme://[user:pass@]host:port`) carries all tunneled TCP when enabled: SOCKS5 handshake per RFC 1928 incl. optional auth; HTTP CONNECT plain; HTTPS CONNECT over native TLS socket (`secureTransport:'on'`). Chain failure closes the session — no silent fallback to direct. Global toggle only in v1. |
| F-12 | Speedtest interception (local 204) | E | v1 | Tunneled requests whose Host is `speed.cloudflare.com` or `cp.cloudflare.com` receive a locally synthesized HTTP/1.1 204 without dialing upstream; toggle in settings (default ON); unit-tested classifier. |
| F-13 | Kill switch | N | v1 | With kill switch enabled, every WS upgrade returns `503 Service Unavailable` before upgrade; panel/sub endpoints remain fully functional; flag settable in UI and overridable by env var. |
| F-14 | Private DoH endpoint `/{sp}/dns-query` | B | v1 | RFC 8484 GET (`?dns=`) and POST both proxy to the configurable HTTPS DoH upstream verbatim (query params/body preserved, cookies stripped); responses carry correct content-type; endpoint lives under secure path. |

### B. Subscriptions & config generation

| # | Feature | Source | Status | Acceptance criteria |
|---|---------|--------|--------|---------------------|
| F-15 | Full CF port matrix emission (TLS/plain pairing) | B+E | v1 | Emitted nodes cover TLS family {443,2053,2083,2087,2096,8443} with `security=tls` and plain family {80,8080,8880,2052,2082,2086,2095} with `security=none`; port↔security mismatch never occurs (property test over generator output); plain family auto-offered only on `*.workers.dev` unless manually enabled. |
| F-16 | Custom domains list | B (minus CF-API automation) | v1 | Settings accept additional advertised hostnames (validated, no auto DNS/zone changes — user attaches them in CF dashboard themselves); generated subs emit nodes for every listed domain; remarks flag custom domains with `D`. |
| F-17 | Address pool: main domain + clean IPs + optional AAAA | B | v1 | Config address pool = primary hostname ∪ user-entered clean IPs ∪ resolved A records (∪ AAAA when IPv6 toggle on); urltest groups contain ≥2 candidates when pool >1; resolution cached per isolate. |
| F-18 | Mixed / base64 subscription | All | v1 | `GET sub` with generic client UA returns base64(URI lines) covering all four schemes (`vless://`, `vmess://` b64-JSON, `trojan://`, `ss://` SIP002) × address pool × enabled ports; body decodes to ≥1 line per protocol; standard padded base64. |
| F-19 | Clash/mihomo YAML subscription (true YAML) | N+B(JSON)+E(converter) | v1 | Output is real YAML (`text/yaml; charset=utf-8`) — not JSON (fixes B §G10); contains proxies for all four types with correct keys (`servername:` vs `sni:` distinction honored), ws-opts with `max-early-data: 2048` + `early-data-header-name: Sec-WebSocket-Protocol`, select + url-test groups, and rules ending in a catch-all; parses cleanly in mihomo strict mode. |
| F-20 | sing-box full config (sfa-style, urltest best-ping) | B | v1 | Output is a complete sing-box profile importable in SFA: log, DNS block (local + DoH detoured through proxy), tun inbound with `auto_route`/`strict_route` + v4/v6 addresses, outbounds for enabled protocols + direct, urltest group ("Best Ping") probing gstatic 204 at configurable 10–90 s interval; schema validates against sing-box 1.x checker fixture. |
| F-21 | Surge profile | E(scope) | v1 | Output is valid Surge INI with trojan (ws params via `ws=true,ws-path,ws-headers`) and ss entries; vmess omitted (not natively supported); `#!MANAGED-CONFIG` interval line present; non-empty and accepted by Surge config linter fixture. |
| F-22 | Loon profile | Scope | v1 | Output is valid Loon `[Proxy]` section lines for vless/vmess/trojan/ss over ws incl. TLS/plain variants; parses in Loon grammar fixture. |
| F-23 | UA sniffing + `target=` override + browser info page | E+N | v1 | Format priority: explicit `target=` param → clash/meta/mihomo → sb/sing-box/singbox → surge → loon → mixed(base64); browsers get the bilingual HTML info page instead of node data; non-browser UAs receive `Content-Disposition: attachment`; classifier unit-tested against recorded UA corpus from all three panels. |
| F-24 | Subscription headers incl. Subscription-Userinfo (estimated) | E+N | v1 | All sub responses carry `Profile-Title`, `Profile-Update-Interval`, and `Subscription-Userinfo: upload=…; download=…` estimated as proxied-connection KV counters × configurable bytes-per-connection factor, plus `total=`/`expire=` only when set by owner; units are bytes and unix seconds (property test). |
| F-25 | Fragment subscription (Xray JSON, presets) | B | v1 | Fragment sub emits Xray-format full JSON whose main outbound chains through a `fragment` outbound; presets low/medium/high/severe/custom map to documented length/delay/maxSplit ranges; fragment subs force TLS ports and exclude CDN-style hosts. |
| F-26 | Smart/best-fragment sweep | B | v1 | One profile contains a balancer over 20 fragment outbounds spanning lengths 1-5 … 100-200 with observatory leastPing selection and fallback tag; JSON structure matches Xray finalmask schema fixture. |
| F-27 | URI fragment params for Shadowrocket/Happ UAs | E | v1 | When classified UA is Shadowrocket or Happ, mixed-sub URIs include `fragment=<count>,<len>,<delay>,tlshello` derived from current fragment settings; other UAs never see the param. |
| F-28 | Best-ping groups across formats | B | v1 | Clash gets `url-test` group (tolerance 50), sing-box gets `urltest` group incl. separate group for custom-domain nodes, Xray JSON gets balancer+observatory; interval setting shared (default 30 s, bounds 10–90); groups reference only existing node names (linter property test). |
| F-29 | TLS hygiene in emitted configs (randcase SNI, ALPN, fingerprint) | B | v1 | Own nodes emit `sni` = randomized-uppercase hostname (deterministic per remark seed), `alpn=http/1.1` where applicable, selectable uTLS fingerprint (10 values + random/randomized), and `allowInsecure=false`/`skip-cert-verify=false` always for self-hosted nodes. |
| F-30 | Remark naming convention | B | v1 | Every emitted node name encodes protocol, port, address class, and flags (`F` fragment, `D` custom domain, `🔗` chain); names are unique within one sub response (uniqueness property test) and stable across consecutive fetches with unchanged settings (determinism test). |
| F-31 | Remote subscription ingestion merged into outputs | B(+E concept) | v1 | Settings accept remote sub URLs + raw URI lines; fetched at request time with 5 s timeout, 1 MB cap, 5-min isolate cache; known schemes (vless/vmess/trojan/ss) are parsed and converted into native entries in YAML/JSON/Surge/Loon outputs and re-emitted in mixed; unknown schemes pass through only into mixed; unreachable sources degrade gracefully (sub still serves own nodes). |

### C. Management plane

| # | Feature | Source | Status | Acceptance criteria |
|---|---------|--------|--------|---------------------|
| F-32 | Password auth (PBKDF2, constant-time) | Improved (fixes B §G4, E §G2, N §H6) | v1 | Password stored as PBKDF2-SHA256 (≥100k iterations, ≥16-byte random salt) + salt in KV — never plaintext; verification uses constant-time comparison; login with wrong password fails without revealing which of user/path was wrong. |
| F-33 | Forced first-run set-password | B | v1 | With no password in KV, any panel access renders mandatory setup form; setup POST accepted only while unset (race-guarded) and enforces ≥8 chars with letter+digit; after setup, endpoint refuses further calls permanently until password reset flow. |
| F-34 | Cookie sessions (flags, UA binding, revocation) | Improved (fixes B §G4 logout gap) | v1 | Session cookie `__Host-qpsid` = id + HMAC-SHA256(id, secret) with `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`; server-side session record in KV (TTL 24 h) bound to SHA-256(UA) prefix — UA change forces re-login; logout deletes record so stolen cookies die; password change revokes all sessions. |
| F-35 | Login throttling | New (weakness fix) | v1 | ≥5 failed logins per IP within a sliding 15-min window (KV TTL counter) return 403 until expiry; success clears counter; behavior unit-testable with injected clock/KV fake. Documented as best-effort given KV eventual consistency. |
| F-36 | Regenerable secure path gating everything | B | v1 | Panel UI, all panel APIs, subscriptions, DoH, and all four proxy WS endpoints live under `/{sp}/…`; path is 12–24 URL-safe chars, validated, regenerable from an authenticated control with explicit warning that existing client configs must be re-imported; regeneration invalidates nothing else. |
| F-37 | Camouflage: fake CF 1101 page + robots.txt disallow | E(html1101)+B(fallback concept)+scope | v1 | Any request failing secure-path check AND any unmatched route returns status 500 with byte-identical fake "Cloudflare 1101" HTML (same body used for genuine internal errors — indistinguishable); `/robots.txt` serves `User-agent: * / Disallow: /`; no 404s, redirects, or stack traces ever reach clients. |
| F-38 | Bilingual EN/FA (RTL) UI | N (sub page) generalized to panel | v1 | Full panel + info page localized via dictionary files; FA renders `dir="rtl"` with mirrored layout; language switch persists per session; zero hardcoded English strings in templates (lint-checked). |
| F-39 | Client-side embedded QR codes | Replaces B server PNG | v1 | QR rendering happens in browser JS (embedded dependency-free generator compiled into panel asset); panel shows QR per sub/config link; no `/qrcode` GET endpoint exists server-side (removes inner-URL echo surface). |
| F-40 | My-IP dual egress table | B | v1 | Authenticated panel action performs two server-side fetches — one CF-fronted echo, one non-CF echo service (both configurable, no ip-api) — and renders a two-column exit-IP table plus colo code with country flag from an embedded static colo→flag map; third-party geo APIs are never called. |
| F-41 | Settings editor (validation, diff-apply, reset) | B | v1 | Editor posts whole-form on diff detection; backend validation returns per-field error arrays rendered as toasts; apply disabled until dirty; reset-to-defaults restores factory settings behind confirmation; deployed version displayed read-only. |
| F-42 | KV versioned settings + migrations + env overrides + isolate cache | B pattern hardened | v1 | Settings blob stamped `SETTINGS_VERSION`; ordered pure migration functions upgrade any prior version preserving unknown keys (table-driven tests per hop); precedence env var > KV > built-in default applied post-migration; isolate-level cache with ≤30 s TTL serves reads (typical request = ≤1 KV read); writes bump revision to warn stale admin tabs. |

### D. Build & ops

| # | Feature | Source | Status | Acceptance criteria |
|---|---------|--------|--------|---------------------|
| F-43 | Single-file dist for dashboard paste | B | v1 | `dist/worker.js` is one file with all HTML/CSS/JS assets minified and embedded (gzip+b64 constants); pasting it into CF dashboard "Edit code" + creating one KV namespace yields a fully working deployment; build reproducibility verified by hash-stable output for identical inputs. |
| F-44 | Wrangler deploy parity | E/N wrangler heritage | v1 | `wrangler.jsonc` deploys the same bundle with KV binding and pinned compat date; behavior identical to paste mode (parity integration test); secrets optionally provided via `wrangler secret put`. |

### Deferred to v2 (documented, not built)

| # | Feature | Source | Status | Note |
|---|---------|--------|--------|------|
| F-45 | gRPC transport | E/B | v2 stretch | Requires h2 termination Workers cannot reliably provide; revisit after WS core stabilizes. |
| F-46 | xhttp / stream-one transport with padding obfuscation | E | v2 stretch | Owner-flagged stretch goal. |
| F-47 | ECH (Encrypted Client Hello) end-to-end | B+E | v2 | Present in both source panels; not in approved v1 scope. |
| F-48 | Custom CDN masking (addresses/host/SNI triple) | B | v2 | Fastly/Gcore-style fronting. |
| F-49 | Upstream TCP proxy (SNI-spoof fronting pairs) | B | v2 | Extra address/port pair generation. |
| F-50 | FakeDNS | B | v2 | Client-config DNS trick. |
| F-51 | Routing rule preset editor (block ads/porn/QUIC, sanction bypass, geo bypass) | B+N | v2 | v1 full configs ship minimal sane defaults only (private→direct, QUIC udp/443 drop, catch-all→proxy). |
| F-52 | Workerless/serverless rescue configs | B | v2 | Unique BPB emergency feature; large surface. |
| F-53 | Settings share/export/import (.dat + remote URL) | B | v2 | Excludes secrets by design when built. |
| F-54 | ProxyIP health explorer + live egress tester | B+E(admin/check) | v2 | Raw-TLS probe scoring + chain dial-through report. |
| F-55 | TXT-record ProxyIP bulk pools | E | v2 | DNS-TXT expansion with deterministic shuffle. |
| F-56 | Concurrent dial racing (+CMCC-aware degradation) | E | v2 | Promise.any racing width tuning. |
| F-57 | Uplink/downlink coalescing & batching pipeline | E | v2 | Grain-style 20 KB/32 KB bundling for CPU/quota efficiency. |
| F-58 | Consistent-hash stable egress selection | N | v2 | Sticky per-user exit IP across isolates. |
| F-59 | Fake usage/expiry display configs | N | v2 | Template dummy nodes. |
| F-60 | Embedded CIDR preferred-IP generator | E (runtime-fetch variant excluded) | v2 | Only with lists vendored at build time (no runtime GitHub fetch). |
| F-61 | Telegram bot ops console | B+E+N | Phase 2 | Roadmap item per owner decision; document webhook contract now, build post-v1. |

### Excluded

| # | Feature | Source | Status | Rationale |
|---|---------|--------|--------|-----------|
| F-62 | WARP / WireGuard anything (WoW/Pro, WG zips, warp accounts) | B | EXC | Owner decision. |
| F-63 | REALITY | — | EXC | Technically impossible on Workers (no inbound TCP). |
| F-64 | TURN / SSTP / trojan-upstream egress | E | EXC | Chain-proxy scope fixed at socks5/http/https. |
| F-65 | Multi-user accounts, quotas, expiry, pause-per-user, connection caps | N | EXC | Single-user product; revisit only as a new major version. |
| F-66 | Self-redeploy / self-update / delete-panel via CF API | B+N | EXC | Embedding API tokens in worker.js is the single worst supply-chain pattern observed in research (B §G3, N §H7). |
| F-67 | CF GraphQL usage dashboards | B+E | EXC | Same API-token exposure rationale; F-24 covers usage display honestly. |
| F-68 | D1 storage | N | EXC | KV-only per owner decision. |
| F-69 | Geo-naming via ip-api.com enrichment | B+N | EXC | Cleartext HTTP calls, rate limits, target leakage; replaced by static colo→flag map (F-40). |
| F-70 | Reverse-proxy camouflage to arbitrary real sites | B+N | EXC | SSRF-ish surface + external dependency; fake-1101 (F-37) chosen instead. |
| F-71 | BEST_SUB feeder/generator mode | E | EXC | Turns panel into shared infrastructure service — out of product intent. |
| F-72 | Panel federation / hub-spoke linked panels | N | EXC | Multi-node management is a different product. |
| F-73 | Per-config derived UUIDs + relay-index-in-path pinning | N | EXC | Machinery exists to serve multi-user attribution; dead weight single-user. |
| F-74 | SS AEAD-2022 ciphers; VMess legacy (alterId>0, AES-CFB) | — | EXC | blake3 unavailable in Workers WebCrypto; CFB unavailable in WebCrypto and legacy VMess is deprecated upstream. |
| F-75 | General UDP relay / QUIC transport | All (platform limit) | EXC | Workers cannot relay UDP; DNS-only hack is the honest ceiling (documented limitation). |
| F-76 | Unauthenticated share-settings endpoint | B | EXC | Research-flagged security flaw (B §G3), not a feature. |
| F-77 | Runtime fetching of UI/templates/rules from GitHub raw | N+E | EXC | Phone-home violates self-containment NFR; everything embedded at build (F-43). |
| F-78 | Code obfuscation, junk-var padding, char-code string building | B(paddCode)+N+E | EXC | Deliberately rejected: auditability outranks scanner-evasion cosmetics. |
| F-79 | Server-side QR PNG endpoint | B | EXC | Superseded by client-side QR (F-39); removes same-origin echo endpoint. |
| F-80 | Multi-protocol sniffed single endpoint | E | EXC | Byte-sniff fragility documented (E §G8); dedicated paths (F-06) chosen. |
| F-81 | Cloudflare Pages deployment target | B | EXC | Workers-only support in v1; Pages works incidentally if pasted but is unsupported/untested. |

**v1 count: 44 features (F-01 … F-44).**

---

## 3. Non-Functional Requirements

1. **Zero runtime npm dependencies.** The worker bundle imports no npm package at runtime; `package.json` carries devDependencies only (TypeScript, bundler, vitest, wrangler, test fixtures). CI fails if the bundled output references `node_modules`. Runtime-provided modules (`cloudflare:sockets`, workers types) are exempt. Hand-implement where deps would creep in: MD5 and SHA-224 (WebCrypto lacks them; Node webcrypto lacks MD5 too, so hand-rolled keeps tests portable), base64url codecs, a YAML *emitter* subset (emit-only, round-trip tested against a devDependency parser), and the client-side QR generator.
2. **Dual deployment parity.** Dashboard-paste dist (F-43) and wrangler mode (F-44) must behave identically; the only required binding is one KV namespace. No env var is mandatory — first-run wizard seeds everything.
3. **Pure logic testable without workerd.** Strict module separation enforced by lint rule: `src/core/**` (protocol frame parsers/builders, URI codecs, YAML/JSON emitters, fragment math, NAT64 conversion, UA classifier, validators, migrations, remark engine, egress state machine) may not import any Cloudflare-specific module and must run under plain `vitest` on Node. Runtime adapters (KV, `connect()`, `WebSocketPair`) live in `src/adapters/**` behind interfaces; integration tests using `@cloudflare/vitest-pool-workers` are supplementary, not load-bearing.
4. **Secrets never logged.** Single logging wrapper with a redaction deny-list (password, hashes, session ids/secrets, UUID, trojan/ss passwords, chain credentials, cookie values, secure path in free-text form); error responses pass through a sanitizer that strips messages to safe categories (fixes B §G11). A test asserts log output for every route contains no deny-list material.
5. **Settings never exposed unauthenticated.** Auth middleware covers every `/{sp}/panel/**` management route; there is deliberately **no** share-settings/export endpoint in v1 (see F-76). An automated test requests every GET route without a cookie and asserts none returns settings JSON or credential fields. Subscription endpoints are gated by the secure-path capability itself.
6. **No phone-home.** No runtime fetch to author-controlled hosts, GitHub raw, or telemetry endpoints; defaults contain no third-party hostnames anywhere (explicit anti-pattern from E §G3 / N §H5).
7. **Resource budgets.** Typical authenticated request performs ≤1 KV read (isolate cache, F-42); WS early-data decode capped at 8 KB; settings PUT body capped at 256 KB; dist bundle ≤ 800 KB raw / ≤ 250 KB gzipped.
8. **Determinism & honesty.** Config generation is deterministic for identical settings (stable remarks, F-30); usage reporting labeled as estimate; UDP/DNS limitations stated in-panel docs rather than hidden (lesson from B §G15).
---

## 4. Security Model

### 4.1 Threat model (summary)
Adversaries considered: censors probing the domain for fingerprintable responses; opportunistic scanners and brute-forcers hitting the login/setup endpoints; a hostile party who obtains a subscription URL; accidental leakage via logs or error pages. Not in scope: Cloudflare itself, compromise of the owner's CF account, KV infrastructure compromise (blast-radius notes below), or a malicious client already holding valid protocol credentials.

### 4.2 Auth flows
1. **Bootstrap / first-run:** KV has no `pwd_hash` → every panel request renders the forced setup form. `POST /{sp}/setup {password}` is honored **only while unset** (single-flight guard) and enforces complexity (≥8 chars, letter+digit). Stores PBKDF2-SHA256 hash + per-password salt (≥100k iterations). Setup endpoint then permanently refuses until the password-change flow runs.
2. **Login:** `POST /{sp}/login` verifies against the stored hash with constant-time comparison. Success creates a session: 32-byte random id, KV record `session:{id}` = `{uaHash, createdAt}` with 24 h TTL, cookie set as specified in §4.3.
3. **Session verification (middleware):** parse cookie → verify HMAC → KV lookup exists & unexpired → compare UA hash. Any failure returns the camouflage response (§4.4) for non-panel paths and a generic 401 for panel paths — never an explanation of which factor failed.
4. **Logout:** deletes the KV session record (server-side revocation — fixes BPB's stateless-JWT logout gap), clears cookie with `Max-Age=0`.
5. **Password change:** requires current password; writes new hash; **revokes all sessions**; secure path unchanged.
6. **Secure-path regeneration:** authenticated POST; new validated random path returned once; UI warns that all distributed client configs must be re-imported.

### 4.3 Cookie policy
- Name: `__Host-qpsid` (`__Host-` prefix forces Secure + Path=/ + no Domain attribute).
- Flags: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`.
- Value: `{sessionId}.{HMAC-SHA256(sessionId, sessionSecret)}` — unforgeable without the KV-held secret.
- Binding: session record stores truncated SHA-256(User-Agent); mismatch invalidates the session (cheap replay hardening, adopted from edgetunnel's intent but with real crypto).
- All authenticated responses send `Cache-Control: no-store`.

### 4.4 Secure-path semantics
- The path is generated at bootstrap (12–24 URL-safe random chars), user-editable within validation bounds, regenerable (F-36).
- It gates **everything**: panel UI, panel APIs, login/setup, subscriptions, private DoH, and all four proxy WS endpoints (per approved scope). Consequence, accepted and documented: anyone you share configs with knows the path; rotating it breaks existing client configs by design.
- On wrong path, unknown route, or internal error: identical response — status `500` with the embedded fake "Cloudflare error 1101" HTML body (F-37). No 404s, no redirects to login from non-panel paths, no differential timing shortcuts on path comparison.
- `GET /robots.txt` (any path spelling) serves `User-agent: * Disallow: /`.
- Path never appears in logs free-text; redaction list covers it.

### 4.5 Rate-limit-style protections feasible on Workers
Workers have no reliable per-isolate memory across requests and Durable Objects are out of scope (F-68 rationale extended: KV-only storage decision). Feasible, honest measures:
1. **KV-window login throttle** (F-35): counter key with TTL; documented as best-effort due to KV eventual consistency — raises attacker cost, not a hard guarantee.
2. **Setup race-guard**: first-run setup accepted only while password unset; combined with throttle, prevents pre-emptive takeover of fresh deployments.
3. **Payload caps everywhere**: settings PUT ≤256 KB; WS early-data ≤8 KB decoded; remote-sub fetch 5 s timeout + 1 MB cap + cache (fixes B §G8 unbounded fetch).
4. **Constant-time comparisons** on every secret check (path, password, HMACs).
5. **Kill switch** as an instant data-plane stop (F-13) — operational containment lever.
6. **No amplification surfaces**: no server-side QR echo endpoint, no share-settings endpoint, no arbitrary reverse-proxy fallback.

### 4.6 Storage split: KV vs env
| Location | Contents | Notes |
|----------|----------|-------|
| KV (`settings`) | Versioned settings blob (ports, domains, proxyIPs, NAT64 prefixes, DoH upstream, fragment settings, chain proxy, toggles, remote-sub URLs, userinfo factors) | Single key, schema-versioned, migrated per F-42. |
| KV (`pwd_hash`, `pwd_salt`) | Password verifier + salt | Never plaintext (unlike BPB). |
| KV (`session_secret`) | Random 32-byte HMAC key, generated at bootstrap | Rotation invalidates all cookies (emergency lever). |
| KV (`session:{id}`) | Live sessions w/ TTL | Server-side revocation source of truth. |
| KV (`rl:*`) | Login throttle counters | TTL windows. |
| KV (`usage:*`) | Connection counters feeding Subscription-Userinfo estimates | Approximate by design. |
| KV (`rsub_cache:{hash}`) | Remote-sub fetch cache | Short TTL. |
| Env vars (all optional; precedence **env > KV > default**) | `SECURE_PATH`, `VLESS_UUID`, `TROJAN_PASS`, `SS_PASS`, `PROXY_IPS`, `CHAIN_PROXY`, `KILL_SWITCH`, `PANEL_PASSWORD_HASH` | Intended for headless wrangler deploys; secrets should go through `wrangler secret put`. Env values are applied post-migration as overrides and masked in any diagnostic output. |
| Code constants | Nothing sensitive | No embedded credentials, tokens, or author-controlled hosts — the anti-pattern flagged in all three research reports is banned structurally. |

Blast radius note: full KV read leaks everything (protocol credentials included — they cannot be hashed since protocols require raw values). Mitigations: least-privilege KV binding, no API tokens stored anywhere, session-secret rotation, and the documented warning that config sharing == credential sharing.

---

## 5. Out of Scope

Owner-mandated exclusions:
- WARP/WireGuard in any form (accounts, subscriptions, conf zips, noise-on-WG) — F-62.
- REALITY — impossible on Workers — F-63.
- gRPC and xhttp transports (v2 stretch items) — F-45/F-46.
- TURN/SSTP/trojan-upstream egress — F-64.
- Multi-user accounts/quotas/expiry/pause/connection-caps — F-65.
- Telegram bot — Phase 2 roadmap; document webhook contract only — F-61.
- Self-redeploy/self-update/delete-panel through the CF API — F-66; consequence: version display is read-only (F-41) and updates happen by redeploying.
- D1 storage — F-68.
- Geo-naming via ip-api — replaced by static colo→flag map — F-69.

Additional exclusions identified during planning (scope-creep guard):
- Reverse-proxy camouflage to real third-party sites (F-70) — SSRF-ish, external dependency; fake-1101 chosen.
- BEST_SUB feeder mode; panel federation/hub-spoke; per-config derived UUIDs and relay-index pinning (F-71/F-72/F-73) — multi-tenant machinery incompatible with single-user product.
- SS AEAD-2022 ciphers and VMess legacy CFB paths (F-74) — WebCrypto primitive gaps; modern-only clients supported.
- General UDP relay/QUIC (F-75) — platform impossibility; DNS-only conversion is the documented ceiling.
- Runtime fetching of dashboards/templates/rule-lists from GitHub raw or author domains (F-77) — violates self-containment NFR.
- Obfuscation/junk-padding/char-code identifier games (F-78) — auditability deliberately outranks scanner evasion.
- Server-side QR PNG generation and multi-protocol sniffed single-endpoint dispatch (F-79/F-80) — superseded by safer designs.
- Cloudflare Pages as a supported deployment target (F-81) — Workers-only in v1.
- Durable Objects anywhere (rate limiting included) — keeps free-tier deployability and the KV-only storage story coherent.
- Xray/v2ray JSON *inbound* config importers, client-side config converters, and generic subconverter backends — Q Proxy emits, it does not consume foreign formats beyond F-31's URI parsing.
- Automated dependency-update bots and release automation beyond reproducible builds — ops minimalism for v1.

---

## 6. Open Questions (owner decisions pending)

| # | Question | Recommendation (default if unanswered) |
|---|----------|----------------------------------------|
| OQ-1 | **License.** Clean-room rebuild informed by behavioral research (no code copied); BPB is GPL-3.0 but nothing binds us. | **MIT** — maximal adoption, zero copied-code obligations. Switch to GPL-3.0 only if we ever port BPB source directly. |
| OQ-2 | **Secure path inside client configs.** Literal scope puts WS proxy endpoints under the same secret path, so every shared config carries the admin-path prefix and rotation breaks clients. Confirm this trade-off. | **Accept literal scope** (one secret gates everything, documented warning at rotation). Alternative — separate data-plane prefix — only if owner expects heavy config sharing. |
| OQ-3 | **Depth of remote-sub conversion.** Convert ingested nodes into native entries for structured outputs, or pass raw lines into mixed only? | **Convert** vless/vmess/trojan/ss natively into YAML/JSON/Surge/Loon; passthrough unknown schemes into mixed only (as specced in F-31). |
| OQ-4 | **Subscription-Userinfo data source.** Real byte accounting needs the CF GraphQL API (excluded with API-token embedding). | **Estimated counters** (connections × configurable bytes factor) + optional owner-set `total`/`expire`; omit fields when unset (as specced in F-24). |
| OQ-5 | **Plain-port family visibility on custom domains.** BPB offers plain ports only on `*.workers.dev`; CF actually serves them on any proxied hostname unless Always-HTTPS is enforced. | **Auto rule** (workers.dev-only by default) + manual override toggle in settings (as specced in F-15). |


