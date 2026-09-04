import { COUNTERS_KV_KEY } from "../core/counters";
import { constantTimeEqual } from "../utils/random";
import { dayKeyUtc } from "../utils/time";
import type { AddressSetting } from "../types/settings";

export interface UserAccount {
  id: string;
  name: string;
  tokenHash: string;
  tokenHint: string;
  enabled: boolean;
  expiresAt: number | null;
  dailyReqLimit: number | null;
  protocols: "all" | string[];
  addressOverride?: AddressSetting | null;
  createdAt: string;
}

export type PublicUser = Omit<UserAccount, "tokenHash"> & { todayHits?: number };

export const USERS_KEY = "qproxy:users";
export const USER_USAGE_PREFIX = "qproxy:user-usage:";
export const USER_TOTAL_PREFIX = "qproxy:user-total:";
export const USER_ACTIVITY_PREFIX = "qproxy:user-activity:";
export const USER_ACTIVITY_MAX_DAYS = 31;
export const USER_ACTIVITY_DEFAULT_DAYS = 7;
export const MAX_USERS = 50;

export interface UserActivityDay {
  day: string;
  requests: number;
  bytesUp: number;
  bytesDown: number;
}

export interface UserActivityDelta {
  requests?: number;
  bytesUp?: number;
  bytesDown?: number;
}

export interface StoreEnv {
  QPROXY_KV: KvLike;
  QPROXY_DB?: D1Database | null;
}

type KvLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list?: (options: { prefix: string; cursor?: string }) => Promise<KvListPage>;
};

interface KvListPage {
  keys: Array<{ name: string }>;
  list_complete: boolean;
  cursor?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PROTOCOL_KINDS = ["vless", "vmess", "trojan", "ss"] as const;

export const D1_SCHEMA = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  daily_req_limit INTEGER,
  protocols TEXT NOT NULL DEFAULT '"all"',
  address_override TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_totals (
  token_hash TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_usage (
  day TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, token_hash)
);
CREATE TABLE IF NOT EXISTS user_activity (
  day TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  bytes_up INTEGER NOT NULL DEFAULT 0,
  bytes_down INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, token_hash)
);
CREATE TABLE IF NOT EXISTS counters (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  requests_today INTEGER NOT NULL DEFAULT 0,
  requests_total INTEGER NOT NULL DEFAULT 0,
  bytes_up INTEGER NOT NULL DEFAULT 0,
  bytes_down INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_user_usage_hash ON user_usage (token_hash);
CREATE INDEX IF NOT EXISTS idx_user_activity_hash ON user_activity (token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
`;

const MIGRATION_GUARD_KEY = "kv_migrated_v1";

const USER_COLUMNS =
  "id, name, token_hash, token_hint, enabled, expires_at, daily_req_limit, protocols, address_override, created_at";

interface UserRow {
  id: string;
  name: string;
  token_hash: string;
  token_hint: string;
  enabled: number;
  expires_at: number | null;
  daily_req_limit: number | null;
  protocols: string;
  address_override: string | null;
  created_at: string;
}

function dbOf(env: StoreEnv): D1Database | null {
  const db = env.QPROXY_DB;
  return db === undefined || db === null ? null : db;
}

export async function ensureD1Schema(db: D1Database): Promise<void> {
  const parts = D1_SCHEMA.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const part of parts) {
    try {
      await db.prepare(part).run();
    } catch {
      await db.exec(part);
    }
  }
}

function parseProtocolsJson(raw: unknown): "all" | string[] {
  if (typeof raw !== "string") return "all";
  try {
    return normalizeProtocols(JSON.parse(raw));
  } catch {
    return "all";
  }
}

function parseOverrideJson(raw: unknown): AddressSetting | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return normalizeAddressOverride(JSON.parse(raw));
  } catch {
    return null;
  }
}

function rowToUser(r: UserRow): UserAccount {
  return {
    id: r.id,
    name: r.name,
    tokenHash: r.token_hash,
    tokenHint: r.token_hint,
    enabled: r.enabled === 1,
    expiresAt: typeof r.expires_at === "number" ? r.expires_at : null,
    dailyReqLimit: typeof r.daily_req_limit === "number" ? r.daily_req_limit : null,
    protocols: parseProtocolsJson(r.protocols),
    addressOverride: parseOverrideJson(r.address_override),
    createdAt: r.created_at,
  };
}

function userBind(u: UserAccount): Array<string | number | null> {
  return [
    u.id,
    u.name,
    u.tokenHash.toLowerCase(),
    u.tokenHint,
    u.enabled ? 1 : 0,
    u.expiresAt,
    u.dailyReqLimit,
    JSON.stringify(u.protocols),
    u.addressOverride === undefined || u.addressOverride === null ? null : JSON.stringify(u.addressOverride),
    u.createdAt,
  ];
}

function batchCount(r: D1Result): number {
  const row = (r.results?.[0] ?? null) as { n?: unknown } | null;
  return row !== null && typeof row.n === "number" ? row.n : 0;
}

function countValue(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

function d1ActivityRowToDay(raw: unknown, day: string): UserActivityDay {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    return {
      day: typeof r.day === "string" ? r.day : day,
      requests: toNonNegativeInt(r.requests),
      bytesUp: toNonNegativeInt(r.bytes_up),
      bytesDown: toNonNegativeInt(r.bytes_down),
    };
  }
  return { day, requests: 0, bytesUp: 0, bytesDown: 0 };
}

async function listUsersD1(db: D1Database): Promise<UserAccount[]> {
  const res = await db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY rowid`).all<UserRow>();
  return (res.results ?? []).map(rowToUser);
}

