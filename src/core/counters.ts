import type { Env } from "../types/env";
import type { UsageSnapshot } from "../types/context";
import { bindAuditContext, log } from "./log";
import { dayKeyUtc } from "../utils/time";

export const COUNTERS_KV_KEY = "qproxy:counters";
const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_EVERY_CONNECTIONS = 32;

interface CounterBuffer {
  todayDelta: number;
  totalDelta: number;
  bytesUpDelta: number;
  bytesDownDelta: number;
  connectionsSinceFlush: number;
  lastFlushMs: number;
  ctx: ExecutionContext | null;
}

const buffer: CounterBuffer = {
  todayDelta: 0,
  totalDelta: 0,
  bytesUpDelta: 0,
  bytesDownDelta: 0,
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
  bytesUpTotal?: number;
  bytesDownTotal?: number;
}

interface CountersRow {
  day: string;
  requests_today: number;
  requests_total: number;
  bytes_up: number;
  bytes_down: number;
}

export interface ConnectionBytes {
  bytesUp?: number;
  bytesDown?: number;
}

export interface UsageWithBytes extends UsageSnapshot {
  bytesUpTotal: number;
  bytesDownTotal: number;
}

let usageMemo: { value: StoredUsage; expiresAt: number } | null = null;

export function clearUsageMemoForTests(): void {
  usageMemo = null;
}

export function clearCounterBufferForTests(): void {
  buffer.todayDelta = 0;
  buffer.totalDelta = 0;
  buffer.bytesUpDelta = 0;
  buffer.bytesDownDelta = 0;
  buffer.connectionsSinceFlush = 0;
  buffer.lastFlushMs = Date.now();
  flushing = false;
}

