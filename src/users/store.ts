import { constantTimeEqual } from "../utils/random";
import { dayKeyUtc } from "../utils/time";
import type { AddressSetting } from "../types/settings";

export interface UserAccount {
  id: string;
  name: string;
  tokenHash: string;
  tokenHint: string;
  enabled: boolean;
  expiresAt: number | null;
  dailyReqLimit: number | null;
  protocols: "all" | string[];
  addressOverride?: AddressSetting | null;
  createdAt: string;
}

export type PublicUser = Omit<UserAccount, "tokenHash"> & { todayHits?: number };

export const USERS_KEY = "qproxy:users";
export const USER_USAGE_PREFIX = "qproxy:user-usage:";
export const USER_TOTAL_PREFIX = "qproxy:user-total:";
export const MAX_USERS = 50;

type KvLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;
const PROTOCOL_KINDS = ["vless", "vmess", "trojan", "ss"] as const;

export function normalizeProtocols(value: unknown): "all" | string[] {
  if (value === "all") return "all";
  if (!Array.isArray(value)) return "all";
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && (PROTOCOL_KINDS as readonly string[]).includes(v) && !out.includes(v)) {
      out.push(v);
    }
  }
  return out;
}

function sanitizeStoredUser(u: UserAccount): UserAccount {
  return {
    ...u,
    enabled: typeof u.enabled === "boolean" ? u.enabled : true,
    expiresAt: typeof u.expiresAt === "number" || u.expiresAt === null ? u.expiresAt : null,
    dailyReqLimit: typeof u.dailyReqLimit === "number" || u.dailyReqLimit === null ? u.dailyReqLimit : null,
    protocols: normalizeProtocols(u.protocols),
    addressOverride: normalizeAddressOverride(u.addressOverride),
  };
}

export function normalizeAddressOverride(value: unknown): AddressSetting | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const addrRaw = typeof r.address === "string" ? r.address.trim() : "";
  if (addrRaw.length === 0) return null;
  const out: AddressSetting = { address: addrRaw };
  if (typeof r.port === "number" && Number.isInteger(r.port) && r.port > 0) out.port = r.port;
  if (typeof r.label === "string" && r.label.trim().length > 0) out.label = r.label.trim();
  if (typeof r.host === "string" && r.host.trim().length > 0) out.host = r.host.trim();
  if (typeof r.sni === "string" && r.sni.trim().length > 0) out.sni = r.sni.trim();
  return out;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function tokenHintFor(token: string): string {
  return token.slice(0, 8) + "…";
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < arr.length; i++) hex += arr[i]!.toString(16).padStart(2, "0");
  return hex;
}

async function toHash(token: string): Promise<string> {
  if (HASH_RE.test(token)) return token.toLowerCase();
  return hashToken(token);
}

function isUser(raw: unknown): raw is UserAccount {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.tokenHash === "string" &&
    typeof r.tokenHint === "string" &&
    HASH_RE.test(r.tokenHash as string)
  );
}

function isLegacyUser(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" && typeof r.token === "string";
}

export async function listUsers(env: { QPROXY_KV: KvLike }): Promise<UserAccount[]> {
  const raw = (await env.QPROXY_KV.get(USERS_KEY, "json")) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: UserAccount[] = [];
  for (const entry of raw) {
    if (isUser(entry)) {
      out.push(sanitizeStoredUser(entry));
      continue;
    }
    if (isLegacyUser(entry)) {
      const rec = entry as Record<string, unknown>;
      const token = rec.token as string;
      const tokenHash = await hashToken(token);
      const tokenHint = tokenHintFor(token);
      out.push({
        id: rec.id as string,
        name: rec.name as string,
        tokenHash,
        tokenHint,
        enabled: typeof rec.enabled === "boolean" ? (rec.enabled as boolean) : true,
        expiresAt: typeof rec.expiresAt === "number" || rec.expiresAt === null ? (rec.expiresAt as number | null) : null,
        dailyReqLimit: typeof rec.dailyReqLimit === "number" || rec.dailyReqLimit === null ? (rec.dailyReqLimit as number | null) : null,
        protocols: normalizeProtocols(rec.protocols),
        addressOverride: normalizeAddressOverride(rec.addressOverride),
        createdAt: typeof rec.createdAt === "string" ? (rec.createdAt as string) : new Date().toISOString(),
      });
      continue;
    }
  }
  return out;
}

export async function saveUsers(env: { QPROXY_KV: KvLike }, users: UserAccount[]): Promise<void> {
  await env.QPROXY_KV.put(USERS_KEY, JSON.stringify(users));
}

export function newUserToken(): string {
  return crypto.randomUUID();
}

export function newUserId(): string {
  return crypto.randomUUID();
}

export async function findUserByToken(env: { QPROXY_KV: KvLike }, token: string): Promise<UserAccount | null> {
  if (!isUuid(token)) return null;
  const hash = await hashToken(token);
  const users = await listUsers(env);
  return users.find((u) => constantTimeEqual(u.tokenHash, hash)) ?? null;
}

export function sanitizeUser(user: UserAccount): PublicUser {
  return {
    id: user.id,
    name: user.name,
    tokenHint: user.tokenHint,
    enabled: user.enabled,
    expiresAt: user.expiresAt,
    dailyReqLimit: user.dailyReqLimit,
    protocols: user.protocols,
    addressOverride: user.addressOverride ?? null,
    createdAt: user.createdAt,
  };
}