async function saveUsersD1(db: D1Database, users: UserAccount[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM users")];
  for (const u of users) {
    stmts.push(
      db.prepare(`INSERT INTO users(${USER_COLUMNS}) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...userBind(u)),
    );
  }
  await db.batch(stmts);
}

async function findUserByTokenD1(db: D1Database, token: string): Promise<UserAccount | null> {
  if (!isUuid(token)) return null;
  const hash = await hashToken(token);
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE token_hash = ?`)
    .bind(hash)
    .first<UserRow>();
  return row === null ? null : rowToUser(row);
}

function hitCountOf(raw: unknown): number {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return countValue((raw as Record<string, unknown>).hits);
  }
  return countValue(raw);
}

async function getUserHitsD1(db: D1Database, h: string): Promise<number> {
  const row = await db
    .prepare("SELECT hits FROM user_usage WHERE day = ? AND token_hash = ?")
    .bind(dayKeyUtc(), h)
    .first<{ hits: unknown }>();
  return hitCountOf(row);
}

async function getUserTotalHitsD1(db: D1Database, h: string): Promise<number> {
  const row = await db
    .prepare("SELECT total FROM user_totals WHERE token_hash = ?")
    .bind(h)
    .first<{ total: unknown }>();
  if (row !== null && typeof row === "object" && !Array.isArray(row)) {
    return countValue((row as Record<string, unknown>).total);
  }
  return 0;
}

async function consumeUserHitD1(
  db: D1Database,
  h: string,
  limit: number | null,
): Promise<{ allowed: boolean; hits: number; total: number }> {
  const day = dayKeyUtc();
  const upsert =
    limit === null
      ? db
          .prepare(
            "INSERT INTO user_usage(day, token_hash, hits) VALUES(?, ?, 1) ON CONFLICT(day, token_hash) DO UPDATE SET hits = user_usage.hits + 1",
          )
          .bind(day, h)
      : db
          .prepare(
            "INSERT INTO user_usage(day, token_hash, hits) VALUES(?, ?, 1) ON CONFLICT(day, token_hash) DO UPDATE SET hits = user_usage.hits + 1 WHERE user_usage.hits < ?",
          )
          .bind(day, h, limit);
  const out = await db.batch([
    upsert,
    db.prepare("SELECT hits FROM user_usage WHERE day = ? AND token_hash = ?").bind(day, h),
  ]);
  const wrote = out[0]!.meta?.changes;
  const hits = hitCountOf(out[1]!.results?.[0]);
  const allowed = wrote === undefined ? limit === null || hits <= limit : wrote > 0;
  if (!allowed) return { allowed, hits, total: await getUserTotalHitsD1(db, h) };
  await db.batch([
    db
      .prepare(
        "INSERT INTO user_activity(day, token_hash, requests, bytes_up, bytes_down) VALUES(?, ?, 1, 0, 0) ON CONFLICT(day, token_hash) DO UPDATE SET requests = user_activity.requests + 1",
      )
      .bind(day, h),
    db
      .prepare(
        "INSERT INTO user_totals(token_hash, total) VALUES(?, 1) ON CONFLICT(token_hash) DO UPDATE SET total = user_totals.total + 1",
      )
      .bind(h),
  ]);
  return { allowed, hits, total: await getUserTotalHitsD1(db, h) };
}

async function recordUserActivityD1(db: D1Database, h: string, delta: UserActivityDelta): Promise<UserActivityDay> {
  const day = dayKeyUtc();
  const gained = {
    requests: toNonNegativeInt(delta.requests),
    bytesUp: toNonNegativeInt(delta.bytesUp),
    bytesDown: toNonNegativeInt(delta.bytesDown),
  };
  const select = db
    .prepare("SELECT day, requests, bytes_up, bytes_down FROM user_activity WHERE day = ? AND token_hash = ?")
    .bind(day, h);
  if (gained.requests === 0 && gained.bytesUp === 0 && gained.bytesDown === 0) {
    return d1ActivityRowToDay(await select.first(), day);
  }
  const out = await db.batch([
    db
      .prepare(
        "INSERT INTO user_activity(day, token_hash, requests, bytes_up, bytes_down) VALUES(?, ?, ?, ?, ?) ON CONFLICT(day, token_hash) DO UPDATE SET requests = user_activity.requests + excluded.requests, bytes_up = user_activity.bytes_up + excluded.bytes_up, bytes_down = user_activity.bytes_down + excluded.bytes_down",
      )
      .bind(day, h, gained.requests, gained.bytesUp, gained.bytesDown),
    select,
  ]);
  return d1ActivityRowToDay(out[1]!.results?.[0], day);
}

async function getUserActivityD1(db: D1Database, h: string, days: number): Promise<UserActivityDay[]> {
  const count = Number.isFinite(days)
    ? Math.min(Math.max(Math.floor(days), 1), USER_ACTIVITY_MAX_DAYS)
    : USER_ACTIVITY_DEFAULT_DAYS;
  const now = Date.now();
  const labels: string[] = [];
  for (let i = count - 1; i >= 0; i--) labels.push(dayKeyUtc(new Date(now - i * 86400000)));
  const res = await db
    .prepare(
      `SELECT day, requests, bytes_up, bytes_down FROM user_activity WHERE token_hash = ? AND day IN (${labels.map(() => "?").join(", ")})`,
    )
    .bind(h, ...labels)
    .all<{ day: string }>();
  const byDay = new Map<string, UserActivityDay>();
  for (const r of res.results ?? []) byDay.set(r.day, d1ActivityRowToDay(r, r.day));
  return labels.map((day) => byDay.get(day) ?? { day, requests: 0, bytesUp: 0, bytesDown: 0 });
}

interface UsageDayRow {
  day: string;
  hits: number;
}

async function migrateUserUsageD1(db: D1Database, oldH: string, newH: string): Promise<void> {
  const usage = await db
    .prepare("SELECT day, hits FROM user_usage WHERE token_hash = ?")
    .bind(oldH)
    .all<UsageDayRow>();
  const activity = await db
    .prepare("SELECT day, requests, bytes_up, bytes_down FROM user_activity WHERE token_hash = ?")
    .bind(oldH)
    .all<{ day: string }>();
  const totalRow = await db
    .prepare("SELECT total FROM user_totals WHERE token_hash = ?")
    .bind(oldH)
    .first<{ total: unknown }>();
  const stmts: D1PreparedStatement[] = [];
  for (const r of usage.results ?? []) {
    const day = typeof r.day === "string" ? r.day : "";
    const hits = typeof r.hits === "number" && Number.isFinite(r.hits) && r.hits > 0 ? Math.floor(r.hits) : 0;
    if (day.length === 0 || hits <= 0) continue;
    stmts.push(
      db
        .prepare(
          "INSERT INTO user_usage(day, token_hash, hits) VALUES(?, ?, ?) ON CONFLICT(day, token_hash) DO UPDATE SET hits = user_usage.hits + excluded.hits",
        )
        .bind(day, newH, hits),
    );
  }
  for (const r of activity.results ?? []) {
    const row = d1ActivityRowToDay(r, typeof r.day === "string" ? r.day : "");
    if (row.day.length === 0 || (row.requests === 0 && row.bytesUp === 0 && row.bytesDown === 0)) continue;
    stmts.push(
      db
        .prepare(
          "INSERT INTO user_activity(day, token_hash, requests, bytes_up, bytes_down) VALUES(?, ?, ?, ?, ?) ON CONFLICT(day, token_hash) DO UPDATE SET requests = user_activity.requests + excluded.requests, bytes_up = user_activity.bytes_up + excluded.bytes_up, bytes_down = user_activity.bytes_down + excluded.bytes_down",
        )
        .bind(row.day, newH, row.requests, row.bytesUp, row.bytesDown),
    );
  }
  const oldTotal =
    totalRow !== null && typeof totalRow === "object" && !Array.isArray(totalRow)
      ? countValue((totalRow as Record<string, unknown>).total)
      : 0;
  if (oldTotal > 0) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO user_totals(token_hash, total) VALUES(?, ?) ON CONFLICT(token_hash) DO UPDATE SET total = user_totals.total + excluded.total",
        )
        .bind(newH, oldTotal),
    );
  }
  stmts.push(db.prepare("DELETE FROM user_usage WHERE token_hash = ?").bind(oldH));
  stmts.push(db.prepare("DELETE FROM user_activity WHERE token_hash = ?").bind(oldH));
  stmts.push(db.prepare("DELETE FROM user_totals WHERE token_hash = ?").bind(oldH));
  await db.batch(stmts);
}

