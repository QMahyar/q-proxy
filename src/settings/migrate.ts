import type { Settings } from "../types/settings";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../types/settings";
import { bracketIpv6, parseHostPort } from "../utils/net";
import { log } from "../core/log";

type PlainObject = Record<string, unknown>;
type MigrationStep = (data: unknown) => unknown;

export const MIGRATIONS: Record<number, MigrationStep> = {
  1: (data) => {
    if (!isPlainObject(data)) return data;
    const out: PlainObject = { ...data };
    const addresses: PlainObject[] = [];
    if (typeof data.hostnameOverride === "string" && data.hostnameOverride.trim().length > 0) {
      addresses.push({ address: data.hostnameOverride.trim() });
    }
    if (Array.isArray(data.customDomains)) {
      for (const d of data.customDomains) {
        if (typeof d === "string" && d.trim().length > 0) addresses.push({ address: d.trim() });
      }
    }
    if (Array.isArray(data.cleanIps)) {
      for (const raw of data.cleanIps) {
        if (typeof raw !== "string") continue;
        const hp = parseHostPort(raw.trim(), 0);
        if (hp === null || hp.host.length === 0) continue;
        const entry: PlainObject = { address: bracketIpv6(hp.host) };
        if (hp.port > 0) entry.port = hp.port;
        addresses.push(entry);
      }
    }
    const cdn = isPlainObject(data.cdn) ? data.cdn : null;
    if (cdn && cdn.enabled === true && Array.isArray(cdn.addresses)) {
      for (const a of cdn.addresses) {
        if (typeof a !== "string" || a.trim().length === 0) continue;
        const entry: PlainObject = { address: a.trim() };
        if (typeof cdn.host === "string" && cdn.host.trim().length > 0) entry.host = cdn.host.trim();
        if (typeof cdn.sni === "string" && cdn.sni.trim().length > 0) entry.sni = cdn.sni.trim();
        addresses.push(entry);
      }
    }
    if (addresses.length > 0) out.addresses = addresses;
    if (Array.isArray(data.tlsPorts) && data.tlsPorts.length > 0 && typeof data.tlsPorts[0] === "number") {
      out.defaultPort = data.tlsPorts[0];
    }
    delete out.hostnameOverride;
    delete out.customDomains;
    delete out.cleanIps;
    delete out.tlsPorts;
    delete out.plainPorts;
    delete out.plainPortPolicy;
    delete out.cdn;
    return out;
  },
};

export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeInto(target: PlainObject, patch: PlainObject, depth = 0): void {
  if (depth > 32) return;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value === undefined) continue;
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      mergeInto(current, value, depth + 1);
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
  const out = deepMergeDefaults(DEFAULT_SETTINGS, payload);
  out.version = SETTINGS_VERSION;
  return out;
}
