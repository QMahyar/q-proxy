# E5 — Subscription caching + update interval
Type: task (AFK) · Phase: Efficiency

## Question
Cache API (caches.default) for subscription responses (5 min, busted on settings save); `Profile-Update-Interval` header; remote-sub fetches cached per `subUpdateIntervalHours` instead of per request.

## Answer

DONE — Cache API (caches.default) keyed URL+_k=format:fragment, TTL 60s via Cache-Control public,max-age=60; remote sub lines memoized per-isolate for subUpdateIntervalHours; Profile-Update-Interval already emitted; guarded for node (unit tests).