export function normalizeProtocols(value: unknown): "all" | string[] {
  if (value === "all") return "all";
  if (!Array.isArray(value)) return "all";
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && (PROTOCOL_KINDS as readonly string[]).includes(v) && !out.includes(v)) {
      out.push(v);
    }
  }
  return out;
}

function sanitizeStoredUser(u: UserAccount): UserAccount {
  return {
    ...u,
    enabled: typeof u.enabled === "boolean" ? u.enabled : true,
    expiresAt: typeof u.expiresAt === "number" || u.expiresAt === null ? u.expiresAt : null,
    dailyReqLimit: typeof u.dailyReqLimit === "number" || u.dailyReqLimit === null ? u.dailyReqLimit : null,
    protocols: normalizeProtocols(u.protocols),
    addressOverride: normalizeAddressOverride(u.addressOverride),
  };
}

export function normalizeAddressOverride(value: unknown): AddressSetting | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const addrRaw = typeof r.address === "string" ? r.address.trim() : "";
  if (addrRaw.length === 0) return null;
  const out: AddressSetting = { address: addrRaw };
  if (typeof r.port === "number" && Number.isInteger(r.port) && r.port > 0) out.port = r.port;
  if (typeof r.label === "string" && r.label.trim().length > 0) out.label = r.label.trim();
  if (typeof r.host === "string" && r.host.trim().length > 0) out.host = r.host.trim();
  if (typeof r.sni === "string" && r.sni.trim().length > 0) out.sni = r.sni.trim();
  return out;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function tokenHintFor(token: string): string {
  return token.slice(0, 8) + "…";
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < arr.length; i++) hex += arr[i]!.toString(16).padStart(2, "0");
  return hex;
}

async function toHash(token: string): Promise<string> {
  if (HASH_RE.test(token)) return token.toLowerCase();
  return hashToken(token);
}

function isUser(raw: unknown): raw is UserAccount {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.tokenHash === "string" &&
    typeof r.tokenHint === "string" &&
    HASH_RE.test(r.tokenHash as string)
  );
}

function isLegacyUser(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" && typeof r.token === "string";
}

async function legacyRowToUser(rec: Record<string, unknown>): Promise<UserAccount> {
  const token = rec.token as string;
  const tokenHash = await hashToken(token);
  const tokenHint = tokenHintFor(token);
  return {
    id: rec.id as string,
    name: rec.name as string,
    tokenHash,
    tokenHint,
    enabled: typeof rec.enabled === "boolean" ? (rec.enabled as boolean) : true,
    expiresAt: typeof rec.expiresAt === "number" || rec.expiresAt === null ? (rec.expiresAt as number | null) : null,
    dailyReqLimit:
      typeof rec.dailyReqLimit === "number" || rec.dailyReqLimit === null
        ? (rec.dailyReqLimit as number | null)
        : null,
    protocols: normalizeProtocols(rec.protocols),
    addressOverride: normalizeAddressOverride(rec.addressOverride),
    createdAt: typeof rec.createdAt === "string" ? (rec.createdAt as string) : new Date().toISOString(),
  };
}

export async function listUsers(env: StoreEnv): Promise<UserAccount[]> {
  const db = dbOf(env);
  if (db !== null) {
    try {
      const users = await listUsersD1(db);
      usersMemo = { value: users.map((u) => ({ ...u })), expiresAt: Date.now() + USERS_MEMO_MS };
      return users.map((u) => ({ ...u }));
    } catch {
      return (await listUsersCached(env)).users.map((u) => ({ ...u }));
    }
  }
  return (await listUsersCached(env)).users.map((u) => ({ ...u }));
}

