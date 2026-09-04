import type {
  AddressSetting,
  Settings,
} from "../types/settings";
import { CF_PLAIN_PORTS, CF_TLS_PORTS, DEFAULT_SETTINGS } from "../types/settings";
import {
  HOST_TOKEN_RE,
  SETTING_FIELD_DESCRIPTORS,
  type SettingFieldSpec,
} from "./fields";
import { isPlainObject } from "./migrate";
import { bracketIpv6, isIpLiteral, isIPv4, isIPv6, isLocalOrPrivateTarget, parseHostPort } from "../utils/net";

export type ValidationResult =
  | { ok: true; value: Settings }
  | { ok: false; fields: Record<string, string> };

const CF_PORT_SET = new Set<number>([...CF_TLS_PORTS, ...CF_PLAIN_PORTS]);
const CF_TLS_PORT_SET = new Set<number>(CF_TLS_PORTS);
const KNOWN_ALPN = ["h2", "http/1.1", "h3"];

const TG_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{35}$/;
const TG_CHAT_ID_RE = /^(?:@[A-Za-z0-9_]{4,64}|-?\d{1,20})?$/;
const TOTP_SECRET_RE = /^[A-Z2-7]{16,128}$/;
const TOTP_RECOVERY_RE = /^[0-9a-f]{64}$/;
const TOTP_MAX_RECOVERY_CODES = 16;

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
  opts: { maxLen: number; minLen?: number; pattern?: RegExp; msg?: string; trim?: boolean },
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
  return opts.trim ? v.trim() : v;
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
  target: object,
  key: string,
  fields: Record<string, string>,
  opts: StrArrayOpts,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of strings");
    return;
  }
  setField(target, key as keyof typeof target & string, sanitizeStrArray(v, opts));
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
    const countryRaw = rec.country;
    if (countryRaw !== undefined && countryRaw !== null) {
      if (typeof countryRaw !== "string") {
        fail(fields, key, `entry ${i + 1} country must be a 2-letter country code`);
        continue;
      }
      const normalized = countryRaw.trim().toUpperCase();
      if (normalized.length > 0) {
        if (!/^[A-Z]{2}$/.test(normalized)) {
          fail(fields, key, `entry ${i + 1} country must be a 2-letter country code`);
          continue;
        }
        entry.country = normalized;
      }
    }
    const cityRaw = rec.city;
    if (cityRaw !== undefined && cityRaw !== null) {
      if (typeof cityRaw !== "string") {
        fail(fields, key, `entry ${i + 1} city must be a string`);
        continue;
      }
      const trimmed = cityRaw.trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 64) {
          fail(fields, key, `entry ${i + 1} city is too long`);
          continue;
        }
        entry.city = trimmed;
      }
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
  target: object,
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
  setField(target, key as keyof typeof target & string, cleaned);
}

const HOSTNAME_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

import { ECH_SERVER_NAME_RE } from "../nodes/ech";
export { ECH_SERVER_NAME_RE, resolveEchServerName, type EchResolution } from "../nodes/ech";

function applyGenericField(
  spec: SettingFieldSpec,
  patch: Record<string, unknown>,
  key: string,
  target: object,
  fields: Record<string, string>,
): void {
  switch (spec.kind) {
    case "bool": {
      const v = boolField(patch, key, fields);
      if (v !== undefined) setField(target, key as keyof typeof target & string, v);
      return;
    }
    case "int": {
      const v = intField(patch, key, fields, spec.min, spec.max);
      if (v !== undefined) setField(target, key as keyof typeof target & string, v);
      return;
    }
    case "enum": {
      const v = enumField(patch, key, fields, spec.allowed as readonly string[]);
      if (v !== undefined) setField(target, key as keyof typeof target & string, v);
      return;
    }
    case "str": {
      const v = strField(patch, key, fields, spec);
      if (v !== undefined) setField(target, key as keyof typeof target & string, v);
      return;
    }
    case "nullableStr": {
      const v = nullableStrField(patch, key, fields, spec.maxLen);
      if (v !== undefined) setField(target, key as keyof typeof target & string, v);
      return;
    }
    case "strArray": {
      strArrayField(patch, target, key as keyof Settings & string, fields, spec);
      return;
    }
    case "urlList": {
      urlListField(patch, target, key, fields, spec.maxItems);
      return;
    }
    case "custom":
      return;
  }
}

const ALLOWLIST_MAX_ITEMS = 64;

function isAllowlistEntry(value: string): boolean {
  const entry = value.trim();
  if (entry.length === 0) return false;
  const slash = entry.indexOf("/");
  if (slash === -1) return isIpLiteral(entry);
  if (entry.indexOf("/", slash + 1) !== -1) return false;
  const base = entry.slice(0, slash).replace(/^\[|\]$/g, "");
  const prefix = entry.slice(slash + 1);
  if (!/^\d+$/.test(prefix)) return false;
  const n = Number(prefix);
  if (isIPv4(base)) return n <= 32;
  if (isIPv6(base)) return n <= 128;
  return false;
}

