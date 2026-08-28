import type { Env } from "../types/env";
import type { Settings } from "../types/settings";
import { SETTINGS_VERSION } from "../types/settings";
import { migrateSettings } from "./migrate";
import { fillIdentity, hasIdentity } from "./seed";

export const SETTINGS_KEY = "qproxy:settings";
export const META_KEY = "qproxy:meta";

// 60s per-isolate memo + 60s KV cacheTtl: readers may see stale up to 60s after another isolate writes.
// Mutating handlers requiring TOCTOU safety must use loadSettingsFresh() before validate+save.
const CACHE_TTL_MS = 60_000;
const KV_CACHE_TTL = 60;

// JSON deep copy is safe for plain JSON-serializable Settings and cheaper than structuredClone.
function cloneSettings(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s));
}

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
}

interface CacheEntry {
  value: Settings;
  updatedAt: number;
  expiresAt: number;
}

interface StoredBlob {
  version: number;
  updatedAt?: number;
  data?: unknown;
}

// Per-isolate in-memory cache shared across requests; stale up to 60s (CACHE_TTL_MS).
// Kept intentionally; callers needing freshness use loadSettingsFresh().
let cache: CacheEntry | null = null;
let loadedDebug = false;
let lastWrittenJson: string | null = null;

export function currentDebugEnabled(): boolean {
  return loadedDebug;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

function remember(value: Settings, updatedAt: number): void {
  loadedDebug = value.debugLogging;
  cache = { value, updatedAt, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function settingsEtag(): string | null {
  if (cache === null) return null;
  return `W/"${cache.updatedAt}-${SETTINGS_VERSION}"`;
}

async function persist(env: Env, value: Settings, updatedAt: number): Promise<void> {
  const blob: StoredBlob = {
    version: SETTINGS_VERSION,
    updatedAt,
    data: value,
  };
  const json = JSON.stringify(blob);
  await env.QPROXY_KV.put(SETTINGS_KEY, json);
  lastWrittenJson = json;
}

function blobUpdatedAt(raw: unknown): number {
  if (raw !== null && typeof raw === "object") {
    const v = (raw as Record<string, unknown>).updatedAt;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return Date.now();
}

export async function loadSettings(env: Env): Promise<Settings> {
  if (cache !== null && cache.expiresAt > Date.now()) return cache.value;
  const raw = (await env.QPROXY_KV.get(SETTINGS_KEY, {
    type: "json",
    cacheTtl: KV_CACHE_TTL,
  })) as unknown;
  let next = migrateSettings(raw);
  const updatedAt = blobUpdatedAt(raw);
  if (!hasIdentity(next)) {
    next = fillIdentity(next);
    await persist(env, next, updatedAt);
  }
  remember(next, updatedAt);
  return next;
}

export async function loadSettingsFresh(env: Env): Promise<Settings> {
  const raw = (await env.QPROXY_KV.get(SETTINGS_KEY, {
    type: "json",
    cacheTtl: KV_CACHE_TTL,
  })) as unknown;
  let next = migrateSettings(raw);
  if (!hasIdentity(next)) {
    next = fillIdentity(next);
    await persist(env, next, Date.now());
  }
  return next;
}

export async function saveSettings(env: Env, next: Settings): Promise<void> {
  const stamped: Settings = cloneSettings(next);
  stamped.version = SETTINGS_VERSION;
  const updatedAt = Date.now();
  const blob: StoredBlob = { version: SETTINGS_VERSION, updatedAt, data: stamped };
  const json = JSON.stringify(blob);
  if (lastWrittenJson !== null && stripTimestamp(json) === stripTimestamp(lastWrittenJson)) {
    if (cache === null || cache.expiresAt <= Date.now()) remember(stamped, updatedAt);
    return;
  }
  await persist(env, stamped, updatedAt);
  remember(stamped, updatedAt);
}

function stripTimestamp(json: string): string {
  return json.replace(/"updatedAt":\d+,/, "");
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
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

export function ensureInitialized(env: Env): Promise<void> {
  if (initPromise === null) initPromise = doInitialize(env);
  return initPromise;
}
