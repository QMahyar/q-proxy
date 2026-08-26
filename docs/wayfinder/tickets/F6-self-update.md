# F6 — Panel self-update (in-depth)
Type: task (AFK) · Phase: Features · Order: 6

## Question
Complete self-update: version check vs GitHub releases API (latest tag), compare to `appVersion()`, surface in panel with guidance link; cache the check; no auto-deploy; graceful offline.

## Answer

DONE (2026-08-25): GET pi/version/check → GitHub releases/latest (8s timeout, null on failure), semver compare vs appVersion(). UPSTREAM_REPO constant (QMahyar/Q-Proxy) in src/handlers/api/version.ts — edit when repo slug is final. UI: Worker status card 'Check for updates' button → toast (updateAvailable v / upToDate / failed).