function applyCustomField(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): void {
  switch (path) {
    case "allowedIps": {
      const allowV = patch["allowedIps"];
      if (allowV === undefined) return;
      if (!Array.isArray(allowV)) {
        fail(fields, "allowedIps", "must be an array of strings");
        return;
      }
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of allowV) {
        if (typeof raw !== "string") {
          fail(fields, "allowedIps", "entries must be strings");
          return;
        }
        const item = raw.trim();
        if (item.length === 0) continue;
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        if (!isAllowlistEntry(item)) {
          fail(fields, "allowedIps", `"${item}" is not a valid IP or CIDR`);
          return;
        }
        seen.add(key);
        cleaned.push(item);
        if (cleaned.length >= ALLOWLIST_MAX_ITEMS) break;
      }
      out.allowedIps = cleaned;
      return;
    }
    case "addresses":
      addressListField(patch, out, "addresses", fields, 64);
      return;
    case "defaultPort": {
      const v = intField(patch, "defaultPort", fields, 1, 65535);
      if (v !== undefined) {
        if (!CF_TLS_PORT_SET.has(v)) fail(fields, "defaultPort", "must be a Cloudflare-proxied TLS port");
        else out.defaultPort = v;
      }
      return;
    }
    case "echServerName": {
      const v = strField(patch, "echServerName", fields, { maxLen: 253 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length > 0 && !ECH_SERVER_NAME_RE.test(trimmed)) fail(fields, "echServerName", "must be a domain name");
        else out.echServerName = trimmed;
      }
      return;
    }
    case "alpn": {
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
      return;
    }
    case "proxyIpPoolUrl": {
      const v = strField(patch, "proxyIpPoolUrl", fields, { maxLen: 2048 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length === 0) out.proxyIpPoolUrl = "";
        else if (!isHttpUrl(trimmed)) fail(fields, "proxyIpPoolUrl", "must be a valid http(s) URL");
        else if (isLocalOrPrivateTarget(new URL(trimmed).hostname)) fail(fields, "proxyIpPoolUrl", "must not target a local or private address");
        else out.proxyIpPoolUrl = trimmed;
      }
      return;
    }
    case "chainProxy.uri": {
      const uri = strField(patch, "uri", fields, { maxLen: 2048 });
      if (uri !== undefined) out.chainProxy.uri = uri;
      if (out.chainProxy.enabled) {
        let parsedHost = "";
        let parsedOk = false;
        try {
          const parsed = new URL(out.chainProxy.uri);
          parsedOk =
            (parsed.protocol === "socks5:" || parsed.protocol === "http:") &&
            parsed.hostname.length > 0;
          if (parsedOk) parsedHost = parsed.hostname;
        } catch {
          parsedOk = false;
        }
        if (!parsedOk) fail(fields, "uri", "must be a socks5:// or http:// proxy URI");
        else if (isLocalOrPrivateTarget(parsedHost)) fail(fields, "uri", "must not target a local or private address");
      }
      return;
    }
    case "dohUpstream": {
      const v = strField(patch, "dohUpstream", fields, { maxLen: 253 });
      if (v !== undefined) {
        if (!isHttpUrl(v)) fail(fields, "dohUpstream", "must be a valid http(s) URL");
        else if (isLocalOrPrivateTarget(new URL(v).hostname)) fail(fields, "dohUpstream", "must not target a local or private address");
        else out.dohUpstream = v;
      }
      return;
    }
    case "remoteDns": {
      const v = strField(patch, "remoteDns", fields, { maxLen: 253, minLen: 1 });
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
      return;
    }
    case "localDns": {
      const v = strField(patch, "localDns", fields, { maxLen: 253, minLen: 1 });
      if (v !== undefined) {
        if (!HOST_TOKEN_RE.test(v) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v !== "localhost") fail(fields, "localDns", "must be a hostname or IP");
        else out.localDns = v;
      }
      return;
    }
    case "camouflage.url": {
      const url = strField(patch, "url", fields, { maxLen: 2048 });
      if (url !== undefined) out.camouflage.url = url;
      if (out.camouflage.mode === "proxy") {
        if (!isHttpUrl(out.camouflage.url)) fail(fields, "url", "must be a valid http(s) URL when camouflage mode is proxy");
        else if (isLocalOrPrivateTarget(new URL(out.camouflage.url).hostname)) fail(fields, "url", "must not target a local or private address");
      }
      return;
    }
    case "routingRules.customBypass": {
      const bypassV = patch["customBypass"];
      if (bypassV !== undefined) {
        if (!Array.isArray(bypassV)) fail(fields, "customBypass", "must be an array");
        else out.routingRules.customBypass = sanitizeStrArray(bypassV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
      }
      return;
    }
    case "routingRules.customBlock": {
      const blockV = patch["customBlock"];
      if (blockV !== undefined) {
        if (!Array.isArray(blockV)) fail(fields, "customBlock", "must be an array");
        else out.routingRules.customBlock = sanitizeStrArray(blockV, { maxItems: 200, itemMaxLen: 253, lowerCase: true });
      }
      return;
    }
    case "telegram.botToken": {
      const token = strField(patch, "botToken", fields, { maxLen: 64 });
      if (token !== undefined) {
        const trimmed = token.trim();
        if (out.telegram.enabled && trimmed.length > 0 && !TG_TOKEN_RE.test(trimmed)) {
          fail(fields, "botToken", "must look like 123456789:AAExample_Token35chars_1234567890");
        } else out.telegram.botToken = trimmed;
      }
      return;
    }
    case "telegram.chatId": {
      const chatId = strField(patch, "chatId", fields, { maxLen: 64 });
      if (chatId !== undefined) {
        const trimmed = chatId.trim();
        if (!TG_CHAT_ID_RE.test(trimmed)) fail(fields, "chatId", "must be a numeric chat id or @channelname");
        else out.telegram.chatId = trimmed;
      }
      return;
    }
    case "totp.secret": {
      const secret = strField(patch, "secret", fields, { maxLen: 128 });
      if (secret !== undefined) {
        const normalized = secret.trim().replace(/[\s-]+/g, "").toUpperCase();
        if (normalized.length > 0 && !TOTP_SECRET_RE.test(normalized))
          fail(fields, "secret", "must be base32 (A-Z and 2-7)");
        else out.totp.secret = normalized;
      }
      if (out.totp.enabled && out.totp.secret.length === 0)
        fail(fields, "secret", "a secret is required to enable two-factor authentication");
      return;
    }
    case "totp.recoveryCodes": {
      const codes = patch["recoveryCodes"];
      if (codes === undefined) return;
      if (!Array.isArray(codes)) {
        fail(fields, "recoveryCodes", "must be an array of strings");
        return;
      }
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of codes) {
        if (typeof raw !== "string") {
          fail(fields, "recoveryCodes", "entries must be strings");
          return;
        }
        const item = raw.trim().toLowerCase();
        if (!TOTP_RECOVERY_RE.test(item)) {
          fail(fields, "recoveryCodes", "entries must be SHA-256 hex digests");
          return;
        }
        if (seen.has(item)) continue;
        seen.add(item);
        cleaned.push(item);
      }
      if (cleaned.length > TOTP_MAX_RECOVERY_CODES) {
        fail(fields, "recoveryCodes", `at most ${TOTP_MAX_RECOVERY_CODES} recovery codes`);
        return;
      }
      out.totp.recoveryCodes = cleaned;
      return;
    }
  }
}

