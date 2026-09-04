#!/bin/bash
cd "E:/code/Q Proxy" || exit 1
gh issue close 16 --comment "Implemented and merged (Surge VLESS+SS lines). Verified in wave-1 closeout."
gh issue close 21 --comment "Implemented and merged (KV-backed login throttle). Verified in wave-1 closeout."
gh issue close 28 --comment "Done directly (ARCH Rev 2026-09-04 + changelog + guide fixes)."
gh issue close 56 --comment "Implemented and merged (vision inbound bodyCodec + flow emission)."
gh issue close 57 --comment "Implemented and merged (remoteNodes hy2 backend per ADR-008 model)."
gh issue close 59 --comment "Deferred per ADR-007 (unblock steps documented). Reopen when probes pass."
gh issue close 61 --comment "Will not implement per ADR-006 (Workers cannot terminate Xray-style gRPC)."
gh issue close 63 --comment "Implemented per ADR-008 remote-backend model."
gh issue close 64 --comment "Implemented and merged (vlessFlow + ssDirect settings with goldens)."
echo ALLDONE
gh issue list --limit 100 --json number,state --jq '[.[] | select(.state=="OPEN")] | length'
