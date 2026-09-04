import type { Env } from "../types/env";
import type { Settings } from "../types/settings";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../types/settings";
import { migrateSettings } from "./migrate";
import { bootstrapD1 } from "../users/store";
import { fillIdentity, hasIdentity } from "./seed";
import { validateSettings } from "./validate";

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
