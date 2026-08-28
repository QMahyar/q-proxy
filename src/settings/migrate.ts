import type { Settings } from "../types/settings";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../types/settings";
import { log } from "../core/log";

type PlainObject = Record<string, unknown>;
type MigrationStep = (data: unknown) => unknown;

export const MIGRATIONS: Record<number, MigrationStep> = {};

export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeInto(target: PlainObject, patch: PlainObject): void {
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value === undefined) continue;
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      mergeInto(current, value);
    } else if (Object.hasOwn(target, key)) {
      target[key] = structuredClone(value) as unknown;
    }
  }
}

export function deepMergeDefaults<T extends object>(base: T, patch: unknown): T {
  const out = structuredClone(base) as T & PlainObject;
  if (isPlainObject(patch)) mergeInto(out, patch);
  return out;
}

function storedPayload(raw: PlainObject): unknown {
  const data = raw.data;
  return isPlainObject(data) ? data : raw;
}

export function migrateSettings(raw: unknown): Settings {
  if (!isPlainObject(raw)) return structuredClone(DEFAULT_SETTINGS);
  const version = raw.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  let payload: unknown = storedPayload(raw);
  if (version > SETTINGS_VERSION) {
    log.info(
      "settings/migrate",
      `stored version ${version} newer than app ${SETTINGS_VERSION}; merging best-effort`,
    );
  } else if (version < SETTINGS_VERSION) {
    let v = Math.floor(version);
    while (v < SETTINGS_VERSION) {
      const step = MIGRATIONS[v];
      if (step) payload = step(payload);
      v += 1;
    }
  }
  return deepMergeDefaults(DEFAULT_SETTINGS, payload);
}
