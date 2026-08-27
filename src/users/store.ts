import { constantTimeEqual } from "../utils/random";
import { dayKeyUtc } from "../utils/time";

export interface UserAccount {
  id: string;
  name: string;
  token: string;
  enabled: boolean;
  expiresAt: number | null;
  dailyReqLimit: number | null;
  protocols: "all" | string[];
  createdAt: string;
}

export type PublicUser = UserAccount & { todayHits?: number };

export const USERS_KEY = "qproxy:users";
export const USER_USAGE_PREFIX = "qproxy:user-usage:";
export const MAX_USERS = 50;

type KvLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isUser(raw: unknown): raw is UserAccount {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" && typeof r.token === "string";
}

export async function listUsers(env: { QPROXY_KV: KvLike }): Promise<UserAccount[]> {
  const raw = (await env.QPROXY_KV.get(USERS_KEY, "json")) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isUser);
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
  const users = await listUsers(env);
  return users.find((u) => constantTimeEqual(u.token, token)) ?? null;
}

export function sanitizeUser(user: UserAccount): PublicUser {
  return {
    id: user.id,
    name: user.name,
    token: user.token,
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
}

export async function getUserHits(env: { QPROXY_KV: KvLike }, token: string): Promise<number> {
  const rows = await readUsageRows(env);
  return rows.find((r) => r.token === token)?.count ?? 0;
}
