#!/bin/bash
# Q Proxy program tickets, part 2 (remaining 12)
cd "E:/code/Q Proxy" || exit 1

mk(){
  out=$(gh issue create --title "$1" --body "$2" --label "$3" 2>&1)
  echo "$out" | tail -1
}

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
