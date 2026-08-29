import { constantTimeEqual } from "../utils/random";
import { dayKeyUtc } from "../utils/time";

export interface UserAccount {
  id: string;
  name: string;
  tokenHash: string;
  tokenHint: string;
  enabled: boolean;
  expiresAt: number | null;
  dailyReqLimit: number | null;
  protocols: "all" | string[];
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
      out.push(entry);
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
        protocols: Array.isArray(rec.protocols) || rec.protocols === "all" ? (rec.protocols as "all" | string[]) : "all",
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
    createdAt: user.createdAt,
  };
}

function usageKey(): string {
  return USER_USAGE_PREFIX + dayKeyUtc();
}

interface UsageRow {
  token: string;
  count: number;
}

async function readUsageRows(env: { QPROXY_KV: KvLike }): Promise<UsageRow[]> {
  const raw = (await env.QPROXY_KV.get(usageKey(), "json")) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: UsageRow[] = [];
  for (const row of raw) {
    if (row === null || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.token === "string" && typeof r.count === "number") out.push({ token: r.token, count: r.count });
  }
  return out;
}

export async function recordUserHit(env: { QPROXY_KV: KvLike }, token: string): Promise<void> {
  const rows = await readUsageRows(env);
  const row = rows.find((r) => r.token === token);
  if (row) row.count += 1;
  else rows.push({ token, count: 1 });
  await env.QPROXY_KV.put(usageKey(), JSON.stringify(rows));
  const h = await toHash(token);
  const total = await getUserTotalHits(env, h);
  await env.QPROXY_KV.put(USER_TOTAL_PREFIX + h, JSON.stringify(total + 1));
}

export async function getUserHits(env: { QPROXY_KV: KvLike }, token: string): Promise<number> {
  if (HASH_RE.test(token)) {
    const h = token.toLowerCase();
    const rows = await readUsageRows(env);
    for (const r of rows) {
      if (HASH_RE.test(r.token)) {
        if (r.token.toLowerCase() === h) return r.count;
      } else if (isUuid(r.token)) {
        const rh = await hashToken(r.token);
        if (rh === h) return r.count;
      } else if (r.token === token) return r.count;
    }
    return 0;
  }
  const rows = await readUsageRows(env);
  return rows.find((r) => r.token === token)?.count ?? 0;
}

export async function getUserTotalHits(env: { QPROXY_KV: KvLike }, token: string): Promise<number> {
  if (HASH_RE.test(token)) {
    const h = token.toLowerCase();
    const rawHash = await env.QPROXY_KV.get(USER_TOTAL_PREFIX + h, "json");
    if (typeof rawHash === "number" && Number.isFinite(rawHash) && rawHash >= 0) return Math.floor(rawHash);
    if (typeof rawHash === "string") {
      const n = Number(rawHash);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    return 0;
  }
  const raw = await env.QPROXY_KV.get(USER_TOTAL_PREFIX + token, "json");
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  const h = await hashToken(token);
  const rawHash = await env.QPROXY_KV.get(USER_TOTAL_PREFIX + h, "json");
  if (typeof rawHash === "number" && Number.isFinite(rawHash) && rawHash >= 0) return Math.floor(rawHash);
  if (typeof rawHash === "string") {
    const n = Number(rawHash);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

export async function migrateUserUsage(env: { QPROXY_KV: KvLike }, oldTokenOrHash: string, newTokenOrHash: string): Promise<void> {
  const oldHash = (await toHash(oldTokenOrHash)).toLowerCase();
  const newIsUuid = isUuid(newTokenOrHash);
  const newPlain = newIsUuid ? newTokenOrHash : null;
  const newHash = (await toHash(newTokenOrHash)).toLowerCase();
  if (oldHash === newHash) return;
  const rows = await readUsageRows(env);
  let oldCount = 0;
  const remaining: UsageRow[] = [];
  for (const r of rows) {
    let rh: string | null = null;
    if (HASH_RE.test(r.token)) rh = r.token.toLowerCase();
    else if (isUuid(r.token)) rh = (await hashToken(r.token)).toLowerCase();
    else {
      remaining.push(r);
      continue;
    }
    if (rh === oldHash) oldCount += r.count;
    else remaining.push(r);
  }
  if (oldCount > 0) {
    if (newPlain) {
      const existing = remaining.find((r) => r.token === newPlain);
      if (existing) existing.count += oldCount;
      else remaining.push({ token: newPlain, count: oldCount });
    } else {
      const existing = remaining.find((r) => r.token.toLowerCase() === newHash);
      if (existing) existing.count += oldCount;
      else remaining.push({ token: newHash, count: oldCount });
    }
    await env.QPROXY_KV.put(usageKey(), JSON.stringify(remaining));
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
