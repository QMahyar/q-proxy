import type { Env } from "../types/env";
import type { Settings } from "../types/settings";
import { SETTINGS_VERSION } from "../types/settings";
import { migrateSettings } from "./migrate";
import { fillIdentity, hasIdentity } from "./seed";

export const SETTINGS_KEY = "qproxy:settings";
export const META_KEY = "qproxy:meta";

const CACHE_TTL_MS = 15_000;

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
}

interface CacheEntry {
  value: Settings;
  expiresAt: number;
}

interface StoredBlob {
  version: number;
  updatedAt?: number;
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

function remember(value: Settings): void {
  loadedDebug = value.debugLogging;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

async function persist(env: Env, value: Settings): Promise<void> {
  const blob: StoredBlob = {
    version: SETTINGS_VERSION,
    updatedAt: Date.now(),
    data: value,
  };
  await env.QPROXY_KV.put(SETTINGS_KEY, JSON.stringify(blob));
}

export async function loadSettings(env: Env): Promise<Settings> {
  if (cache !== null && cache.expiresAt > Date.now()) return cache.value;
  const raw = (await env.QPROXY_KV.get(SETTINGS_KEY, "json")) as unknown;
  let next = migrateSettings(raw);
  if (!hasIdentity(next)) {
    next = fillIdentity(next);
    await persist(env, next);
  }
  remember(next);
  return next;
}

export async function loadSettingsFresh(env: Env): Promise<Settings> {
  const raw = (await env.QPROXY_KV.get(SETTINGS_KEY, "json")) as unknown;
  let next = migrateSettings(raw);
  if (!hasIdentity(next)) {
    next = fillIdentity(next);
    await persist(env, next);
  }
  return next;
}

export async function saveSettings(env: Env, next: Settings): Promise<void> {
  const stamped: Settings = structuredClone(next);
  stamped.version = SETTINGS_VERSION;
  await persist(env, stamped);
  invalidateSettingsCache();
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
