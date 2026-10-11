// Access log: paginated request history for served subscriptions.
//
// Storage decision: reuse the D1 `audit_log` table when a database is
// present (it already has ts/ip/action/detail with an action index, and
// subscription rows are namespaced as `sub:<format>` so admin-audit reads
// are unaffected), else a KV-backed ring. The D1 `counters` table cannot
// hold per-request rows (single aggregate row), and a fourth table would add
// schema churn for data the dedup window already bounds: `sub:*` rows are
// written at most once per action+detail per 30 minutes.
export interface AccessEvent {
  ts: number;
  ip: string;
  action: string;
  detail: string;
}

export interface AccessLogPage {
  events: AccessEvent[];
  total: number;
  page: number;
  limit: number;
}

export const ACCESS_LOG_KV_KEY = "qproxy:access-log";
export const ACCESS_LOG_KV_MAX = 200;
export const ACCESS_LOG_DEDUP_MS = 30 * 60 * 1000;
export const ACCESS_LOG_ACTION_PREFIX = "sub:";
export const ACCESS_LOG_MAX_LIMIT = 100;

function dbOf(env: Env): D1Database | null {
  const db = (env as Partial<Pick<Env, "QPROXY_DB">>).QPROXY_DB;
  return db === undefined || db === null ? null : db;
}

function kvOf(env: Env): { get(k: string, t: "json"): Promise<unknown>; put(k: string, v: string): Promise<void> } | null {
  const kv = (env as Partial<Pick<Env, "QPROXY_KV">>).QPROXY_KV;
  return kv === undefined || kv === null ? null : (kv as unknown as { get(k: string, t: "json"): Promise<unknown>; put(k: string, v: string): Promise<void> });
}

function isAccessEvent(v: unknown): v is AccessEvent {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.ts === "number" &&
    Number.isFinite(r.ts) &&
    typeof r.ip === "string" &&
    typeof r.action === "string" &&
    typeof r.detail === "string"
  );
}

async function readKvEvents(env: Env): Promise<AccessEvent[]> {
  const kv = kvOf(env);
  if (kv === null) return [];
  try {
    const raw = await kv.get(ACCESS_LOG_KV_KEY, "json");
    if (!Array.isArray(raw)) return [];
    return raw.filter(isAccessEvent).slice(-ACCESS_LOG_KV_MAX);
  } catch {
    return [];
  }
}

async function recordKv(env: Env, event: AccessEvent): Promise<void> {
  const kv = kvOf(env);
  if (kv === null) return;
  const events = await readKvEvents(env);
  const last = events.length > 0 ? events[events.length - 1]! : null;
  if (last !== null && last.action === event.action && last.detail === event.detail && event.ts - last.ts < ACCESS_LOG_DEDUP_MS) {
    return;
  }
  events.push(event);
  await kv.put(ACCESS_LOG_KV_KEY, JSON.stringify(events.slice(-ACCESS_LOG_KV_MAX)));
}

async function recordD1(db: D1Database, event: AccessEvent): Promise<void> {
  const last = await db
    .prepare("SELECT ts FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1")
    .bind(event.action)
    .first<{ ts: number }>();
  if (last !== null && typeof last.ts === "number" && event.ts - last.ts < ACCESS_LOG_DEDUP_MS) {
    const same = await db
      .prepare("SELECT detail FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1")
      .bind(event.action)
      .first<{ detail: string }>();
    if (same !== null && same.detail === event.detail) return;
  }
  await db
    .prepare("INSERT INTO audit_log (ts, ip, action, detail) VALUES (?, ?, ?, ?)")
    .bind(event.ts, event.ip, event.action, event.detail)
    .run();
}

async function readD1Events(db: D1Database, page: number, limit: number): Promise<AccessLogPage> {
  const counted = await db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'sub:%'")
    .first<{ n: number }>();
  const total = typeof counted?.n === "number" ? counted.n : 0;
  const rows = await db
    .prepare("SELECT ts, ip, action, detail FROM audit_log WHERE action LIKE 'sub:%' ORDER BY id DESC LIMIT ? OFFSET ?")
    .bind(limit, (page - 1) * limit)
    .all<AccessEvent>();
  const events = (rows.results ?? []).filter(isAccessEvent);
  return { events, total, page, limit };
}

// Record one access event. Deduped (per action+detail, 30min), storage-safe,
// and never throws — callers fire it via afterResponse.
export async function recordAccessEvent(
  env: Env,
  event: { ip: string; action: string; detail: string },
  now = Date.now(),
): Promise<void> {
  try {
    const entry: AccessEvent = { ts: now, ip: event.ip, action: event.action, detail: event.detail };
    const db = dbOf(env);
    if (db !== null) {
      try {
        await recordD1(db, entry);
        return;
      } catch {
        // Fall through to KV when D1 is unavailable or unmigrated.
      }
    }
    await recordKv(env, entry);
  } catch {
    // Best-effort: access logging must never break serving.
  }
}

export function clampAccessPage(page: number, limit: number): { page: number; limit: number } {
  const sanePage = Number.isInteger(page) && page >= 1 ? page : 1;
  const saneLimit = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, ACCESS_LOG_MAX_LIMIT) : 20;
  return { page: sanePage, limit: saneLimit };
}

export async function readAccessEvents(env: Env, page: number, limit: number): Promise<AccessLogPage> {
  const clamped = clampAccessPage(page, limit);
  const db = dbOf(env);
  if (db !== null) {
    try {
      return await readD1Events(db, clamped.page, clamped.limit);
    } catch {
      // Fall through to KV when D1 is unavailable or unmigrated.
    }
  }
  const all = (await readKvEvents(env)).filter((e) => e.action.startsWith(ACCESS_LOG_ACTION_PREFIX)).reverse();
  return {
    events: all.slice((clamped.page - 1) * clamped.limit, clamped.page * clamped.limit),
    total: all.length,
    page: clamped.page,
    limit: clamped.limit,
  };
}
