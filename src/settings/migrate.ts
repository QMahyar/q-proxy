import type { Settings } from "../types/settings";
import { CF_PLAIN_PORTS, CF_TLS_PORTS, DEFAULT_SETTINGS, SETTINGS_VERSION } from "../types/settings";
import { bracketIpv6, isIpLiteral, parseHostPort, HOSTNAME_RE } from "../utils/net";
import { parseUuid } from "../utils/uuid";
import { log } from "../core/log";

type PlainObject = Record<string, unknown>;
type MigrationStep = (data: unknown) => unknown;

export const MIGRATIONS: Record<number, MigrationStep> = {
  2: (data) => {
    if (!isPlainObject(data)) return data;
    const out: PlainObject = { ...data };
    for (const key of [
      "vmessEnabled",
      "trojanEnabled",
      "ssEnabled",
      "vmessUuid",
      "trojanPassword",
      "ssPassword",
      "ssMethod",
      "ssDirect",
      "vmessPath",
      "trojanPath",
      "ssPath",
      "proxyIpMode",
      "nat64Prefixes",
      "chainProxy",
      "remoteDns",
      "urlTestIntervalSec",
      "remoteNodes",
      "remoteSubUrls",
      "speedtestIntercept",
      "totp",
    ]) {
      delete out[key];
    }
    if (isPlainObject(out.camouflage)) {
      const camo: PlainObject = { ...(out.camouflage as PlainObject) };
      delete camo.url;
      if (camo.mode === "proxy") camo.mode = "static";
      out.camouflage = camo;
    }
    if (Array.isArray(out.addresses)) {
      const lines: string[] = [];
      for (const entry of out.addresses) {
        const line = addressEntryToLine(entry);
        if (line !== null) lines.push(line);
      }
      mergeCustomEndpointLines(out, lines);
    }
    delete out.addresses;
    return out;
  },
  1: (data) => {
    if (!isPlainObject(data)) return data;
    const out: PlainObject = { ...data };
    const lines: string[] = [];
    if (typeof data.hostnameOverride === "string" && data.hostnameOverride.trim().length > 0) {
      lines.push(data.hostnameOverride.trim());
    }
    if (Array.isArray(data.customDomains)) {
      for (const d of data.customDomains) {
        if (typeof d === "string" && d.trim().length > 0) lines.push(d.trim());
      }
    }
    if (Array.isArray(data.cleanIps)) {
      for (const raw of data.cleanIps) {
        if (typeof raw !== "string") continue;
        const hp = parseHostPort(raw.trim(), 0);
        if (hp === null || hp.host.length === 0) continue;
        lines.push(hp.port > 0 ? `${bracketIpv6(hp.host)}:${hp.port}` : bracketIpv6(hp.host));
      }
    }
    const cdn = isPlainObject(data.cdn) ? data.cdn : null;
    if (cdn && cdn.enabled === true && Array.isArray(cdn.addresses)) {
      for (const a of cdn.addresses) {
        if (typeof a !== "string" || a.trim().length === 0) continue;
        lines.push(a.trim());
      }
      if (
        typeof cdn.host === "string" &&
        cdn.host.trim().length > 0 &&
        cdn.host.trim().length <= 253 &&
        typeof out.cdnHost !== "string" &&
        HOSTNAME_RE.test(cdn.host.trim().toLowerCase())
      ) {
        out.cdnHost = cdn.host.trim().toLowerCase();
      }
      if (
        typeof cdn.sni === "string" &&
        cdn.sni.trim().length > 0 &&
        cdn.sni.trim().length <= 253 &&
        typeof out.cdnSni !== "string" &&
        HOSTNAME_RE.test(cdn.sni.trim().toLowerCase())
      ) {
        out.cdnSni = cdn.sni.trim().toLowerCase();
      }
    }
    mergeCustomEndpointLines(out, lines);
    const firstTls = Array.isArray(data.tlsPorts) && data.tlsPorts.length > 0 ? data.tlsPorts[0] : undefined;
    if (typeof firstTls === "number" && Number.isInteger(firstTls) && CF_TLS_PORTS_SET.has(firstTls)) {
      out.defaultPort = firstTls;
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

const CF_PORTS_SET = new Set<number>([...CF_TLS_PORTS, ...CF_PLAIN_PORTS]);
const CF_TLS_PORTS_SET = new Set<number>(CF_TLS_PORTS);
const CUSTOM_ENDPOINT_MAX = 64;

function customEndpointLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 253) return null;
  const hp = parseHostPort(trimmed, 0);
  if (hp === null || hp.host.length === 0) return null;
  const hostOk =
    isIpLiteral(hp.host) || (HOSTNAME_RE.test(hp.host) && hp.host.length <= 253 && !hp.host.includes(":"));
  if (!hostOk) return null;
  if (hp.port > 0 && !CF_PORTS_SET.has(hp.port)) return null;
  return trimmed;
}

function addressEntryToLine(entry: unknown): string | null {
  if (!isPlainObject(entry)) return null;
  if (entry.enabled === false) return null;
  if (typeof entry.address !== "string") return null;
  const address = entry.address.trim();
  if (address.length === 0) return null;
  const port = typeof entry.port === "number" && Number.isInteger(entry.port) ? entry.port : 0;
  return customEndpointLine(port > 0 ? `${address}:${port}` : address);
}

function mergeCustomEndpointLines(out: PlainObject, lines: string[]): void {
  const seen = new Set<string>();
  const merged: string[] = [];
  let dropped = 0;
  const push = (raw: string): void => {
    const line = customEndpointLine(raw);
    if (line === null) {
      dropped++;
      return;
    }
    if (seen.has(line)) return;
    seen.add(line);
    if (merged.length < CUSTOM_ENDPOINT_MAX) merged.push(line);
    else dropped++;
  };
  if (Array.isArray(out.customEndpoints)) {
    for (const raw of out.customEndpoints) {
      if (typeof raw === "string") push(raw);
    }
  }
  for (const line of lines) push(line);
  if (merged.length > 0) out.customEndpoints = merged;
  if (dropped > 0) log.info("settings/migrate", `dropped ${dropped} invalid custom endpoint lines`);
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

export function storedVlessUuid(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null;
  const data = isPlainObject(raw.data) ? raw.data : raw;
  return typeof data.vlessUuid === "string" ? data.vlessUuid : null;
}

export function migrateSettings(raw: unknown): Settings {
  if (!isPlainObject(raw)) return structuredClone(DEFAULT_SETTINGS);
  const version = raw.version;
  const numeric = typeof version === "number" && Number.isFinite(version);
  const startVersion = numeric ? Math.floor(version) : 0;
  let payload: unknown = storedPayload(raw);
  if (numeric && version > SETTINGS_VERSION) {
    log.info(
      "settings/migrate",
      `stored version ${version} newer than app ${SETTINGS_VERSION}; merging best-effort`,
    );
  } else if (!numeric || version < SETTINGS_VERSION) {
    let v = startVersion;
    while (v < SETTINGS_VERSION) {
      const step = MIGRATIONS[v];
      if (step) payload = step(payload);
      v += 1;
    }
  }
  const out = deepMergeDefaults(DEFAULT_SETTINGS, payload);
  out.version = SETTINGS_VERSION;
  if (out.vlessUuid.length > 0 && parseUuid(out.vlessUuid) === null) {
    log.info("settings/migrate", "regenerated malformed vlessUuid");
    out.vlessUuid = crypto.randomUUID();
  }
  if (typeof out.telegram.chatId === "string" && out.telegram.chatId.length > 0 && !/^-?\d{1,20}$/.test(out.telegram.chatId)) {
    log.info("settings/migrate", "cleared legacy @username telegram chatId (numeric ids only)");
    out.telegram.chatId = "";
  }
  return out;
}