export function bindCounterContext(ctx: ExecutionContext): void {
  buffer.ctx = ctx;
  bindAuditContext(ctx);
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

function dbOf(env: Env): D1Database | null {
  const db = (env as Partial<Pick<Env, "QPROXY_DB">>).QPROXY_DB;
  return db === undefined || db === null ? null : db;
}

function normalizeStored(
  day: string,
  requestsToday: number,
  requestsTotal: number,
  bytesUpTotal: number,
  bytesDownTotal: number,
): StoredUsage {
  if (day !== dayKeyUtc()) {
    return { day: dayKeyUtc(), requestsToday: 0, requestsTotal, bytesUpTotal, bytesDownTotal };
  }
  return { day, requestsToday, requestsTotal, bytesUpTotal, bytesDownTotal };
}

function numField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

async function readStoredKv(env: Env): Promise<StoredUsage> {
  const now = Date.now();
  if (usageMemo !== null && usageMemo.expiresAt > now) return usageMemo.value;
  const raw = await env.QPROXY_KV.get(COUNTERS_KV_KEY, "json");
  let value: StoredUsage;
  if (
    raw !== null &&
    typeof raw === "object" &&
    typeof (raw as Record<string, unknown>).day === "string" &&
    typeof (raw as Record<string, unknown>).requestsTotal === "number"
  ) {
    const r = raw as {
      day: string;
      requestsToday?: number;
      requestsTotal: number;
      bytesUpTotal?: number;
      bytesDownTotal?: number;
    };
    value = normalizeStored(r.day, r.requestsToday ?? 0, r.requestsTotal, r.bytesUpTotal ?? 0, r.bytesDownTotal ?? 0);
  } else {
    value = { day: dayKeyUtc(), requestsToday: 0, requestsTotal: 0, bytesUpTotal: 0, bytesDownTotal: 0 };
  }
  usageMemo = { value, expiresAt: now + USAGE_MEMO_MS };
  return value;
}

async function readStoredD1(db: D1Database): Promise<StoredUsage> {
  const now = Date.now();
  if (usageMemo !== null && usageMemo.expiresAt > now) return usageMemo.value;
  const row = await db
    .prepare("SELECT day, requests_today, requests_total, bytes_up, bytes_down FROM counters WHERE id = 1")
    .first<CountersRow>();
  let value: StoredUsage;
  if (row !== null && typeof row.day === "string") {
    value = normalizeStored(
      row.day,
      numField(row.requests_today),
      numField(row.requests_total),
      numField(row.bytes_up),
      numField(row.bytes_down),
    );
  } else {
    value = { day: dayKeyUtc(), requestsToday: 0, requestsTotal: 0, bytesUpTotal: 0, bytesDownTotal: 0 };
  }
  usageMemo = { value, expiresAt: now + USAGE_MEMO_MS };
  return value;
}

async function readStored(env: Env): Promise<StoredUsage> {
  const db = dbOf(env);
  if (db !== null) {
    try {
      return await readStoredD1(db);
    } catch {
      return readStoredKv(env);
    }
  }
  return readStoredKv(env);
}

export async function recordConnection(env: Env, bytes?: ConnectionBytes): Promise<void> {
  buffer.todayDelta += 1;
  buffer.totalDelta += 1;
  buffer.connectionsSinceFlush += 1;
  ingestBytes(bytes);
  await maybeFlush(env);
}

export async function recordBytes(env: Env, bytes: ConnectionBytes): Promise<void> {
  ingestBytes(bytes);
  await maybeFlush(env);
}

function ingestBytes(bytes: ConnectionBytes | undefined): void {
  buffer.bytesUpDelta += bytes?.bytesUp ?? 0;
  buffer.bytesDownDelta += bytes?.bytesDown ?? 0;
}

async function flushKv(
  env: Env,
  capturedToday: number,
  capturedTotal: number,
  capturedUp: number,
  capturedDown: number,
): Promise<void> {
  const stored = await readStoredKv(env);
  const writeDay = dayKeyUtc();
  const requestsToday = (stored.day === writeDay ? stored.requestsToday : 0) + capturedToday;
  const requestsTotal = stored.requestsTotal + capturedTotal;
  const bytesUpTotal = (stored.bytesUpTotal ?? 0) + capturedUp;
  const bytesDownTotal = (stored.bytesDownTotal ?? 0) + capturedDown;
  const put = env.QPROXY_KV.put(
    COUNTERS_KV_KEY,
    JSON.stringify({ day: writeDay, requestsToday, requestsTotal, bytesUpTotal, bytesDownTotal, updatedAt: Date.now() }),
  );
  usageMemo = {
    value: { day: writeDay, requestsToday, requestsTotal, bytesUpTotal, bytesDownTotal },
    expiresAt: Date.now() + USAGE_MEMO_MS,
  };
  const tracked = put.then(
    () => undefined,
    () => undefined,
  );
  waitUntil(tracked);
  await put.catch((err: unknown) => log.error("counters", "flush failed", String(err)));
}

async function flushD1(
  db: D1Database,
  capturedToday: number,
  capturedTotal: number,
  capturedUp: number,
  capturedDown: number,
): Promise<void> {
  const day = dayKeyUtc();
  const out = await db.batch([
    db.prepare("SELECT day, requests_today, requests_total, bytes_up, bytes_down FROM counters WHERE id = 1"),
    db
      .prepare(
        "INSERT INTO counters(id, day, requests_today, requests_total, bytes_up, bytes_down) VALUES(1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET requests_today = CASE WHEN counters.day = excluded.day THEN counters.requests_today + excluded.requests_today ELSE excluded.requests_today END, requests_total = counters.requests_total + excluded.requests_total, bytes_up = counters.bytes_up + excluded.bytes_up, bytes_down = counters.bytes_down + excluded.bytes_down, day = excluded.day",
      )
      .bind(day, capturedToday, capturedTotal, capturedUp, capturedDown),
  ]);
  const raw = (out[0]!.results?.[0] ?? null) as CountersRow | null;
  const stored =
    raw !== null && typeof raw.day === "string"
      ? normalizeStored(raw.day, numField(raw.requests_today), numField(raw.requests_total), numField(raw.bytes_up), numField(raw.bytes_down))
      : { day, requestsToday: 0, requestsTotal: 0, bytesUpTotal: 0, bytesDownTotal: 0 };
  usageMemo = {
    value: {
      day,
      requestsToday: (stored.day === day ? stored.requestsToday : 0) + capturedToday,
      requestsTotal: stored.requestsTotal + capturedTotal,
      bytesUpTotal: (stored.bytesUpTotal ?? 0) + capturedUp,
      bytesDownTotal: (stored.bytesDownTotal ?? 0) + capturedDown,
    },
    expiresAt: Date.now() + USAGE_MEMO_MS,
  };
}

async function maybeFlush(env: Env): Promise<void> {
  const stale = Date.now() - buffer.lastFlushMs >= FLUSH_INTERVAL_MS;
  if (!stale && buffer.connectionsSinceFlush < FLUSH_EVERY_CONNECTIONS) return;
  if (flushing) return;
  flushing = true;
  const capturedToday = buffer.todayDelta;
  const capturedTotal = buffer.totalDelta;
  const capturedUp = buffer.bytesUpDelta;
  const capturedDown = buffer.bytesDownDelta;
  buffer.todayDelta = 0;
  buffer.totalDelta = 0;
  buffer.bytesUpDelta = 0;
  buffer.bytesDownDelta = 0;
  buffer.connectionsSinceFlush = 0;
  buffer.lastFlushMs = Date.now();
  try {
    const db = dbOf(env);
    if (db !== null) {
      try {
        await flushD1(db, capturedToday, capturedTotal, capturedUp, capturedDown);
      } catch {
        await flushKv(env, capturedToday, capturedTotal, capturedUp, capturedDown);
      }
    } else {
      await flushKv(env, capturedToday, capturedTotal, capturedUp, capturedDown);
    }
  } finally {
    flushing = false;
  }
}

export async function readUsage(env: Env): Promise<UsageWithBytes> {
  const stored = await readStored(env);
  return {
    day: stored.day,
    requestsToday: stored.requestsToday + buffer.todayDelta,
    requestsTotal: stored.requestsTotal + buffer.totalDelta,
    bytesUpTotal: (stored.bytesUpTotal ?? 0) + buffer.bytesUpDelta,
    bytesDownTotal: (stored.bytesDownTotal ?? 0) + buffer.bytesDownDelta,
  };
}
