# E3 — Client-side request discipline
Type: task (AFK) · Phase: Efficiency · Blocked by: E1

## Question
sessionStorage cache (30s) + in-flight dedup in api(); kill-switch double-click debounce; my-ip fetched on demand only.

## Answer

DONE — api(): sessionStorage 30s cache (qpc:/qpe: keys) + in-flight Promise dedup + 304 fallback; kill-switch debounced 300ms with AbortController; my-ip fetched only on Refresh.
