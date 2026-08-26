# E7 — Counter flush off critical path
Type: task (AFK) · Phase: Efficiency

## Question
Thread `ExecutionContext` through router; flush counters via `ctx.waitUntil` instead of floating promise.

## Answer

DONE (pre-existing) — worker.ts bindCounterContext already threads ExecutionContext; flush uses waitUntil; usage memo added.