const USERS_MEMO_MS = 15_000;

interface UsersMemo {
  value: UserAccount[];
  expiresAt: number;
}

let usersMemo: UsersMemo | null = null;

export function clearUsersMemoForTests(): void {
  usersMemo = null;
}

async function listUsersCached(env: StoreEnv): Promise<{ users: UserAccount[] }> {
  const now = Date.now();
  if (usersMemo !== null && usersMemo.expiresAt > now) return { users: usersMemo.value };
  const users = await listUsersFromKv(env);
  usersMemo = { value: users, expiresAt: now + USERS_MEMO_MS };
  return { users };
}

async function listUsersFromKv(env: StoreEnv): Promise<UserAccount[]> {
  const raw = (await env.QPROXY_KV.get(USERS_KEY, "json")) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: UserAccount[] = [];
  for (const entry of raw) {
    if (isUser(entry)) {
      out.push(sanitizeStoredUser(entry));
      continue;
    }
    if (isLegacyUser(entry)) {
      out.push(await legacyRowToUser(entry as Record<string, unknown>));
      continue;
    }
  }
  return out;
}

export async function saveUsers(env: StoreEnv, users: UserAccount[]): Promise<void> {
  const clean: UserAccount[] = [];
  for (const u of users) if (isUser(u)) clean.push(sanitizeStoredUser(u));
  const db = dbOf(env);
  if (db !== null) {
    try {
      await saveUsersD1(db, clean);
      usersMemo = { value: clean.map((u) => ({ ...u })), expiresAt: Date.now() + USERS_MEMO_MS };
      return;
    } catch {
      await env.QPROXY_KV.put(USERS_KEY, JSON.stringify(clean));
      usersMemo = { value: clean.map((u) => ({ ...u })), expiresAt: Date.now() + USERS_MEMO_MS };
      return;
    }
  }
  await env.QPROXY_KV.put(USERS_KEY, JSON.stringify(clean));
  usersMemo = { value: clean.map((u) => ({ ...u })), expiresAt: Date.now() + USERS_MEMO_MS };
}

export function newUserToken(): string {
  return crypto.randomUUID();
}

export function newUserId(): string {
  return crypto.randomUUID();
}

export async function findUserByToken(env: StoreEnv, token: string): Promise<UserAccount | null> {
  const db = dbOf(env);
  if (db !== null) {
    try {
      return await findUserByTokenD1(db, token);
    } catch {
      return findUserByTokenKv(env, token);
    }
  }
  return findUserByTokenKv(env, token);
}

async function findUserByTokenKv(env: StoreEnv, token: string): Promise<UserAccount | null> {
  if (!isUuid(token)) return null;
  const hash = await hashToken(token);
  const users = await listUsers(env);
  return users.find((u) => constantTimeEqual(u.tokenHash, hash)) ?? null;
}

export function sanitizeUser(user: UserAccount): PublicUser {
  return {
    id: user.id,
    name: user.name,
    tokenHint: user.tokenHint,
    enabled: user.enabled,
    expiresAt: user.expiresAt,
    dailyReqLimit: user.dailyReqLimit,
    protocols: user.protocols,
    addressOverride: user.addressOverride ?? null,
    createdAt: user.createdAt,
  };
}

function legacyUsageKey(): string {
  return USER_USAGE_PREFIX + dayKeyUtc();
}

function usageKey(hash: string): string {
  return USER_USAGE_PREFIX + dayKeyUtc() + ":" + hash;
}

interface UsageRow {
  token: string;
  count: number;
}

async function readUsageRows(env: StoreEnv): Promise<UsageRow[]> {
  const raw = (await env.QPROXY_KV.get(legacyUsageKey(), "json")) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: UsageRow[] = [];
  for (const row of raw) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.token === "string" && typeof r.count === "number") out.push({ token: r.token, count: r.count });
  }
  return out;
}

const usageLocks = new Map<string, Promise<unknown>>();

const TOTAL_FLUSH_MS = 60_000;
const TOTAL_FLUSH_HITS = 32;
const TOTAL_MEMO_LIMIT = 512;

interface TotalMemoEntry {
  value: number;
  expiresAt: number;
}

const totalMemo = new Map<string, TotalMemoEntry>();
const totalDeltas = new Map<string, number>();
let totalHitsSinceFlush = 0;
let totalLastFlushMs = Date.now();
let totalFlushing = false;

export function clearUserTotalsForTests(): void {
  totalMemo.clear();
  totalDeltas.clear();
  totalHitsSinceFlush = 0;
  totalLastFlushMs = Date.now();
  totalFlushing = false;
}

