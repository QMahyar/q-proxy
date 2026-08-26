# E4 — KV store optimizations
Type: task (AFK) · Phase: Efficiency

## Question
Isolate cache 15s→60s; `cacheTtl:60` on KV get; write-through instead of invalidate; conditional write (skip unchanged); readUsage memo. Preserve TOCTOU guarantee (invariant 8: setup re-reads fresh).

## Answer

DONE — CACHE_TTL_MS 60s; KV get cacheTtl:60; saveSettings write-through (remember) with no-op write skip via lastWrittenJson (timestamp-stripped compare); readUsage memoized 15s in counters.ts; store.spec updated (60s TTL, skip test).
