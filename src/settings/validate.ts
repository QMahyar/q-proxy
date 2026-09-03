import type {
  AddressSetting,
  RoutingRules,
  CamouflageMode,
  Fingerprint,
  FragmentMode,
  Language,
  SsMethod,
  Settings,
} from "../types/settings";
import { CF_PLAIN_PORTS, CF_TLS_PORTS, DEFAULT_SETTINGS } from "../types/settings";
import { isPlainObject } from "./migrate";
import { bracketIpv6, isIpLiteral, isLocalOrPrivateTarget, parseHostPort } from "../utils/net";

export type ValidationResult =
  | { ok: true; value: Settings }
  | { ok: false; fields: Record<string, string> };

const CF_PORT_SET = new Set<number>([...CF_TLS_PORTS, ...CF_PLAIN_PORTS]);
const CF_TLS_PORT_SET = new Set<number>(CF_TLS_PORTS);
const KNOWN_ALPN = ["h2", "http/1.1", "h3"];

const LANGUAGES: readonly Language[] = ["en", "fa"];
const SS_METHODS: readonly SsMethod[] = ["aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"];
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

function setField<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
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
  setField(out, key, sanitizeStrArray(v, opts));
}

function addressListField(
  patch: Record<string, unknown>,
  out: Settings,
  key: string,
  fields: Record<string, string>,
  maxItems: number,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of address entries");
    return;
  }
  const seen = new Set<string>();
  const result: AddressSetting[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (!isPlainObject(item)) {
      fail(fields, key, `entry ${i + 1} must be an object`);
      continue;
    }
    const rec = item as Record<string, unknown>;
    const addrRaw = typeof rec.address === "string" ? rec.address.trim() : "";
    if (addrRaw.length === 0) {
      fail(fields, key, `entry ${i + 1} is missing an address`);
      continue;
    }
    const hp = parseHostPort(addrRaw, 0);
    if (hp === null || hp.host.length === 0) {
      fail(fields, key, `entry ${i + 1} has an invalid address`);
      continue;
    }
    const hostValid = isIpLiteral(hp.host) || (HOSTNAME_RE.test(hp.host) && hp.host.length <= 253 && !hp.host.includes(":"));
    if (!hostValid) {
      fail(fields, key, `entry ${i + 1} address must be an IP or hostname`);
      continue;
    }
    let port = typeof rec.port === "number" ? rec.port : hp.port > 0 ? hp.port : undefined;
    if (port !== undefined) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail(fields, key, `entry ${i + 1} port must be 1-65535`);
        continue;
      }
      if (!CF_PORT_SET.has(port)) {
        fail(fields, key, `entry ${i + 1} port ${port} is not a Cloudflare-proxied port`);
        continue;
      }
    }
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    if (label.length > 64) {
      fail(fields, key, `entry ${i + 1} label is too long`);
      continue;
    }
    const entry: AddressSetting = { address: bracketIpv6(hp.host) };
    if (port !== undefined) entry.port = port;
    if (label.length > 0) entry.label = label;
    if (rec.enabled === false) entry.enabled = false;
    const hostField = typeof rec.host === "string" ? rec.host.trim() : "";
    if (hostField.length > 0) {
      if (!HOSTNAME_RE.test(hostField) || hostField.length > 253) {
        fail(fields, key, `entry ${i + 1} host must be a hostname`);
        continue;
      }
      entry.host = hostField;
    }
    const sniField = typeof rec.sni === "string" ? rec.sni.trim() : "";
    if (sniField.length > 0) {
      if (!HOSTNAME_RE.test(sniField) || sniField.length > 253) {
        fail(fields, key, `entry ${i + 1} sni must be a hostname`);
        continue;
      }
      entry.sni = sniField;
    }
    const dedupeKey = `${entry.address}:${entry.port ?? "auto"}`.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(entry);
    if (result.length >= maxItems) break;
  }
  if (result.length > maxItems) {
    fail(fields, key, `too many entries (max ${maxItems})`);
    return;
  }
  setField(out, key as keyof Settings & string, result);
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
  setField(out, key as keyof Settings & string, cleaned);
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
  const defaultPort = intField(patch, "defaultPort", fields, 1, 65535);
  if (defaultPort !== undefined) {
    if (!CF_TLS_PORT_SET.has(defaultPort)) fail(fields, "defaultPort", "must be a Cloudflare-proxied TLS port");
    else out.defaultPort = defaultPort;
  }
  addressListField(patch, out, "addresses", fields, 64);
  const nameTemplate = strField(patch, "nameTemplate", fields, { maxLen: 512 });
  if (nameTemplate !== undefined) out.nameTemplate = nameTemplate;
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
  v = strField(patch, "proxyIpPoolUrl", fields, { maxLen: 2048 });
  if (v !== undefined) {
    const trimmed = v.trim();
    if (trimmed.length === 0) out.proxyIpPoolUrl = "";
    else if (!isHttpUrl(trimmed)) fail(fields, "proxyIpPoolUrl", "must be a valid http(s) URL");
    else if (isLocalOrPrivateTarget(new URL(trimmed).hostname)) fail(fields, "proxyIpPoolUrl", "must not target a local or private address");
    else out.proxyIpPoolUrl = trimmed;
  }
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
  if (v !== undefined) {
    if (!isHttpUrl(v)) fail(fields, "dohUpstream", "must be a valid http(s) URL");
    else if (isLocalOrPrivateTarget(new URL(v).hostname)) fail(fields, "dohUpstream", "must not target a local or private address");
    else out.dohUpstream = v;
  }
  v = strField(patch, "remoteDns", fields, { maxLen: 253, minLen: 1 });
  if (v !== undefined) {
    if (isHttpUrl(v)) {
      if (isLocalOrPrivateTarget(new URL(v).hostname)) fail(fields, "remoteDns", "must not target a local or private address");
      else out.remoteDns = v;
    } else if (HOST_TOKEN_RE.test(v)) {
      const hp = parseHostPort(v, 443);
      if (hp === null || isLocalOrPrivateTarget(hp.host)) fail(fields, "remoteDns", "must not target a local or private address");
      else out.remoteDns = `https://${bracketIpv6(hp.host)}/dns-query`;
    } else fail(fields, "remoteDns", "must be a URL or IP/hostname");
  }
  v = strField(patch, "localDns", fields, { maxLen: 253, minLen: 1 });
  if (v !== undefined) {
    if (!HOST_TOKEN_RE.test(v) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v !== "localhost") fail(fields, "localDns", "must be a hostname or IP");
    else out.localDns = v;
  }
  const urlTestIntervalSec = intField(patch, "urlTestIntervalSec", fields, 60, 86_400);
  if (urlTestIntervalSec !== undefined) out.urlTestIntervalSec = urlTestIntervalSec;
  v = strField(patch, "profileTitle", fields, { maxLen: 64 });
  if (v !== undefined) out.profileTitle = v.trim();
  const subUpdateIntervalHours = intField(patch, "subUpdateIntervalHours", fields, 1, 168);
  if (subUpdateIntervalHours !== undefined) out.subUpdateIntervalHours = subUpdateIntervalHours;
  const maxNodesPerFormat = intField(patch, "maxNodesPerFormat", fields, 1, 2000);
  if (maxNodesPerFormat !== undefined) out.maxNodesPerFormat = maxNodesPerFormat;
  urlListField(patch, out, "remoteSubUrls", fields, 16);
  urlListField(patch, out, "sourceUrls", fields, 16);
  const killSwitch = boolField(patch, "killSwitch", fields);
  if (killSwitch !== undefined) out.killSwitch = killSwitch;
  const speedtestIntercept = boolField(patch, "speedtestIntercept", fields);
  if (speedtestIntercept !== undefined) out.speedtestIntercept = speedtestIntercept;
  validateNested(patch, "camouflage", fields, (sub, f) => {
    const mode = enumField(sub, "mode", f, CAMOUFLAGE_MODES);
    if (mode !== undefined) out.camouflage.mode = mode;
    const url = strField(sub, "url", f, { maxLen: 2048 });
    if (url !== undefined) out.camouflage.url = url;
    if (out.camouflage.mode === "proxy" && !isHttpUrl(out.camouflage.url)) {
      fail(f, "url", "must be a valid http(s) URL when camouflage mode is proxy");
    }
  });

  validateNested(patch, "routingRules", fields, (sub, f) => {
    const rrOut: RoutingRules = { ...out.routingRules };
    for (const k of ["bypassLan", "blockAds", "blockMalware", "blockQuic"] as const) {
      const b = boolField(sub, k, f);
      if (b !== undefined) rrOut[k] = b;
    }
    const bypassV = sub["customBypass"];
    if (bypassV !== undefined) {
      if (!Array.isArray(bypassV)) fail(f, "customBypass", "must be an array");
      else rrOut.customBypass = sanitizeStrArray(bypassV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
    }
    const blockV = sub["customBlock"];
    if (blockV !== undefined) {
      if (!Array.isArray(blockV)) fail(f, "customBlock", "must be an array");
      else rrOut.customBlock = sanitizeStrArray(blockV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
    }
    out.routingRules = rrOut;
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
