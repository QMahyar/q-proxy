#!/bin/bash
cd "E:/code/Q Proxy" || exit 1
gh issue comment 69 --body "Deferred to v1.4.0+ by owner decision at v1.3.0 ship time: single-admin stands (ARCHITECTURE.md scope note). D1 users table now exists, so a future admins/roles wave has its storage ready."
gh issue close 11 --comment "Program complete: v1.3.0 tagged and pushed. 6 waves, 50+ branches merged, 1356 tests green, zero open review items except #69 (multi-admin, deferred to v1.4.0+) and transport ADRs (gRPC wont-do, XHTTP parked on probes)."
echo ALLDONE
git ls-remote --tags origin | tail -3