function parseTotalValue(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

function memoizeTotal(key: string, value: number): void {
  if (totalMemo.size >= TOTAL_MEMO_LIMIT) totalMemo.clear();
  totalMemo.set(key, { value, expiresAt: Date.now() + USERS_MEMO_MS });
}

async function flushUserTotals(env: StoreEnv, captured: Map<string, number>): Promise<void> {
  if (captured.size === 0) return;
  try {
    const entries = [...captured.entries()];
    const reads = await Promise.all(entries.map(([k]) => env.QPROXY_KV.get(k, "json")));
    await Promise.all(
      entries.map(async ([k], i) => {
        const value = parseTotalValue(reads[i]) + captured.get(k)!;
        memoizeTotal(k, value);
        await env.QPROXY_KV.put(k, JSON.stringify(value));
      }),
    );
  } catch {
    totalMemo.clear();
  }
}

export async function flushPendingUserTotals(env: StoreEnv): Promise<void> {
  const captured = new Map(totalDeltas);
  totalDeltas.clear();
  await flushUserTotals(env, captured);
}

async function baseForKey(env: StoreEnv, key: string): Promise<number> {
  const memo = totalMemo.get(key);
  if (memo !== undefined && memo.expiresAt > Date.now()) return memo.value;
  const base = parseTotalValue(await env.QPROXY_KV.get(key, "json"));
  memoizeTotal(key, base);
  return base;
}

async function totalForKey(env: StoreEnv, key: string): Promise<number> {
  return (await baseForKey(env, key)) + (totalDeltas.get(key) ?? 0);
}

async function bumpUserTotal(env: StoreEnv, hash: string): Promise<number> {
  const key = USER_TOTAL_PREFIX + hash;
  const pending = (totalDeltas.get(key) ?? 0) + 1;
  totalDeltas.set(key, pending);
  totalHitsSinceFlush += 1;
  const total = (await baseForKey(env, key)) + pending;
  const stale = Date.now() - totalLastFlushMs >= TOTAL_FLUSH_MS;
  if (!stale && totalHitsSinceFlush < TOTAL_FLUSH_HITS) return total;
  if (totalFlushing) return total;
  totalFlushing = true;
  totalHitsSinceFlush = 0;
  totalLastFlushMs = Date.now();
  try {
    const captured = new Map(totalDeltas);
    totalDeltas.clear();
    await flushUserTotals(env, captured);
  } finally {
    totalFlushing = false;
  }
  return total;
}

function withUsageLock<T>(token: string, fn: () => Promise<T>): Promise<T> {
  const prev = usageLocks.get(token) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  usageLocks.set(token, next.catch(() => undefined));
  return next;
}

async function findUsageRow(rows: UsageRow[], hash: string): Promise<UsageRow | undefined> {
  const exact = rows.find((r) => r.token === hash);
  if (exact !== undefined) return exact;
  for (const r of rows) {
    if (HASH_RE.test(r.token) || !isUuid(r.token)) continue;
    if ((await hashToken(r.token)) === hash) {
      r.token = hash;
      return r;
    }
  }
  return undefined;
}

async function readUsageCount(env: StoreEnv, hash: string): Promise<number> {
  const raw = (await env.QPROXY_KV.get(usageKey(hash), "json")) as unknown;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  const rows = await readUsageRows(env);
  const row = await findUsageRow(rows, hash);
  const count = row ? row.count : 0;
  if (row) {
    await env.QPROXY_KV.put(usageKey(hash), JSON.stringify(count));
    await env.QPROXY_KV.put(legacyUsageKey(), JSON.stringify(rows));
  }
  return count;
}

export function consumeUserHit(
  env: StoreEnv,
  token: string,
  limit: number | null,
): Promise<{ allowed: boolean; hits: number; total: number }> {
  const db = dbOf(env);
  if (db === null) return consumeUserHitKv(env, token, limit);
  return (async () => {
    try {
      return await consumeUserHitD1(db, await toHash(token), limit);
    } catch {
      return consumeUserHitKv(env, token, limit);
    }
  })();
}

function consumeUserHitKv(
  env: StoreEnv,
  token: string,
  limit: number | null,
): Promise<{ allowed: boolean; hits: number; total: number }> {
  return withUsageLock(token, async () => {
    const h = await toHash(token);
    const hits = await readUsageCount(env, h);
    if (limit !== null && hits >= limit) {
      const total = await totalForKey(env, USER_TOTAL_PREFIX + h);
      return { allowed: false, hits, total };
    }
    await env.QPROXY_KV.put(usageKey(h), JSON.stringify(hits + 1));
    await bufferActivity(env, h, { requests: 1 });
    const total = await bumpUserTotal(env, h);
    return { allowed: true, hits: hits + 1, total };
  });
}

export async function getUserHits(env: StoreEnv, token: string): Promise<number> {
  const db = dbOf(env);
  if (db !== null) {
    try {
      return await getUserHitsD1(db, await toHash(token));
    } catch {
      return readUsageCount(env, await toHash(token));
    }
  }
  const h = await toHash(token);
  return readUsageCount(env, h);
}

export async function getUserTotalHits(env: StoreEnv, token: string): Promise<number> {
  const db = dbOf(env);
  if (db !== null) {
    try {
      return await getUserTotalHitsD1(db, await toHash(token));
    } catch {
      const h = await toHash(token);
      return totalForKey(env, USER_TOTAL_PREFIX + h);
    }
  }
  const h = await toHash(token);
  return totalForKey(env, USER_TOTAL_PREFIX + h);
}

function activityKey(day: string, hash: string): string {
  return USER_ACTIVITY_PREFIX + day + ":" + hash;
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function parseActivityValue(raw: unknown, day: string): UserActivityDay {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    return {
      day,
      requests: toNonNegativeInt(r.requests),
      bytesUp: toNonNegativeInt(r.bytesUp),
      bytesDown: toNonNegativeInt(r.bytesDown),
    };
  }
  if (typeof raw === "number") return { day, requests: toNonNegativeInt(raw), bytesUp: 0, bytesDown: 0 };
  return { day, requests: 0, bytesUp: 0, bytesDown: 0 };
}

const activityLocks = new Map<string, Promise<unknown>>();

function withActivityLock<T>(hash: string, fn: () => Promise<T>): Promise<T> {
  const key = "activity:" + hash;
  const prev = activityLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  activityLocks.set(key, next.catch(() => undefined));
  return next;
}

interface BufferedActivity {
  day: string;
  requests: number;
  bytesUp: number;
  bytesDown: number;
}

const ACTIVITY_FLUSH_MS = 60_000;
const ACTIVITY_FLUSH_HITS = 32;

const activityPending = new Map<string, BufferedActivity>();
let activityBufferedOps = 0;
let activityLastFlushMs = Date.now();
let activityFlushing = false;

export function clearUserActivityForTests(): void {
  activityPending.clear();
  activityBufferedOps = 0;
  activityLastFlushMs = Date.now();
  activityFlushing = false;
}

async function flushActivities(env: StoreEnv, captured: Map<string, BufferedActivity>): Promise<void> {
  if (captured.size === 0) return;
  try {
    const entries = [...captured.entries()];
    const raws = await Promise.all(entries.map(([key]) => env.QPROXY_KV.get(key, "json")));
    await Promise.all(
      entries.map(async ([key, delta], i) => {
        const current = parseActivityValue(raws[i], delta.day);
        await env.QPROXY_KV.put(
          key,
          JSON.stringify({
            day: delta.day,
            requests: current.requests + delta.requests,
            bytesUp: current.bytesUp + delta.bytesUp,
            bytesDown: current.bytesDown + delta.bytesDown,
          }),
        );
      }),
    );
  } catch {
    return;
  }
}

export async function flushPendingUserActivity(env: StoreEnv): Promise<void> {
  const captured = new Map(activityPending);
  activityPending.clear();
  await flushActivities(env, captured);
}

async function bufferActivity(env: StoreEnv, hash: string, delta: UserActivityDelta): Promise<UserActivityDay> {
  const day = dayKeyUtc();
  const key = activityKey(day, hash);
  const gained = {
    requests: toNonNegativeInt(delta.requests),
    bytesUp: toNonNegativeInt(delta.bytesUp),
    bytesDown: toNonNegativeInt(delta.bytesDown),
  };
  const stored = parseActivityValue(await env.QPROXY_KV.get(key, "json"), day);
  const prev = activityPending.get(key);
  if (gained.requests === 0 && gained.bytesUp === 0 && gained.bytesDown === 0) {
    return {
      day,
      requests: stored.requests + (prev?.requests ?? 0),
      bytesUp: stored.bytesUp + (prev?.bytesUp ?? 0),
      bytesDown: stored.bytesDown + (prev?.bytesDown ?? 0),
    };
  }
  const next: BufferedActivity = {
    day,
    requests: (prev?.requests ?? 0) + gained.requests,
    bytesUp: (prev?.bytesUp ?? 0) + gained.bytesUp,
    bytesDown: (prev?.bytesDown ?? 0) + gained.bytesDown,
  };
  activityPending.set(key, next);
  activityBufferedOps += 1;
  const merged: UserActivityDay = {
    day,
    requests: stored.requests + next.requests,
    bytesUp: stored.bytesUp + next.bytesUp,
    bytesDown: stored.bytesDown + next.bytesDown,
  };
  const stale = Date.now() - activityLastFlushMs >= ACTIVITY_FLUSH_MS;
  if (!stale && activityBufferedOps < ACTIVITY_FLUSH_HITS) return merged;
  if (activityFlushing) return merged;
  activityFlushing = true;
  activityBufferedOps = 0;
  activityLastFlushMs = Date.now();
  try {
    const captured = new Map(activityPending);
    activityPending.clear();
    await flushActivities(env, captured);
  } finally {
    activityFlushing = false;
  }
  return merged;
}

export async function recordUserActivity(
  env: StoreEnv,
  tokenOrHash: string,
  delta: UserActivityDelta,
): Promise<UserActivityDay> {
  const h = (await toHash(tokenOrHash)).toLowerCase();
  const db = dbOf(env);
  if (db !== null) {
    try {
      return await recordUserActivityD1(db, h, delta);
    } catch {
      return withActivityLock(h, () => bufferActivity(env, h, delta));
    }
  }
  return withActivityLock(h, () => bufferActivity(env, h, delta));
}

export async function getUserActivity(
  env: StoreEnv,
  tokenOrHash: string,
  days: number,
): Promise<UserActivityDay[]> {
  const h = (await toHash(tokenOrHash)).toLowerCase();
  const db = dbOf(env);
  if (db !== null) {
    try {
      return await getUserActivityD1(db, h, days);
    } catch {
      return getUserActivityKv(env, h, days);
    }
  }
  return getUserActivityKv(env, h, days);
}

async function getUserActivityKv(env: StoreEnv, h: string, days: number): Promise<UserActivityDay[]> {
  const count = Number.isFinite(days)
    ? Math.min(Math.max(Math.floor(days), 1), USER_ACTIVITY_MAX_DAYS)
    : USER_ACTIVITY_DEFAULT_DAYS;
  const now = Date.now();
  const labels: string[] = [];
  for (let i = count - 1; i >= 0; i--) labels.push(dayKeyUtc(new Date(now - i * 86400000)));
  const raws = await Promise.all(labels.map((day) => env.QPROXY_KV.get(activityKey(day, h), "json")));
  return labels.map((day, i) => {
    const stored = parseActivityValue(raws[i], day);
    const queued = activityPending.get(activityKey(day, h));
    if (queued === undefined) return stored;
    return {
      day,
      requests: stored.requests + queued.requests,
      bytesUp: stored.bytesUp + queued.bytesUp,
      bytesDown: stored.bytesDown + queued.bytesDown,
    };
  });
}

async function migrateActivityRows(env: StoreEnv, oldHash: string, newHash: string): Promise<void> {
  const now = Date.now();
  const labels: string[] = [];
  for (let i = 0; i < USER_ACTIVITY_MAX_DAYS; i++) labels.push(dayKeyUtc(new Date(now - i * 86400000)));
  await Promise.all(
    labels.map(async (day) => {
      const oldKey = activityKey(day, oldHash);
      const raw = await env.QPROXY_KV.get(oldKey, "json");
      if (raw === null || raw === undefined) return;
      const oldRow = parseActivityValue(raw, day);
      if (oldRow.requests > 0 || oldRow.bytesUp > 0 || oldRow.bytesDown > 0) {
        const newKey = activityKey(day, newHash);
        const current = parseActivityValue(await env.QPROXY_KV.get(newKey, "json"), day);
        await env.QPROXY_KV.put(
          newKey,
          JSON.stringify({
            day,
            requests: current.requests + oldRow.requests,
            bytesUp: current.bytesUp + oldRow.bytesUp,
            bytesDown: current.bytesDown + oldRow.bytesDown,
          }),
        );
      }
      await env.QPROXY_KV.delete(oldKey);
    }),
  );
}

export async function migrateUserUsage(
  env: StoreEnv,
  oldTokenOrHash: string,
  newTokenOrHash: string,
): Promise<void> {
  const oldHash = (await toHash(oldTokenOrHash)).toLowerCase();
  const newHash = (await toHash(newTokenOrHash)).toLowerCase();
  if (oldHash === newHash) return;
  const db = dbOf(env);
  if (db !== null) {
    try {
      await migrateUserUsageD1(db, oldHash, newHash);
      return;
    } catch {
      await migrateUserUsageKv(env, oldHash, newHash);
      return;
    }
  }
  await migrateUserUsageKv(env, oldHash, newHash);
}

async function migrateUserUsageKv(env: StoreEnv, oldHash: string, newHash: string): Promise<void> {
  await flushPendingUserTotals(env);
  await flushPendingUserActivity(env);
  totalMemo.delete(USER_TOTAL_PREFIX + oldHash);
  totalMemo.delete(USER_TOTAL_PREFIX + newHash);
  const oldCount = await readUsageCount(env, oldHash);
  await env.QPROXY_KV.delete(usageKey(oldHash));
  const rows = await readUsageRows(env);
  const remaining: UsageRow[] = [];
  for (const r of rows) {
    let rh: string | null = null;
    if (HASH_RE.test(r.token)) rh = r.token.toLowerCase();
    else if (isUuid(r.token)) rh = (await hashToken(r.token)).toLowerCase();
    else {
      remaining.push(r);
      continue;
    }
    if (rh !== oldHash) remaining.push(r);
  }
  if (remaining.length > 0) {
    await env.QPROXY_KV.put(legacyUsageKey(), JSON.stringify(remaining));
  } else {
    await env.QPROXY_KV.delete(legacyUsageKey()).catch(() => {});
  }
  if (oldCount > 0) {
    const newCount = await readUsageCount(env, newHash);
    await env.QPROXY_KV.put(usageKey(newHash), JSON.stringify(newCount + oldCount));
  }
  const oldTotalKey = USER_TOTAL_PREFIX + oldHash;
  const newTotalKey = USER_TOTAL_PREFIX + newHash;
  const oldRaw = await env.QPROXY_KV.get(oldTotalKey, "json");
  let oldTotal = 0;
  if (typeof oldRaw === "number" && Number.isFinite(oldRaw) && oldRaw >= 0) oldTotal = Math.floor(oldRaw);
  else if (typeof oldRaw === "string") {
    const n = Number(oldRaw);
    if (Number.isFinite(n) && n >= 0) oldTotal = Math.floor(n);
  }
  if (oldTotal > 0) {
    const newRaw = await env.QPROXY_KV.get(newTotalKey, "json");
    let newTotal = 0;
    if (typeof newRaw === "number" && Number.isFinite(newRaw) && newRaw >= 0) newTotal = Math.floor(newRaw);
    else if (typeof newRaw === "string") {
      const n = Number(newRaw);
      if (Number.isFinite(n) && n >= 0) newTotal = Math.floor(n);
    }
    await env.QPROXY_KV.put(newTotalKey, JSON.stringify(newTotal + oldTotal));
    await env.QPROXY_KV.delete(oldTotalKey);
    totalMemo.delete(newTotalKey);
  }
  await migrateActivityRows(env, oldHash, newHash);
}

async function listKvKeys(kv: StoreEnv["QPROXY_KV"], prefix: string): Promise<string[]> {
  if (kv.list === undefined) return [];
  const out: string[] = [];
  let cursor: string | undefined = undefined;
  for (let i = 0; i < 50; i++) {
    const page = await kv.list({ prefix, cursor });
    for (const k of page.keys) out.push(k.name);
    if (page.list_complete) return out;
    if (page.cursor === undefined) return out;
    cursor = page.cursor;
  }
  return out;
}

interface CopiedCounters {
  day: string;
  today: number;
  total: number;
  up: number;
  down: number;
}

function parseCountersBlob(raw: unknown): CopiedCounters | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.day !== "string" || !DAY_RE.test(r.day)) return null;
  if (typeof r.requestsTotal !== "number") return null;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  return { day: r.day, today: num(r.requestsToday), total: num(r.requestsTotal), up: num(r.bytesUpTotal), down: num(r.bytesDownTotal) };
}

