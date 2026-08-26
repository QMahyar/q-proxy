import type {
  RoutingRules,
  CamouflageMode,
  Fingerprint,
  FragmentMode,
  Language,
  PlainPortPolicy,
  SsMethod,
  Settings,
} from "../types/settings";
import { CF_PLAIN_PORTS, CF_TLS_PORTS, DEFAULT_SETTINGS } from "../types/settings";
import { isPlainObject } from "./migrate";
import { isIPv4, isIPv6, parseHostPort } from "../utils/net";

export type ValidationResult =
  | { ok: true; value: Settings }
  | { ok: false; fields: Record<string, string> };

const CF_TLS_PORT_LIST: readonly number[] = CF_TLS_PORTS;
const CF_PLAIN_PORT_LIST: readonly number[] = CF_PLAIN_PORTS;
const KNOWN_ALPN = ["h2", "http/1.1", "h3"];

const LANGUAGES: readonly Language[] = ["en", "fa"];
const SS_METHODS: readonly SsMethod[] = ["aes-128-gcm", "aes-256-gcm"];
const PLAIN_PORT_POLICIES: readonly PlainPortPolicy[] = ["always", "workers-dev", "never"];
const PROXY_IP_MODES = ["proxyip", "nat64"] as const;
const CAMOUFLAGE_MODES: readonly CamouflageMode[] = ["off", "static", "proxy"];
const FRAGMENT_MODES: readonly FragmentMode[] = ["off", "low", "medium", "high", "severe", "custom"];
const FRAGMENT_PACKETS = ["tlshello", "1-1", "1-2", "1-3", "1-5"] as const;
const FINGERPRINTS: readonly Fingerprint[] = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
  "randomized",
];

const HOSTNAME_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const TG_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{35}$/;
const TG_CHAT_ID_RE = /^(?:@[A-Za-z0-9_]{4,64}|-?\d{1,20})?$/;
const PATH_TOKEN_RE = /^[A-Za-z0-9_-]{1,32}$/;
const SECURE_PATH_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_TOKEN_RE = /^[A-Za-z0-9._:-]{1,253}$/;
const NAT64_PREFIX_RE = /^[0-9A-Fa-f:\[\]\/]{2,50}$/;

function fail(fields: Record<string, string>, key: string, msg: string): void {
  if (!(key in fields)) fields[key] = msg;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function validHostnameOrEmpty(value: string): boolean {
  return value.length === 0 || (HOSTNAME_RE.test(value) && value.length <= 253);
}

function boolField(
  patch: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
): boolean | undefined {
  const v = patch[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") {
    fail(fields, key, "must be a boolean");
    return undefined;
  }
  return v;
}

function intField(
  patch: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
  min: number,
  max: number,
): number | undefined {
  const v = patch[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    fail(fields, key, `must be an integer between ${min} and ${max}`);
    return undefined;
  }
  return v;
}

function enumField<T extends string>(
  patch: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
  allowed: readonly T[],
): T | undefined {
  const v = patch[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    fail(fields, key, `must be one of ${allowed.join(", ")}`);
    return undefined;
  }
  return v as T;
}

function strField(
  patch: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
  opts: { maxLen: number; minLen?: number; pattern?: RegExp; msg?: string },
): string | undefined {
  const v = patch[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    fail(fields, key, "must be a string");
    return undefined;
  }
  if (opts.minLen !== undefined && v.length < opts.minLen) {
    fail(fields, key, opts.msg ?? `must be at least ${opts.minLen} characters`);
    return undefined;
  }
  if (v.length > opts.maxLen) {
    fail(fields, key, `must be at most ${opts.maxLen} characters`);
    return undefined;
  }
  if (opts.pattern && !opts.pattern.test(v)) {
    fail(fields, key, opts.msg ?? "has an invalid format");
    return undefined;
  }
  return v;
}

function nullableStrField(
  patch: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
  maxLen: number,
): string | null | undefined {
  const v = patch[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") {
    fail(fields, key, "must be a string or null");
    return undefined;
  }
  if (v.length > maxLen) {
    fail(fields, key, `must be at most ${maxLen} characters`);
    return undefined;
  }
  return v;
}

interface StrArrayOpts {
  maxItems: number;
  itemMaxLen?: number;
  pattern?: RegExp;
  lowerCase?: boolean;
}

function sanitizeStrArray(input: unknown, opts: StrArrayOpts): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    let item = raw.trim();
    if (item.length === 0) continue;
    if (opts.lowerCase) item = item.toLowerCase();
    if (seen.has(item)) continue;
    if (item.length > (opts.itemMaxLen ?? 253)) continue;
    if (opts.pattern && !opts.pattern.test(item)) continue;
    seen.add(item);
    if (seen.size >= opts.maxItems) break;
  }
  return [...seen];
}

