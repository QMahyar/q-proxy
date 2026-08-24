import type { Env } from "../types/env";
import type { UsageSnapshot } from "../types/context";
import { dayKeyUtc } from "../utils/time";

const KV_KEY = "qproxy:counters";
const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_EVERY_CONNECTIONS = 32;

interface CounterBuffer {
  todayDelta: number;
  totalDelta: number;
  connectionsSinceFlush: number;
  lastFlushMs: number;
  ctx: ExecutionContext | null;
}

const buffer: CounterBuffer = {
  todayDelta: 0,
  totalDelta: 0,
  connectionsSinceFlush: 0,
  lastFlushMs: Date.now(),
  ctx: null,
};

let flushing = false;

export function bindCounterContext(ctx: ExecutionContext): void {
  buffer.ctx = ctx;
}

function waitUntil(promise: Promise<void>): void {
  if (buffer.ctx) buffer.ctx.waitUntil(promise);
}

async function readStored(env: Env): Promise<{ day: string; requestsToday: number; requestsTotal: number }> {
  const raw = await env.QPROXY_KV.get(KV_KEY, "json");
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as Record<string, unknown>).day === "string" &&
    typeof (raw as Record<string, unknown>).requestsTotal === "number"
  ) {
    const r = raw as { day: string; requestsToday?: number; requestsTotal: number };
    const stored = r.requestsToday ?? 0;
    if (r.day !== dayKeyUtc()) return { day: dayKeyUtc(), requestsToday: 0, requestsTotal: r.requestsTotal };
    return { day: r.day, requestsToday: stored, requestsTotal: r.requestsTotal };
  }
  return { day: dayKeyUtc(), requestsToday: 0, requestsTotal: 0 };
}

export async function recordConnection(env: Env): Promise<void> {
  const today = dayKeyUtc();
  buffer.todayDelta += 1;
  buffer.totalDelta += 1;
  buffer.connectionsSinceFlush += 1;
  const stale = Date.now() - buffer.lastFlushMs >= FLUSH_INTERVAL_MS;
  if (!stale && buffer.connectionsSinceFlush < FLUSH_EVERY_CONNECTIONS) return;
  if (flushing) return;
  flushing = true;
  const capturedToday = buffer.todayDelta;
  const capturedTotal = buffer.totalDelta;
  buffer.todayDelta = 0;
  buffer.totalDelta = 0;
  buffer.connectionsSinceFlush = 0;
  buffer.lastFlushMs = Date.now();
  try {
    const stored = await readStored(env);
    const requestsToday = (stored.day === today ? stored.requestsToday : 0) + capturedToday;
    const requestsTotal = stored.requestsTotal + capturedTotal;
    const put = env.QPROXY_KV.put(
      KV_KEY,
      JSON.stringify({ day: today, requestsToday, requestsTotal, updatedAt: Date.now() }),
    );
    waitUntil(put.then(() => undefined));
    await put.catch(() => {});
  } finally {
    flushing = false;
  }
}

export async function readUsage(env: Env): Promise<UsageSnapshot> {
  const stored = await readStored(env);
  return {
    day: stored.day,
    requestsToday: stored.requestsToday + buffer.todayDelta,
    requestsTotal: stored.requestsTotal + buffer.totalDelta,
  };
}
