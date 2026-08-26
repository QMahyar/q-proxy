# E2 — ETag/304 on settings + bootstrap
Type: task (AFK) · Phase: Efficiency · Blocked by: E1

## Question
Serve `ETag: W/"version-updatedAt"` on GET settings/bootstrap; return 304 on `If-None-Match`; client stores and revalidates.

## Answer

DONE — settingsEtag() = W/"updatedAt-SETTINGS_VERSION"; 304 on If-None-Match in settings GET + bootstrap; client stores ETag in sessionStorage and revalidates.
