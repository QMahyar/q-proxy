#!/bin/bash
cd "E:/code/Q Proxy" || exit 1
gh issue close 66 --comment "Implemented and merged (D1 for users/activity/quota/counters/audit, KV->D1 auto-migration, deploy script, test D1). 1352 tests green."
gh issue close 70 --comment "Implemented and merged (sing-box typed-DNS schema; min client >=1.12 documented)."
gh issue close 73 --comment "Implemented and merged (panel sources assembled at build, byte-identical output)."
gh issue close 74 --comment "Solved by the D1 migration: counters are now single-statement atomic UPSERTs (no read-modify-write race). No separate work needed."
echo ALLDONE
gh issue list --json number,state --jq '[.[] | select(.state=="OPEN")] | length'