function validateProxyIps(out: Settings, fields: Record<string, string>): void {
  for (const entry of out.proxyIps) {
    const token = entry.trim().replace(/^["']+|["']+$/g, "").toLowerCase();
    if (token.length === 0) continue;
    const bareToken = token.replace(/\.tp\d{1,5}$/, "");
    const hp = parseHostPort(bareToken, 443);
    if (hp !== null && isLocalOrPrivateTarget(hp.host)) {
      fail(fields, "proxyIps", "must not target a local or private address");
      return;
    }
  }
}

function validateFragmentOrdering(
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): void {
  if (!isPlainObject(patch.fragment)) return;
  const f: Record<string, string> = {};
  if (out.fragment.lengthMin > out.fragment.lengthMax)
    fail(f, "lengthMin", "lengthMin must be <= lengthMax");
  if (out.fragment.delayMin > out.fragment.delayMax)
    fail(f, "delayMin", "delayMin must be <= delayMax");
  if (out.fragment.maxSplitMin > out.fragment.maxSplitMax)
    fail(f, "maxSplitMin", "maxSplitMin must be <= maxSplitMax");
  for (const [subKey, msg] of Object.entries(f)) {
    fail(fields, `fragment.${subKey}`, msg);
  }
}

export function validateSettings(input: unknown): ValidationResult {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!isPlainObject(input)) {
    return { ok: false, fields: { settings: "must be an object" } };
  }
  const patch = input;
  const fields: Record<string, string> = {};

  for (const { path, spec } of SETTING_FIELD_DESCRIPTORS) {
    if (!path.includes(".")) {
      if (spec.kind === "custom") applyCustomField(path, patch, out, fields);
      else applyGenericField(spec, patch, path, out, fields);
      continue;
    }
    const dot = path.indexOf(".");
    const parent = path.slice(0, dot);
    const sub = patch[parent];
    if (sub === undefined) continue;
    if (!isPlainObject(sub)) {
      fail(fields, parent, "must be an object");
      continue;
    }
    const nested = sub as Record<string, unknown>;
    const group = out[parent as keyof Settings];
    if (group === undefined || group === null || typeof group !== "object") continue;
    if (spec.kind === "custom") {
      const f: Record<string, string> = {};
      applyCustomField(path, nested, out, f);
      for (const [subKey, msg] of Object.entries(f)) {
        fail(fields, `${parent}.${subKey}`, msg);
      }
      continue;
    }
    const f: Record<string, string> = {};
    applyGenericField(spec, nested, path.slice(dot + 1), group, f);
    for (const msg of Object.values(f)) {
      fail(fields, path, msg);
    }
  }

  validateProxyIps(out, fields);
  validateFragmentOrdering(patch, out, fields);

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  out.version = DEFAULT_SETTINGS.version;
  return { ok: true, value: out };
}
