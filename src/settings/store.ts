import type { Settings } from "../types/settings";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../types/settings";
import { migrateSettings } from "./migrate";
import { fillIdentity, hasIdentity } from "./seed";
import { validateSettings } from "./validate";
import { log } from "../core/log";

const D1_CORE_SCHEMA = `CREATE TABLE IF NOT EXISTS counters (
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
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
`;

export async function ensureD1Schema(db: D1Database): Promise<void> {
  const parts = D1_CORE_SCHEMA.split(";")
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

async function bootstrapD1(env: Env): Promise<void> {  const db = env.QPROXY_DB;
  if (db === undefined || db === null) return;
  try {
    const parts = D1_CORE_SCHEMA.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const part of parts) {
      try {
        await db.prepare(part).run();
      } catch {
        await db.exec(part);
      }
    }
  } catch {
    return;
  }
}

export const SETTINGS_KEY = "qproxy:settings";
export const META_KEY = "qproxy:meta";

const CACHE_TTL_MS = 60_000;
const KV_CACHE_TTL = 60;

function cloneSettings(s: Settings): Settings {
  return structuredClone(s);
}

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
}

interface CacheEntry {
  value: Settings;
  updatedAt: number;
  rev: number;
  expiresAt: number;
}

interface StoredBlob {
  version: number;
  updatedAt?: number;
  rev?: number;
  data?: unknown;
}

let cache: CacheEntry | null = null;
let loadedDebug = false;

export function currentDebugEnabled(): boolean {
  return loadedDebug;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

function remember(value: Settings, updatedAt: number, rev: number): void {
  loadedDebug = value.debugLogging;
  cache = { value, updatedAt, rev, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function settingsEtag(): string | null {
  if (cache === null) return null;
  return `W/"${cache.updatedAt}-${SETTINGS_VERSION}"`;
}

async function persist(env: Env, value: Settings, updatedAt: number, rev: number): Promise<void> {
  const blob: StoredBlob = {
    version: SETTINGS_VERSION,
    updatedAt,
    rev,
    data: value,
  };
  const json = JSON.stringify(blob);
  await env.QPROXY_KV.put(SETTINGS_KEY, json);
}

function blobUpdatedAt(raw: unknown): number {
  if (raw !== null && typeof raw === "object") {
    const v = (raw as Record<string, unknown>).updatedAt;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return Date.now();
}

function blobRev(raw: unknown): number {
  if (raw !== null && typeof raw === "object") {
    const v = (raw as Record<string, unknown>).rev;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  }
  return 0;
}

function blobVersion(raw: unknown): number | null {
  if (raw !== null && typeof raw === "object") {
    const v = (raw as Record<string, unknown>).version;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

const USER_DATA_KV_PREFIXES = ["qproxy:user-usage:", "qproxy:user-total:", "qproxy:user-activity:"] as const;

async function purgePreCutUserData(env: Env): Promise<string> {
  const removed: string[] = [];
  try {
    await env.QPROXY_KV.delete("qproxy:users");
    removed.push("qproxy:users");
  } catch {
    return removed.join(", ");
  }
  for (const prefix of USER_DATA_KV_PREFIXES) {
    try {
      let cursor: string | undefined = undefined;
      for (let i = 0; i < 50; i++) {
        const page: { keys: Array<{ name: string }>; list_complete: boolean; cursor?: string } =
          await env.QPROXY_KV.list({ prefix, cursor });
        await Promise.allSettled(page.keys.map((k: { name: string }) => env.QPROXY_KV.delete(k.name)));
        if (page.list_complete || page.cursor === undefined) break;
        cursor = page.cursor;
      }
      removed.push(`${prefix}*`);
    } catch {
      break;
    }
  }
  try {
    await env.QPROXY_DB.batch([
      env.QPROXY_DB.prepare("DROP TABLE IF EXISTS users"),
      env.QPROXY_DB.prepare("DROP TABLE IF EXISTS user_totals"),
      env.QPROXY_DB.prepare("DROP TABLE IF EXISTS user_usage"),
      env.QPROXY_DB.prepare("DROP TABLE IF EXISTS user_activity"),
    ]);
    removed.push("d1:users,user_totals,user_usage,user_activity");
  } catch {
    /* fail-open: KV purge already applied */
  }
  return removed.join(", ");
}

async function maybePurgePreCut(env: Env, raw: unknown, next: Settings): Promise<Settings> {
  const v = blobVersion(raw);
  if (v === null || v >= SETTINGS_VERSION) return next;
  const what = await purgePreCutUserData(env);
  log.info("settings/store", `purged pre-cut user data (${what})`);
  const stamped = cloneSettings(next);
  stamped.version = SETTINGS_VERSION;
  await persist(env, stamped, Date.now(), blobRev(raw));
  invalidateSettingsCache();
  remember(stamped, Date.now(), blobRev(raw));
  return stamped;
}

async function readRawBlob(env: Env): Promise<unknown> {
  return (await env.QPROXY_KV.get(SETTINGS_KEY, {
    type: "json",
    cacheTtl: KV_CACHE_TTL,
  })) as unknown;
}

export async function loadSettings(env: Env): Promise<Settings> {
  if (cache !== null && cache.expiresAt > Date.now()) return cache.value;
  const raw = await readRawBlob(env);
  let next = migrateSettings(raw);
  const v = validateSettings(next);
  if (!v.ok) next = structuredClone(DEFAULT_SETTINGS);
  else next = v.value;
  const updatedAt = blobUpdatedAt(raw);
  const rev = blobRev(raw);
  next = await maybePurgePreCut(env, raw, next);
  if (!hasIdentity(next)) {
    next = fillIdentity(next);
    await persist(env, next, updatedAt, rev);
  }
  remember(next, updatedAt, rev);
  return next;
}

export async function loadSettingsFresh(env: Env): Promise<Settings> {
  const raw = await readRawBlob(env);
  let next = migrateSettings(raw);
  const v2 = validateSettings(next);
  if (!v2.ok) next = structuredClone(DEFAULT_SETTINGS);
  else next = v2.value;
  next = await maybePurgePreCut(env, raw, next);
  if (!hasIdentity(next)) {
    next = fillIdentity(next);
    await persist(env, next, Date.now(), blobRev(raw));
  }
  return next;
}

export async function saveSettings(env: Env, next: Settings): Promise<number> {
  const stamped: Settings = cloneSettings(next);
  stamped.version = SETTINGS_VERSION;
  const updatedAt = Date.now();
  const rev = blobRev(await readRawBlob(env)) + 1;
  await persist(env, stamped, updatedAt, rev);
  remember(stamped, updatedAt, rev);
  return rev;
}

let initPromise: Promise<void> | null = null;

async function doInitialize(env: Env): Promise<void> {
  try {
    const meta = (await env.QPROXY_KV.get(META_KEY, "json")) as unknown;
    if (meta === null || typeof meta !== "object") {
      await env.QPROXY_KV.put(
        META_KEY,
        JSON.stringify({ createdAt: Date.now(), installedVersion: appVersion() }),
      );
    }
    await bootstrapD1(env);
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

export function ensureInitialized(env: Env): Promise<void> {
  if (initPromise === null) initPromise = doInitialize(env);
  return initPromise;
}