function strArrayField(
  patch: Record<string, unknown>,
  out: Settings,
  key: keyof Settings & string,
  fields: Record<string, string>,
  opts: StrArrayOpts,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of strings");
    return;
  }
  (out as unknown as Record<string, unknown>)[key] = sanitizeStrArray(v, opts);
}

function portListField(
  patch: Record<string, unknown>,
  key: string,
  allowed: readonly number[],
  fields: Record<string, string>,
): number[] | undefined {
  const v = patch[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > allowed.length) {
    fail(fields, key, `must be an array with at most ${allowed.length} ports`);
    return undefined;
  }
  const seen = new Set<number>();
  for (const entry of v) {
    if (typeof entry !== "number" || !Number.isInteger(entry)) {
      fail(fields, key, "ports must be integers");
      return undefined;
    }
    if (!allowed.includes(entry)) {
      fail(fields, key, `port ${entry} is not a Cloudflare-proxied port`);
      return undefined;
    }
    seen.add(entry);
  }
  return [...seen];
}

function urlListField(
  patch: Record<string, unknown>,
  out: Settings,
  key: string,
  fields: Record<string, string>,
  maxItems: number,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of strings");
    return;
  }
  for (const raw of v) {
    if (typeof raw !== "string") {
      fail(fields, key, "entries must be strings");
      return;
    }
  }
  const cleaned = sanitizeStrArray(v, { maxItems });
  for (const item of cleaned) {
    if (!isHttpUrl(item)) {
      fail(fields, key, `"${item}" is not a valid http(s) URL`);
      return;
    }
  }
  (out as unknown as Record<string, unknown>)[key] = cleaned;
}

export function normalizeCleanAddress(raw: string): string | null {
  const hp = parseHostPort(raw.trim(), 0);
  if (hp === null || hp.host.length === 0) return null;
  const host = hp.host.toLowerCase();
  const isAddr = isIPv4(host) || isIPv6(host);
  const looksDomain = host.includes(".") && /^[a-z0-9.-]+$/.test(host) && !host.startsWith(".") && !host.endsWith("-");
  if (!isAddr && !looksDomain) return null;
  const display = isIPv6(host) ? `[${host}]` : host;
  return hp.port > 0 ? `${display}:${hp.port}` : display;
}

function cleanAddrListField(
  patch: Record<string, unknown>,
  out: Settings,
  key: string,
  fields: Record<string, string>,
  maxItems: number,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of strings");
    return;
  }
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const norm = normalizeCleanAddress(raw);
    if (norm === null || seen.has(norm)) continue;
    seen.add(norm);
    if (seen.size >= maxItems) break;
  }
  (out as unknown as Record<string, unknown>)[key] = [...seen];
}

function validateNested(
  patch: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
  fn: (sub: Record<string, unknown>, f: Record<string, string>) => void,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!isPlainObject(v)) {
    fail(fields, key, "must be an object");
    return;
  }
  const f: Record<string, string> = {};
  fn(v, f);
  for (const [subKey, msg] of Object.entries(f)) {
    fail(fields, `${key}.${subKey}`, msg);
  }
}

