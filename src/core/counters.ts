import type { Env } from "../types/env";
import type { UsageSnapshot } from "../types/context";
import { log } from "./log";
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

const USAGE_MEMO_MS = 15_000;

interface StoredUsage {
  day: string;
  requestsToday: number;
  requestsTotal: number;
}

let usageMemo: { value: StoredUsage; expiresAt: number } | null = null;

export function bindCounterContext(ctx: ExecutionContext): void {
  buffer.ctx = ctx;
}

export function getCounterContext(): ExecutionContext | null {
  return buffer.ctx;
}

export function afterResponse(p: Promise<unknown>): void {
  const tracked = p.then(
    () => undefined,
    () => undefined,
  );
  if (buffer.ctx) waitUntil(tracked);
}

function waitUntil(promise: Promise<void>): void {
  if (buffer.ctx === null) return;
  try {
    buffer.ctx.waitUntil(promise);
  } catch {
    void promise;
  }
}

async function readStored(env: Env): Promise<StoredUsage> {
  const now = Date.now();
  if (usageMemo !== null && usageMemo.expiresAt > now) return usageMemo.value;
  const raw = await env.QPROXY_KV.get(KV_KEY, "json");
  let value: StoredUsage;
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as Record<string, unknown>).day === "string" &&
    typeof (raw as Record<string, unknown>).requestsTotal === "number"
  ) {
    const r = raw as { day: string; requestsToday?: number; requestsTotal: number };
    const stored = r.requestsToday ?? 0;
    if (r.day !== dayKeyUtc()) value = { day: dayKeyUtc(), requestsToday: 0, requestsTotal: r.requestsTotal };
    else value = { day: r.day, requestsToday: stored, requestsTotal: r.requestsTotal };
  } else {
    value = { day: dayKeyUtc(), requestsToday: 0, requestsTotal: 0 };
  }
  usageMemo = { value, expiresAt: now + USAGE_MEMO_MS };
  return value;
}

export async function recordConnection(env: Env): Promise<void> {
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
    const writeDay = dayKeyUtc();
    const requestsToday = (stored.day === writeDay ? stored.requestsToday : 0) + capturedToday;
    const requestsTotal = stored.requestsTotal + capturedTotal;
    const put = env.QPROXY_KV.put(
      KV_KEY,
      JSON.stringify({ day: writeDay, requestsToday, requestsTotal, updatedAt: Date.now() }),
    );
    usageMemo = {
      value: { day: writeDay, requestsToday, requestsTotal },
      expiresAt: Date.now() + USAGE_MEMO_MS,
    };
    const tracked = put.then(
      () => undefined,
      () => undefined,
    );
    waitUntil(tracked);
    await put.catch((err: unknown) => log.error("counters", "flush failed", String(err)));
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
