#!/bin/bash
# Q Proxy program tickets: labels + issues
cd "E:/code/Q Proxy" || exit 1

for L in P0 P1 P2 P3 program quick-win wave-1 wave-2 wave-3 wave-4 wave-5 wave-6 type:security type:feature type:compat type:perf type:docs type:test type:chore type:protocol type:ux type:arch; do
  gh label create "$L" --color 0E8A16 2>/dev/null || true
done
echo LABELS-DONE

mk(){
  out=$(gh issue create --title "$1" --body "$2" --label "$3" 2>&1)
  echo "$out" | tail -1
}

mk 'Program tracker: review-to-ship implementation program' 'Master tracker. Wave1 quickwins+P0+compat. Wave2 security+perf+quality. Wave3 account-security+observability. Wave4 UX+formats. Wave5 protocols. Wave6 architecture XL. Merge then ship per wave.' 'program'
mk 'README test count is stale (763 vs 957)' 'Update README test count to 957. Branch: chore/qw-readme-count' 'wave-1,P3,type:docs,quick-win'
mk 'Panel UX and a11y batch' 'panel.html only: nav+swatch aria-labels, skip link, 401-dirty confirm, persistent error toasts, tab overflow fade, qp_lang sync from settings.language. node check script. Branch: fix/panel-ux-a11y' 'wave-1,P1,type:ux'
mk 'VLESS/Trojan share URIs missing explicit type=ws' 'share-uri.ts: add type=ws to vless+trojan transport params. Update specs. Branch: fix/share-uri-type-ws' 'wave-1,P1,type:compat'
mk 'Clash emitter missing skip-cert-verify on TLS nodes' 'clash-yaml.ts: add skip-cert-verify true to TLS proxies. Update goldens. Branch: fix/clash-skip-cert-verify' 'wave-1,P1,type:compat'
mk 'Surge emitter drops VLESS and SS nodes' 'surge-conf.ts: emit VLESS+SS per Surge 5 grammar. Update goldens. Branch: feat/surge-vless-ss' 'wave-1,P1,type:compat'
mk 'Loon emitter drops SS, lacks fingerprint and ECH' 'loon-conf.ts: add SS + client-fingerprint + ECH. Update goldens. Branch: feat/loon-ss-fp' 'wave-1,P1,type:compat'
mk 'SSRF guard gaps (camouflage, proxyIP, chain)' 'Save-time private-target checks for camouflage.url chainProxy.uri proxyIps. Redirect-hop recheck. ProxyIP candidate filter. Tests. Branch: fix/ssrf-guards' 'wave-1,P0,type:security'
mk 'Early-data oversize must close 1009' 'websocket.ts: close 1009 on oversize early-data instead of silent drop. Test. Branch: fix/early-data-1009' 'wave-1,P0,type:protocol'
mk 'VMess chunk nonce 16-bit wrap guard' 'vmess-crypto.ts: terminate before counter wrap reuse. Test. Branch: fix/vmess-nonce-guard' 'wave-1,P0,type:security'
mk 'KV-backed login rate limit' 'Move brute-force counter from isolate memory to KV keyed by IP and window. Tests. Branch: fix/kv-login-throttle' 'wave-1,P1,type:security'
mk 'Telegram username match is case-sensitive' 'chatMatches lowercase + normalize chatId on save. Test. Branch: fix/telegram-username' 'wave-1,P2,type:chore'
mk 'Parallelize remote subscription fetches' 'merge.ts: Promise.all with 10s total budget. Test. Branch: perf/parallel-remote-sub' 'wave-1,P1,type:perf'
mk 'Downlink pending-bytes hard cap' 'relay.ts: 2MB cap, close 1009 on exceed. Test. Branch: perf/downlink-cap' 'wave-1,P1,type:perf'
mk 'Version subscription edge-cache keys' 'Include settings version/updatedAt in cache key + max-age 300. Test. Branch: perf/sub-cache-version' 'wave-1,P1,type:perf'
mk 'Implement real hostname resolution in routes.ts' 'resolveHostname voids Settings and returns url.hostname. Implement documented rule hostnameOverride ?? primaryCustomDomain ?? hostname + spec. Branch: chore/dead-code' 'wave-1,P2,type:chore'
mk 'Coverage wave 1 (untested modules)' 'New specs only: counters errors fragments protocols/common address-probe proxy-pool. Branch: test/coverage-wave1' 'wave-1,P2,type:test'
mk 'Docs sync wave 1' 'ARCH Rev note + CHANGELOG + 60s TTL fixes + API s16 health row + USER_GUIDE settings table. No README. Branch: docs/wave1-sync' 'wave-1,P2,type:docs'
mk 'DNS-resolved SSRF defense in depth' 'Blocklist + save-time hostname checks + document Workers RFC1918 behavior. Branch: fix/dns-ssrf-depth' 'wave-2,P1,type:security'
mk 'Settings and kill-switch stale-cache CAS' 'Fresh-read on writes + version counter compare-and-swap reject. Tests. Branch: fix/settings-cas' 'wave-2,P0,type:security'
mk 'Legacy PBKDF2-15k hash sweep' 'Background upgrade path for dormant legacy hashes. Test. Branch: feat/legacy-hash-sweep' 'wave-2,P1,type:security'
mk 'Session JTI revocation or removal' 'Implement KV revocation list or remove unused jti. Test. Branch: feat/session-jti' 'wave-2,P2,type:security'
mk 'dispatchApi descriptor-map refactor' 'Replace 20-case switch with declarative route map. Tests green. Branch: refactor/dispatch-map' 'wave-2,P2,type:chore'
mk 'Typed sing-box outbounds + shared TLS helpers' 'Outbound union types + shared nodeHasEch/nodeHasEarlyData. Typecheck. Branch: refactor/typed-emitters' 'wave-2,P2,type:chore'
mk 'DNS resolver LRU eviction' 'resolver.ts FIFO to LRU. Test. Branch: perf/dns-lru' 'wave-2,P2,type:perf'
mk 'Failover dial budget + parallel DNS' '15s total candidate budget + speculative direct dial. Tests. Branch: perf/failover-budget' 'wave-2,P1,type:perf'
mk 'ECH auto-configuration' 'Auto ECH config generation instead of manual ServerName. Tests + UI. Branch: feat/ech-auto' 'wave-2,P1,type:feature'
mk 'Coverage wave 2' 'WARP goldens + sub pipeline integration + shared test helpers + relay failover paths. Branch: test/coverage-wave2' 'wave-2,P2,type:test'
mk 'TOTP two-factor auth for panel login' 'Pure-JS TOTP, QR setup, recovery codes, login verify. Tests + UI. Branch: feat/totp-2fa' 'wave-3,P1,type:security'
mk 'IP allowlist for panel access' 'allowedIPs setting checked in auth guard. Tests + UI. Branch: feat/ip-allowlist' 'wave-3,P1,type:security'
mk 'Admin audit log' 'Log settings/user/warp/killswitch/password actions with time+IP. Tests. Branch: feat/audit-log' 'wave-3,P1,type:security'
mk 'Real bandwidth accounting' 'Measure bytes in relay pump, flush to KV, fix Subscription-Userinfo. Tests. Branch: feat/bandwidth-acct' 'wave-3,P1,type:feature'
mk 'Per-user activity logs' 'Connection events to queryable store. Tests + UI. Branch: feat/activity-logs' 'wave-3,P1,type:feature'
mk 'Per-user connection rate limiting' 'Token-bucket per user in relay path. Tests. Branch: feat/user-ratelimit' 'wave-3,P1,type:security'
mk 'Expiry and quota Telegram notifications' 'Scheduled check + bot alerts for expiring/over-quota users. Branch: feat/expiry-notify' 'wave-3,P2,type:feature'
mk 'Telegram inline keyboards' 'Callback buttons for status/kill/users quick actions. Tests. Branch: feat/tg-keyboards' 'wave-3,P2,type:feature'
mk 'Country and city subscription filtering' 'Metadata on addresses + filter param in generateNodes. Tests + UI. Branch: feat/country-filter' 'wave-4,P1,type:feature'
mk 'Subscription token rotation UI' 'Expose regenerate-token in panel with refresh guidance. Branch: feat/token-rotation' 'wave-4,P1,type:feature'
mk 'Quantumult X emitter' 'quantumult-conf.ts + registry + UA tokens + goldens. Branch: feat/quantumult-emitter' 'wave-4,P2,type:feature'
mk 'Bulk user operations' 'Checkbox multi-select + batch enable/disable/delete/expiry API+UI. Tests. Branch: feat/bulk-users' 'wave-4,P2,type:feature'
mk 'Keyboard shortcuts and command palette' 'Ctrl+S Ctrl+K + nav shortcuts in panel. Branch: feat/shortcuts' 'wave-4,P2,type:ux'
mk 'Mobile responsiveness pass' 'Audit sub-500px layouts: tables tabs modals touch targets. Branch: fix/mobile-pass' 'wave-4,P1,type:ux'
mk 'Traffic graphs in panel' 'Hourly buckets + SVG charts from counter data. Branch: feat/traffic-graphs' 'wave-4,P2,type:ux'
mk 'Settings backup reminder and automation' 'Export reminders + optional scheduled backup hook. Branch: feat/backup-reminder' 'wave-4,P1,type:feature'
mk 'Undo/redo for settings edits' 'Client-side snapshots + Ctrl+Z/Y + section dirty marks. Branch: feat/undo-redo' 'wave-4,P2,type:ux'
mk 'VLESS xtls-rprx-vision flow' 'Vision framing in vless.ts + flow param in URIs/emitters. Xray-vector tests. Branch: feat/vless-vision' 'wave-5,P1,type:protocol'
mk 'Hysteria2 support' 'Scope: WS-repackaged inbound if feasible else hy2 URI parse+emit for external backends. Record decision in ADR. Tests. Branch: feat/hysteria2' 'wave-5,P1,type:protocol'
mk 'XHTTP transport support' 'VLESS over HTTP upgrade/POST transport. Tests + emitters. Branch: feat/xhttp' 'wave-5,P1,type:protocol'
mk 'gRPC transport feasibility' 'Feasibility spike first: no runtime deps allowed. Implement if viable else close with ADR. Branch: feat/grpc' 'wave-5,P2,type:protocol'
mk 'REALITY remote-backend support' 'Cannot terminate on Workers. Support external REALITY nodes in subs + docs. Branch: feat/reality-remote' 'wave-5,P1,type:protocol'
mk 'Direct-SS (non-plugin) node option' 'Setting to emit direct SS URIs alongside v2ray-plugin ones. Tests. Branch: feat/direct-ss' 'wave-5,P2,type:protocol'
mk 'D1 and Durable Objects storage migration' 'Plan agent first. Migrate hot state off KV with ACID semantics. Full tests. Branch: arch/d1-migration' 'wave-6,P1,type:arch'
mk 'Multi-admin roles' 'After D1 wave. Roles + delegation + per-admin audit. Branch: arch/multi-admin' 'wave-6,P2,type:arch'
mk 'sing-box 1.8+ DNS schema migration' 'Revisit documented rejection. New schema with legacy fallback if compat risk. Goldens. Branch: feat/singbox-dns-18' 'wave-6,P2,type:compat'
mk 'panel.html build-time assembly' 'Split sources, assemble at build, keep single-file output + zero deps. Branch: arch/panel-build' 'wave-6,P3,type:arch'
mk 'Exact quota counters' 'Race-free counters via DO/D1. Replaces estimates. Tests. Branch: arch/quota-counters' 'wave-6,P1,type:arch'

echo '=== ISSUE COUNT ==='
gh issue list --limit 100 --json number --jq length