export function validateSettings(input: unknown): ValidationResult {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!isPlainObject(input)) {
    return { ok: false, fields: { settings: "must be an object" } };
  }
  const patch = input;
  const fields: Record<string, string> = {};

  let v = strField(patch, "securePath", fields, { maxLen: 64, minLen: 1, pattern: SECURE_PATH_RE });
  if (v !== undefined) out.securePath = v;
  const passwordHash = nullableStrField(patch, "passwordHash", fields, 512);
  if (passwordHash !== undefined) out.passwordHash = passwordHash;
  const passwordSalt = nullableStrField(patch, "passwordSalt", fields, 128);
  if (passwordSalt !== undefined) out.passwordSalt = passwordSalt;
  v = strField(patch, "sessionSecret", fields, { maxLen: 512 });
  if (v !== undefined) out.sessionSecret = v;
  const language = enumField(patch, "language", fields, LANGUAGES);
  if (language !== undefined) out.language = language;
  const debugLogging = boolField(patch, "debugLogging", fields);
  if (debugLogging !== undefined) out.debugLogging = debugLogging;
  const vlessEnabled = boolField(patch, "vlessEnabled", fields);
  if (vlessEnabled !== undefined) out.vlessEnabled = vlessEnabled;
  const vmessEnabled = boolField(patch, "vmessEnabled", fields);
  if (vmessEnabled !== undefined) out.vmessEnabled = vmessEnabled;
  const trojanEnabled = boolField(patch, "trojanEnabled", fields);
  if (trojanEnabled !== undefined) out.trojanEnabled = trojanEnabled;
  const ssEnabled = boolField(patch, "ssEnabled", fields);
  if (ssEnabled !== undefined) out.ssEnabled = ssEnabled;
  v = strField(patch, "vlessUuid", fields, { maxLen: 64 });
  if (v !== undefined) out.vlessUuid = v;
  v = strField(patch, "vmessUuid", fields, { maxLen: 64 });
  if (v !== undefined) out.vmessUuid = v;
  v = strField(patch, "trojanPassword", fields, { maxLen: 128 });
  if (v !== undefined) out.trojanPassword = v;
  v = strField(patch, "ssPassword", fields, { maxLen: 128 });
  if (v !== undefined) out.ssPassword = v;
  const ssMethod = enumField(patch, "ssMethod", fields, SS_METHODS);
  if (ssMethod !== undefined) out.ssMethod = ssMethod;
  for (const p of ["vlessPath", "vmessPath", "trojanPath", "ssPath"] as const) {
    const pv = strField(patch, p, fields, { maxLen: 32, minLen: 1, pattern: PATH_TOKEN_RE });
    if (pv !== undefined) out[p] = pv;
  }
  const earlyDataEnabled = boolField(patch, "earlyDataEnabled", fields);
  if (earlyDataEnabled !== undefined) out.earlyDataEnabled = earlyDataEnabled;
  const earlyDataMaxBytes = intField(patch, "earlyDataMaxBytes", fields, 0, 8192);
  if (earlyDataMaxBytes !== undefined) out.earlyDataMaxBytes = earlyDataMaxBytes;
  v = strField(patch, "hostnameOverride", fields, { maxLen: 253 });
  if (v !== undefined && !validHostnameOrEmpty(v)) fail(fields, "hostnameOverride", "must be a hostname");
  else if (v !== undefined) out.hostnameOverride = v;
  strArrayField(patch, out, "customDomains", fields, { maxItems: 16, pattern: HOSTNAME_RE });
  cleanAddrListField(patch, out, "cleanIps", fields, 64);
  const tlsPorts = portListField(patch, "tlsPorts", CF_TLS_PORT_LIST, fields);
  if (tlsPorts !== undefined) out.tlsPorts = tlsPorts;
  const plainPorts = portListField(patch, "plainPorts", CF_PLAIN_PORT_LIST, fields);
  if (plainPorts !== undefined) out.plainPorts = plainPorts;
  const overlap = out.tlsPorts.filter((p) => out.plainPorts.includes(p));
  if (overlap.length > 0) {
    fail(fields, "tlsPorts", `ports overlap plainPorts: ${overlap.join(", ")}`);
    fail(fields, "plainPorts", `ports overlap tlsPorts: ${overlap.join(", ")}`);
  }
  if (out.tlsPorts.length === 0) {
    fail(fields, "tlsPorts", "select at least one TLS port — otherwise no configurations can be generated");
  }
  const plainPortPolicy = enumField(patch, "plainPortPolicy", fields, PLAIN_PORT_POLICIES);
  if (plainPortPolicy !== undefined) out.plainPortPolicy = plainPortPolicy;
  const fingerprint = enumField(patch, "fingerprint", fields, FINGERPRINTS);
  if (fingerprint !== undefined) out.fingerprint = fingerprint;
  const randomizeSniCase = boolField(patch, "randomizeSniCase", fields);
  if (randomizeSniCase !== undefined) out.randomizeSniCase = randomizeSniCase;
  const echEnabled = boolField(patch, "echEnabled", fields);
  if (echEnabled !== undefined) out.echEnabled = echEnabled;
  const echServerName = strField(patch, "echServerName", fields, { maxLen: 253 });
  if (echServerName !== undefined) {
    const trimmed = echServerName.trim();
    if (trimmed.length > 0 && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(trimmed)) fail(fields, "echServerName", "must be a domain name");
    else out.echServerName = trimmed;
  }
  const alpnV = patch["alpn"];
  if (alpnV !== undefined) {
    if (!Array.isArray(alpnV)) fail(fields, "alpn", "must be an array of strings");
    else {
      const cleaned = sanitizeStrArray(alpnV, { maxItems: 8, itemMaxLen: 32, lowerCase: true });
      const bad = cleaned.find((t) => !KNOWN_ALPN.includes(t));
      if (bad !== undefined) fail(fields, "alpn", `"${bad}" is not a supported ALPN token`);
      else out.alpn = cleaned;
    }
  }
  validateNested(patch, "cdn", fields, (sub, f) => {
    const enabled = boolField(sub, "enabled", f);
    if (enabled !== undefined) out.cdn.enabled = enabled;
    const addresses = sub["addresses"];
    if (addresses !== undefined) {
      if (!Array.isArray(addresses)) fail(f, "addresses", "must be an array of strings");
      else out.cdn.addresses = sanitizeStrArray(addresses, { maxItems: 16, pattern: HOST_TOKEN_RE });
    }
    const host = strField(sub, "host", f, { maxLen: 253 });
    if (host !== undefined && !validHostnameOrEmpty(host)) fail(f, "host", "must be a hostname");
    else if (host !== undefined) out.cdn.host = host;
    const sni = strField(sub, "sni", f, { maxLen: 253 });
    if (sni !== undefined && !validHostnameOrEmpty(sni)) fail(f, "sni", "must be a hostname");
    else if (sni !== undefined) out.cdn.sni = sni;
  });

  validateNested(patch, "fragment", fields, (sub, f) => {
    const mode = enumField(sub, "mode", f, FRAGMENT_MODES);
    if (mode !== undefined) out.fragment.mode = mode;
    const packets = enumField(sub, "packets", f, FRAGMENT_PACKETS);
    if (packets !== undefined) out.fragment.packets = packets;
    out.fragment.lengthMin = intField(sub, "lengthMin", f, 1, 1500) ?? out.fragment.lengthMin;
    out.fragment.lengthMax = intField(sub, "lengthMax", f, 1, 1500) ?? out.fragment.lengthMax;
    out.fragment.delayMin = intField(sub, "delayMin", f, 0, 10_000) ?? out.fragment.delayMin;
    out.fragment.delayMax = intField(sub, "delayMax", f, 0, 10_000) ?? out.fragment.delayMax;
    out.fragment.maxSplitMin = intField(sub, "maxSplitMin", f, 1, 100) ?? out.fragment.maxSplitMin;
    out.fragment.maxSplitMax = intField(sub, "maxSplitMax", f, 1, 100) ?? out.fragment.maxSplitMax;
    if (out.fragment.lengthMin > out.fragment.lengthMax)
      fail(f, "lengthMin", "lengthMin must be <= lengthMax");
    if (out.fragment.delayMin > out.fragment.delayMax)
      fail(f, "delayMin", "delayMin must be <= delayMax");
    if (out.fragment.maxSplitMin > out.fragment.maxSplitMax)
      fail(f, "maxSplitMin", "maxSplitMin must be <= maxSplitMax");
  });
  const proxyIpMode = enumField(patch, "proxyIpMode", fields, PROXY_IP_MODES);
  if (proxyIpMode !== undefined) out.proxyIpMode = proxyIpMode;
  strArrayField(patch, out, "proxyIps", fields, { maxItems: 64, pattern: HOST_TOKEN_RE });
  strArrayField(patch, out, "nat64Prefixes", fields, {
    maxItems: 8,
    itemMaxLen: 50,
    pattern: NAT64_PREFIX_RE,
  });
  validateNested(patch, "chainProxy", fields, (sub, f) => {
    const enabled = boolField(sub, "enabled", f);
    if (enabled !== undefined) out.chainProxy.enabled = enabled;
    const uri = strField(sub, "uri", f, { maxLen: 2048 });
    if (uri !== undefined) out.chainProxy.uri = uri;
    if (out.chainProxy.enabled) {
      let parsedOk = false;
      try {
        const parsed = new URL(out.chainProxy.uri);
        parsedOk =
          (parsed.protocol === "socks5:" || parsed.protocol === "http:") &&
          parsed.hostname.length > 0;
      } catch {
        parsedOk = false;
      }
      if (!parsedOk) fail(f, "uri", "must be a socks5:// or http:// proxy URI");
    }
  });
  const enableUdp53 = boolField(patch, "enableUdp53", fields);
  if (enableUdp53 !== undefined) out.enableUdp53 = enableUdp53;
  v = strField(patch, "dohUpstream", fields, { maxLen: 253 });
  if (v !== undefined && !isHttpUrl(v)) fail(fields, "dohUpstream", "must be a valid http(s) URL");
  else if (v !== undefined) out.dohUpstream = v;
  v = strField(patch, "remoteDns", fields, { maxLen: 253, minLen: 1 });
  if (v !== undefined) {
    if (isHttpUrl(v)) out.remoteDns = v;
    else if (HOST_TOKEN_RE.test(v)) out.remoteDns = `https://${v}/dns-query`;
    else fail(fields, "remoteDns", "must be a URL or IP/hostname");
  }
  v = strField(patch, "localDns", fields, { maxLen: 253, minLen: 1 });
  if (v !== undefined) out.localDns = v;
  const urlTestIntervalSec = intField(patch, "urlTestIntervalSec", fields, 60, 86_400);
  if (urlTestIntervalSec !== undefined) out.urlTestIntervalSec = urlTestIntervalSec;
  v = strField(patch, "profileTitle", fields, { maxLen: 64 });
  if (v !== undefined) out.profileTitle = v.trim();
  const subUpdateIntervalHours = intField(patch, "subUpdateIntervalHours", fields, 1, 168);
  if (subUpdateIntervalHours !== undefined) out.subUpdateIntervalHours = subUpdateIntervalHours;
  const maxNodesPerFormat = intField(patch, "maxNodesPerFormat", fields, 1, 2000);
  if (maxNodesPerFormat !== undefined) out.maxNodesPerFormat = maxNodesPerFormat;
  urlListField(patch, out, "remoteSubUrls", fields, 16);
  const killSwitch = boolField(patch, "killSwitch", fields);
  if (killSwitch !== undefined) out.killSwitch = killSwitch;
  const speedtestIntercept = boolField(patch, "speedtestIntercept", fields);
  if (speedtestIntercept !== undefined) out.speedtestIntercept = speedtestIntercept;
  validateNested(patch, "camouflage", fields, (sub, f) => {
    const mode = enumField(sub, "mode", f, CAMOUFLAGE_MODES);
    if (mode !== undefined) out.camouflage.mode = mode;
    const url = strField(sub, "url", f, { maxLen: 2048 });
    if (url !== undefined) out.camouflage.url = url;
  const routing = patch["routingRules"];
  if (routing !== undefined) {
    if (routing === null || typeof routing !== "object" || Array.isArray(routing)) fail(fields, "routingRules", "must be an object");
    else {
      const r = routing as Record<string, unknown>;
      const rrOut: RoutingRules = { ...out.routingRules };
      for (const k of ["bypassLan", "blockAds", "blockMalware", "blockQuic"] as const) {
        const b = boolField(r as Record<string, unknown>, k, fields);
        if (b !== undefined) (rrOut as unknown as Record<string, unknown>)[k] = b;
      }
      const bypassV = r["customBypass"];
      if (bypassV !== undefined) {
        if (!Array.isArray(bypassV)) fail(fields, "routingRules.customBypass", "must be an array");
        else rrOut.customBypass = sanitizeStrArray(bypassV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
      }
      const blockV = r["customBlock"];
      if (blockV !== undefined) {
        if (!Array.isArray(blockV)) fail(fields, "routingRules.customBlock", "must be an array");
        else rrOut.customBlock = sanitizeStrArray(blockV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
      }
      out.routingRules = rrOut;
    }
  }
      if (out.camouflage.mode === "proxy" && !isHttpUrl(out.camouflage.url)) {
      fail(f, "url", "must be a valid http(s) URL when camouflage mode is proxy");
    }
  });

  validateNested(patch, "telegram", fields, (sub, f) => {
    const enabled = boolField(sub, "enabled", f);
    if (enabled !== undefined) out.telegram.enabled = enabled;
    const token = strField(sub, "botToken", f, { maxLen: 64 });
    if (token !== undefined) {
      const trimmed = token.trim();
      if (out.telegram.enabled && trimmed.length > 0 && !TG_TOKEN_RE.test(trimmed)) {
        fail(f, "botToken", "must look like 123456789:AAExample_Token35chars_1234567890");
      } else out.telegram.botToken = trimmed;
    }
    const chatId = strField(sub, "chatId", f, { maxLen: 64 });
    if (chatId !== undefined) {
      const trimmed = chatId.trim();
      if (!TG_CHAT_ID_RE.test(trimmed)) fail(f, "chatId", "must be a numeric chat id or @channelname");
      else out.telegram.chatId = trimmed;
    }
  });

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  out.version = DEFAULT_SETTINGS.version;
  return { ok: true, value: out };
}