function legacyUsageKey(): string {
  return USER_USAGE_PREFIX + dayKeyUtc();
}

function usageKey(hash: string): string {
  return USER_USAGE_PREFIX + dayKeyUtc() + ":" + hash;
}

interface UsageRow {
  token: string;
  count: number;
}

async function readUsageRows(env: { QPROXY_KV: KvLike }): Promise<UsageRow[]> {
  const raw = (await env.QPROXY_KV.get(legacyUsageKey(), "json")) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: UsageRow[] = [];
  for (const row of raw) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.token === "string" && typeof r.count === "number") out.push({ token: r.token, count: r.count });
  }
  return out;
}

const usageLocks = new Map<string, Promise<unknown>>();

function withUsageLock<T>(token: string, fn: () => Promise<T>): Promise<T> {
  const prev = usageLocks.get(token) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  usageLocks.set(token, next.catch(() => undefined));
  return next;
}

async function findUsageRow(rows: UsageRow[], hash: string): Promise<UsageRow | undefined> {
  const exact = rows.find((r) => r.token === hash);
  if (exact !== undefined) return exact;
  for (const r of rows) {
    if (HASH_RE.test(r.token) || !isUuid(r.token)) continue;
    if ((await hashToken(r.token)) === hash) {
      r.token = hash;
      return r;
    }
  }
  return undefined;
}

async function readUsageCount(env: { QPROXY_KV: KvLike }, hash: string): Promise<number> {
  const raw = (await env.QPROXY_KV.get(usageKey(hash), "json")) as unknown;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  const rows = await readUsageRows(env);
  const row = await findUsageRow(rows, hash);
  const count = row ? row.count : 0;
  if (row) {
    await env.QPROXY_KV.put(usageKey(hash), JSON.stringify(count));
    await env.QPROXY_KV.put(legacyUsageKey(), JSON.stringify(rows));
  }
  return count;
}

export function consumeUserHit(
  env: { QPROXY_KV: KvLike },
  token: string,
  limit: number | null,
): Promise<{ allowed: boolean; hits: number }> {
  return withUsageLock(token, async () => {
    const h = await toHash(token);
    const hits = await readUsageCount(env, h);
    if (limit !== null && hits >= limit) return { allowed: false, hits };
    await env.QPROXY_KV.put(usageKey(h), JSON.stringify(hits + 1));
    const total = await getUserTotalHits(env, h);
    await env.QPROXY_KV.put(USER_TOTAL_PREFIX + h, JSON.stringify(total + 1));
    return { allowed: true, hits: hits + 1 };
  });
}

export async function getUserHits(env: { QPROXY_KV: KvLike }, token: string): Promise<number> {
  const h = await toHash(token);
  return readUsageCount(env, h);
}

export async function getUserTotalHits(env: { QPROXY_KV: KvLike }, token: string): Promise<number> {
  const h = await toHash(token);
  const raw = await env.QPROXY_KV.get(USER_TOTAL_PREFIX + h, "json");
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

export async function migrateUserUsage(env: { QPROXY_KV: KvLike }, oldTokenOrHash: string, newTokenOrHash: string): Promise<void> {
  const oldHash = (await toHash(oldTokenOrHash)).toLowerCase();
  const newHash = (await toHash(newTokenOrHash)).toLowerCase();
  if (oldHash === newHash) return;
  const oldCount = await readUsageCount(env, oldHash);
  await env.QPROXY_KV.delete(usageKey(oldHash));
  const rows = await readUsageRows(env);
  const remaining: UsageRow[] = [];
  for (const r of rows) {
    let rh: string | null = null;
    if (HASH_RE.test(r.token)) rh = r.token.toLowerCase();
    else if (isUuid(r.token)) rh = (await hashToken(r.token)).toLowerCase();
    else {
      remaining.push(r);
      continue;
    }
    if (rh !== oldHash) remaining.push(r);
  }
  if (remaining.length > 0) {
    await env.QPROXY_KV.put(legacyUsageKey(), JSON.stringify(remaining));
  } else {
    await env.QPROXY_KV.delete(legacyUsageKey()).catch(() => {});
  }
  if (oldCount > 0) {
    const newCount = await readUsageCount(env, newHash);
    await env.QPROXY_KV.put(usageKey(newHash), JSON.stringify(newCount + oldCount));
  }
  const oldTotalKey = USER_TOTAL_PREFIX + oldHash;
  const newTotalKey = USER_TOTAL_PREFIX + newHash;
  const oldRaw = await env.QPROXY_KV.get(oldTotalKey, "json");
  let oldTotal = 0;
  if (typeof oldRaw === "number" && Number.isFinite(oldRaw) && oldRaw >= 0) oldTotal = Math.floor(oldRaw);
  else if (typeof oldRaw === "string") {
    const n = Number(oldRaw);
    if (Number.isFinite(n) && n >= 0) oldTotal = Math.floor(n);
  }
  if (oldTotal > 0) {
    const newRaw = await env.QPROXY_KV.get(newTotalKey, "json");
    let newTotal = 0;
    if (typeof newRaw === "number" && Number.isFinite(newRaw) && newRaw >= 0) newTotal = Math.floor(newRaw);
    else if (typeof newRaw === "string") {
      const n = Number(newRaw);
      if (Number.isFinite(n) && n >= 0) newTotal = Math.floor(n);
    }
    await env.QPROXY_KV.put(newTotalKey, JSON.stringify(newTotal + oldTotal));
    await env.QPROXY_KV.delete(oldTotalKey);
  }
}
