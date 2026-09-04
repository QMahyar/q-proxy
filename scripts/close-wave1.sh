#!/bin/bash
# Close duplicate issues + merged wave-1 issues
cd "E:/code/Q Proxy" || exit 1

for n in 58 60 62 65 67 68 71 72 75 76 77 78; do
  gh issue close "$n" --reason "not planned" --comment "Duplicate from a double-submitted batch. Keeping the lower-numbered twin." 2>&1 | tail -1
done

for n in 12 13 14 15 17 18 19 20 22 23 24 25 26; do
  gh issue close "$n" --comment "Implemented and merged to master in wave 1 (verified: tsc clean, 1048 tests green, build ok)." 2>&1 | tail -1
done

gh issue comment 27 --body "Partially done in wave 1: counters, errors, fragments, protocols/common specs merged. Still missing: address-probe and proxy-pool specs. Keeping open for those two." 2>&1 | tail -1
gh issue comment 17 --body "Merged. Follow-up verification needed against a real Loon client: emitter uses tls-profile (chrome/safari/ios26 mapping) since no public Loon grammar documents literal client-fingerprint, and ech=<host> is best-guess naming (no public Loon ECH grammar found)." 2>&1 | tail -1

echo '=== OPEN WAVE-1 ISSUES ==='
gh issue list --label wave-1 --json number,title --jq 'sort_by(.number) | .[] | "\(.number) \(.title)"'
