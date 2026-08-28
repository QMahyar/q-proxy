import type { RouteHandler } from "../../types/context";
import type { PublicUser, UserAccount } from "../../users/store";
import { NotFoundError, ValidationError } from "../../core/errors";
import { jsonOk, readJsonObject } from "../../core/respond";
import {
  MAX_USERS,
  getUserHits,
  listUsers,
  newUserId,
  newUserToken,
  saveUsers,
  sanitizeUser,
} from "../../users/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROTOCOLS = ["vless", "vmess", "trojan", "ss"] as const;

function requireName(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError({ name: "must be a string" });
  const trimmed = value.trim();
  if (trimmed.length < 1) throw new ValidationError({ name: "is required" });
  if (trimmed.length > 100) throw new ValidationError({ name: "must be at most 100 characters" });
  return trimmed;
}

function parseProtocols(value: unknown): "all" | string[] {
  if (value === undefined || value === null || value === "all") return "all";
  if (!Array.isArray(value)) throw new ValidationError({ protocols: "must be 'all' or an array" });
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(PROTOCOLS as readonly string[]).includes(item)) {
      throw new ValidationError({ protocols: `unknown protocol: ${String(item).slice(0, 30)}` });
    }
    if (!out.includes(item)) out.push(item);
  }
  if (out.length === 0) throw new ValidationError({ protocols: "must include at least one protocol" });
  return out;
}

function parseLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError({ dailyReqLimit: "must be a positive integer" });
  return n;
}

function parseExpiry(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError({ expiresAt: "must be an epoch milliseconds integer" });
  if (n <= Date.now()) throw new ValidationError({ expiresAt: "must be in the future" });
  return n;
}

function buildUser(body: Record<string, unknown>): UserAccount {
  return {
    id: newUserId(),
    name: requireName(body.name),
    token: newUserToken(),
    enabled: true,
    expiresAt: parseExpiry(body.expiresAt),
    dailyReqLimit: parseLimit(body.dailyReqLimit),
    protocols: parseProtocols(body.protocols),
    createdAt: new Date().toISOString(),
  };
}

async function withHits(env: Parameters<RouteHandler>[1], users: UserAccount[]): Promise<PublicUser[]> {
  return Promise.all(
    users.map(async (u) => ({ ...sanitizeUser(u), todayHits: await getUserHits(env, u.token) })),
  );
}

export const handleUsersApi: RouteHandler = async (req, env, _s) => {
  const url = new URL(req.url);
  const segs = url.pathname.split("/").filter((p) => p.length > 0);
  const rest = segs.slice(segs.indexOf("users") + 1);
  const method = req.method;

  if (rest.length === 0 && method === "GET") {
    return jsonOk({ users: await withHits(env, await listUsers(env)) });
  }
  if (rest.length === 0 && method === "POST") {
    const body = await readJsonObject(req);
    const user = buildUser(body);
    const users = await listUsers(env);
    if (users.length >= MAX_USERS) throw new ValidationError({ limit: `at most ${MAX_USERS} users` });
    users.push(user);
    await saveUsers(env, users);
    return jsonOk({ user: sanitizeUser(user) });
  }

  const id = rest[0];
  if (id !== undefined && UUID_RE.test(id)) {
    const users = await listUsers(env);
    const index = users.findIndex((u) => u.id === id);
    if (index < 0) throw new NotFoundError();
    const user = users[index]!;
    if (rest.length === 1 && method === "PUT") {
      const body = await readJsonObject(req);
      let name = user.name;
      let protocols = user.protocols;
      let dailyReqLimit = user.dailyReqLimit;
      let expiresAt = user.expiresAt;
      let enabled = user.enabled;
      if (body.name !== undefined) name = requireName(body.name);
      if (body.protocols !== undefined) protocols = parseProtocols(body.protocols);
      if (body.dailyReqLimit !== undefined) dailyReqLimit = parseLimit(body.dailyReqLimit);
      if (body.expiresAt !== undefined) expiresAt = parseExpiry(body.expiresAt);
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") throw new ValidationError({ enabled: "must be a boolean" });
        enabled = body.enabled;
      }
      users[index] = { ...user, name, protocols, dailyReqLimit, expiresAt, enabled };
      await saveUsers(env, users);
      return jsonOk({ user: sanitizeUser(users[index]!) });
    }
    if (rest.length === 1 && method === "DELETE") {
      users.splice(index, 1);
      await saveUsers(env, users);
      return jsonOk({ deleted: true });
    }
    if (rest.length === 2 && rest[1] === "regenerate-token" && method === "POST") {
      users[index] = { ...user, token: newUserToken() };
      await saveUsers(env, users);
      return jsonOk({ token: users[index]!.token });
    }
  }

  throw new NotFoundError();
};
