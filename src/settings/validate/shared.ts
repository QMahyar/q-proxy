import type { Settings } from "../../types/settings";
import { CF_PLAIN_PORTS, CF_TLS_PORTS } from "../../types/settings";
import type { SettingFieldSpec } from "../fields";
import { isIpLiteral, isIPv4, isIPv6, parseHostPort, stripBrackets, HOSTNAME_RE } from "../../utils/net";

export type ValidationResult =
  | { ok: true; value: Settings }
  | { ok: false; fields: Record<string, string> };

export const CF_PORT_SET = new Set<number>([...CF_TLS_PORTS, ...CF_PLAIN_PORTS]);
export const CF_TLS_PORT_SET = new Set<number>(CF_TLS_PORTS);
export const KNOWN_ALPN = ["h2", "http/1.1", "h3"];

export const TG_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{35}$/;
export const TG_CHAT_ID_RE = /^(?:-?\d{1,20})?$/;

export const ALLOWLIST_MAX_ITEMS = 64;

export function fail(fields: Record<string, string>, key: string, msg: string): void {
  if (!(key in fields)) fields[key] = msg;
}

export function setField<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function boolField(
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

export function intField(
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

export function enumField<T extends string>(
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

export function strField(
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

export function nullableStrField(
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

export interface StrArrayOpts {
  maxItems: number;
  itemMaxLen?: number;
  pattern?: RegExp;
  lowerCase?: boolean;
}

export function sanitizeStrArray(input: unknown, opts: StrArrayOpts): { values: string[]; truncated: boolean } {
  if (!Array.isArray(input)) return { values: [], truncated: false };
  const seen = new Set<string>();
  let truncated = false;
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    let item = raw.trim();
    if (item.length === 0) continue;
    if (opts.lowerCase) item = item.toLowerCase();
    if (seen.has(item)) continue;
    if (item.length > (opts.itemMaxLen ?? 253)) continue;
    if (opts.pattern && !opts.pattern.test(item)) continue;
    seen.add(item);
    if (seen.size > opts.maxItems) {
      truncated = true;
      break;
    }
  }
  return { values: [...seen].slice(0, opts.maxItems), truncated };
}

export function strArrayField(
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
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") {
      fail(fields, key, "entries must be strings");
      return;
    }
    let item = raw.trim();
    if (item.length === 0) continue;
    if (opts.lowerCase) item = item.toLowerCase();
    if (seen.has(item)) continue;
    if (item.length > (opts.itemMaxLen ?? 253)) {
      fail(fields, key, `"${item.slice(0, 64)}" is too long`);
      return;
    }
    if (opts.pattern && !opts.pattern.test(item)) {
      fail(fields, key, `"${item.slice(0, 64)}" is not a valid entry`);
      return;
    }
    seen.add(item);
    result.push(item);
    if (result.length > opts.maxItems) {
      fail(fields, key, `too many entries (max ${opts.maxItems})`);
      return;
    }
  }
  setField(target, key as keyof typeof target & string, result);
}

export function presetIdListField(
  patch: Record<string, unknown>,
  out: Settings,
  key: string,
  fields: Record<string, string>,
  maxItems: number,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of preset ids");
    return;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      fail(fields, key, "entries must be non-empty preset ids");
      return;
    }
    const id = raw.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length > maxItems) {
      fail(fields, key, `too many entries (max ${maxItems})`);
      return;
    }
  }
  setField(out, key as keyof Settings & string, result);
}

export function endpointLinesField(
  patch: Record<string, unknown>,
  out: Settings,
  key: string,
  fields: Record<string, string>,
  maxItems: number,
  enforceCfPorts: boolean,
): void {
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of endpoint lines");
    return;
  }
  const result: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const raw = v[i];
    if (typeof raw !== "string") {
      fail(fields, key, `line ${i + 1} must be a string`);
      return;
    }
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.length > 253) {
      fail(fields, key, `line ${i + 1} "${line.slice(0, 64)}" is too long`);
      return;
    }
    const hp = parseHostPort(line, 0);
    if (hp === null || hp.host.length === 0) {
      fail(fields, key, `line ${i + 1} "${line.slice(0, 64)}" is not a valid ip:port entry`);
      return;
    }
    const hostValid = isIpLiteral(hp.host) || (HOSTNAME_RE.test(hp.host) && hp.host.length <= 253 && !hp.host.includes(":"));
    if (!hostValid) {
      fail(fields, key, `line ${i + 1} "${line.slice(0, 64)}" address must be an IP or hostname`);
      return;
    }
    if (hp.port > 0 && enforceCfPorts && !CF_PORT_SET.has(hp.port)) {
      fail(fields, key, `line ${i + 1} "${line.slice(0, 64)}" port ${hp.port} is not a Cloudflare-proxied port`);
      return;
    }
    result.push(line);
    if (result.length > maxItems) {
      fail(fields, key, `too many entries (max ${maxItems})`);
      return;
    }
  }
  setField(out, key as keyof Settings & string, result);
}

export function urlListField(
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
  const { values: cleaned, truncated } = sanitizeStrArray(v, { maxItems });
  if (truncated) {
    fail(fields, key, `too many entries (max ${maxItems})`);
    return;
  }
  for (const item of cleaned) {
    if (!isHttpUrl(item)) {
      fail(fields, key, `"${item}" is not a valid http(s) URL`);
      return;
    }
  }
  setField(target, key as keyof typeof target & string, cleaned);
}

export function isAllowlistEntry(value: string): boolean {
  const entry = value.trim();
  if (entry.length === 0) return false;
  const slash = entry.indexOf("/");
  if (slash === -1) return isIpLiteral(entry);
  if (entry.indexOf("/", slash + 1) !== -1) return false;
  const base = stripBrackets(entry.slice(0, slash));
  const prefix = entry.slice(slash + 1);
  if (!/^\d+$/.test(prefix)) return false;
  const n = Number(prefix);
  if (isIPv4(base)) return n <= 32;
  if (isIPv6(base)) return n <= 128;
  return false;
}

export function applyGenericField(
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