async function copyLegacyKvToD1(env: StoreEnv, db: D1Database): Promise<string[] | null> {
  const kv = env.QPROXY_KV;
  await flushPendingUserTotals(env);
  await flushPendingUserActivity(env);
  let usageNames: string[];
  let totalNames: string[];
  let activityNames: string[];
  let usersRaw: unknown;
  let countersRaw: unknown;
  try {
    usageNames = await listKvKeys(kv, USER_USAGE_PREFIX);
    totalNames = await listKvKeys(kv, USER_TOTAL_PREFIX);
    activityNames = await listKvKeys(kv, USER_ACTIVITY_PREFIX);
    usersRaw = await kv.get(USERS_KEY, "json");
    countersRaw = await kv.get(COUNTERS_KV_KEY, "json");
  } catch {
    return null;
  }
  const deleteKeys = new Set<string>([USERS_KEY, COUNTERS_KV_KEY]);
  for (const k of [...usageNames, ...totalNames, ...activityNames]) deleteKeys.add(k);
  const totals = new Map<string, number>();
  for (const key of totalNames) {
    let raw: unknown = null;
    try {
      raw = await kv.get(key, "json");
    } catch {
      return null;
    }
    const hash = key.slice(USER_TOTAL_PREFIX.length).toLowerCase();
    const n = countValue(raw);
    if (HASH_RE.test(hash) && n > 0) totals.set(hash, n);
  }
  const today = dayKeyUtc();
  const usage = new Map<string, Map<string, number>>();
  const keyed = new Set<string>();
  const putUsage = (day: string, hash: string, hits: number, overwrite: boolean): void => {
    if (!DAY_RE.test(day) || !HASH_RE.test(hash) || hits <= 0) return;
    let byDay = usage.get(day);
    if (byDay === undefined) {
      byDay = new Map<string, number>();
      usage.set(day, byDay);
    }
    if (overwrite || byDay.get(hash) === undefined) byDay.set(hash, Math.max(byDay.get(hash) ?? 0, hits));
  };
  for (const key of usageNames) {
    const rest = key.slice(USER_USAGE_PREFIX.length);
    const parts = rest.split(":");
    if (parts.length === 2 && DAY_RE.test(parts[0]!) && HASH_RE.test(parts[1]!)) {
      let raw: unknown = null;
      try {
        raw = await kv.get(key, "json");
      } catch {
        return null;
      }
      const hash = parts[1]!.toLowerCase();
      putUsage(parts[0]!, hash, countValue(raw), true);
      keyed.add(parts[0]! + ":" + hash);
    }
  }
  for (const key of usageNames) {
    const rest = key.slice(USER_USAGE_PREFIX.length);
    const parts = rest.split(":");
    if (parts.length !== 1 || !DAY_RE.test(parts[0]!)) continue;
    let raw: unknown = null;
    try {
      raw = await kv.get(key, "json");
    } catch {
      return null;
    }
    if (!Array.isArray(raw)) continue;
    for (const row of raw) {
      if (row === null || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.token !== "string" || typeof r.count !== "number") continue;
      const hash = (await toHash(r.token)).toLowerCase();
      if (!HASH_RE.test(hash) || keyed.has(parts[0]! + ":" + hash)) continue;
      putUsage(parts[0]!, hash, Math.floor(r.count), false);
    }
  }
  const users: UserAccount[] = [];
  if (Array.isArray(usersRaw)) {
    for (const entry of usersRaw) {
      if (isUser(entry)) {
        users.push(sanitizeStoredUser(entry));
        continue;
      }
      if (isLegacyUser(entry)) {
        users.push(await legacyRowToUser(entry as Record<string, unknown>));
        continue;
      }
    }
  }
  const userHashes = new Set(users.map((u) => u.tokenHash.toLowerCase()));
  const stmts: D1PreparedStatement[] = [];
  for (const u of users) {
    stmts.push(
      db.prepare(`INSERT OR REPLACE INTO users(${USER_COLUMNS}) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...userBind(u)),
    );
    const total = Math.max(totals.get(u.tokenHash.toLowerCase()) ?? 0, usage.get(today)?.get(u.tokenHash.toLowerCase()) ?? 0);
    if (total > 0) {
      stmts.push(
        db.prepare("INSERT OR REPLACE INTO user_totals(token_hash, total) VALUES(?, ?)").bind(u.tokenHash.toLowerCase(), total),
      );
    }
  }
  for (const [hash, total] of totals) {
    if (!userHashes.has(hash)) {
      stmts.push(db.prepare("INSERT OR REPLACE INTO user_totals(token_hash, total) VALUES(?, ?)").bind(hash, total));
    }
  }
  for (const [day, byDay] of usage) {
    for (const [hash, hits] of byDay) {
      stmts.push(db.prepare("INSERT OR REPLACE INTO user_usage(day, token_hash, hits) VALUES(?, ?, ?)").bind(day, hash, hits));
    }
  }
  for (const key of activityNames) {
    const rest = key.slice(USER_ACTIVITY_PREFIX.length);
    const parts = rest.split(":");
    if (parts.length !== 2 || !DAY_RE.test(parts[0]!) || !HASH_RE.test(parts[1]!)) continue;
    let raw: unknown = null;
    try {
      raw = await kv.get(key, "json");
    } catch {
      return null;
    }
    const row = parseActivityValue(raw, parts[0]!);
    if (row.requests === 0 && row.bytesUp === 0 && row.bytesDown === 0) continue;
    stmts.push(
      db
        .prepare("INSERT OR REPLACE INTO user_activity(day, token_hash, requests, bytes_up, bytes_down) VALUES(?, ?, ?, ?, ?)")
        .bind(row.day, parts[1]!.toLowerCase(), row.requests, row.bytesUp, row.bytesDown),
    );
  }
  const counters = parseCountersBlob(countersRaw);
  if (counters !== null) {
    stmts.push(
      db
        .prepare("INSERT OR REPLACE INTO counters(id, day, requests_today, requests_total, bytes_up, bytes_down) VALUES(1, ?, ?, ?, ?, ?)")
        .bind(counters.day, counters.today, counters.total, counters.up, counters.down),
    );
  }
  if (stmts.length > 0) {
    try {
      await db.batch(stmts);
    } catch {
      return null;
    }
  }
  return [...deleteKeys];
}

export async function bootstrapD1(env: StoreEnv): Promise<void> {
  const db = dbOf(env);
  if (db === null) return;
  try {
    await ensureD1Schema(db);
    const guard = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(MIGRATION_GUARD_KEY).first<{ value: string }>();
    if (guard !== null) return;
    const counts = await db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM users"),
      db.prepare("SELECT COUNT(*) AS n FROM user_usage"),
      db.prepare("SELECT COUNT(*) AS n FROM user_activity"),
      db.prepare("SELECT COUNT(*) AS n FROM user_totals"),
      db.prepare("SELECT COUNT(*) AS n FROM counters"),
    ]);
    if (counts.some((r) => batchCount(r) > 0)) {
      await db
        .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)")
        .bind(MIGRATION_GUARD_KEY, new Date().toISOString())
        .run();
      return;
    }
    const keys = await copyLegacyKvToD1(env, db);
    if (keys === null) return;
    await db
      .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)")
      .bind(MIGRATION_GUARD_KEY, new Date().toISOString())
      .run();
    await Promise.allSettled(keys.map((k) => env.QPROXY_KV.delete(k)));
  } catch {
    return;
  }
}
