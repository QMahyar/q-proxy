import type { RouteHandler } from "../../types/context";
import type { AddressSetting } from "../../types/settings";
import { CF_PLAIN_PORTS, CF_TLS_PORTS } from "../../types/settings";
import type { PublicUser, UserAccount } from "../../users/store";
import { NotFoundError, ValidationError } from "../../core/errors";
import { jsonOk, readJsonObject } from "../../core/respond";
import { bracketIpv6, isIpLiteral, parseHostPort } from "../../utils/net";
import {
  MAX_USERS,
  USER_ACTIVITY_DEFAULT_DAYS,
  USER_ACTIVITY_MAX_DAYS,
  getUserActivity,
  getUserHits,
  hashToken,
  listUsers,
  migrateUserUsage,
  newUserId,
  newUserToken,
  saveUsers,
  sanitizeUser,
  tokenHintFor,
} from "../../users/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROTOCOLS = ["vless", "vmess", "trojan", "ss"] as const;
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const HOSTNAME_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const CF_PORT_SET = new Set<number>([...CF_TLS_PORTS, ...CF_PLAIN_PORTS]);

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
  if (n > 10000) throw new ValidationError({ dailyReqLimit: "must be at most 10000" });
  return n;
}

function parseExpiry(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError({ expiresAt: "must be an epoch milliseconds integer" });
  if (n <= Date.now()) throw new ValidationError({ expiresAt: "must be in the future" });
  if (n > Date.now() + TEN_YEARS_MS) throw new ValidationError({ expiresAt: "must be within 10 years" });
  return n;
}

function parseAddressOverride(value: unknown): AddressSetting | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError({ addressOverride: "must be an object or null" });
  }
  const rec = value as Record<string, unknown>;
  const addrRaw = typeof rec.address === "string" ? rec.address.trim() : "";
  if (addrRaw.length === 0) throw new ValidationError({ addressOverride: "address is required" });
  const hp = parseHostPort(addrRaw, 0);
  if (hp === null || hp.host.length === 0) {
    throw new ValidationError({ addressOverride: "address is invalid" });
  }
  const hostValid =
    isIpLiteral(hp.host) || (HOSTNAME_RE.test(hp.host) && hp.host.length <= 253 && !hp.host.includes(":"));
  if (!hostValid) throw new ValidationError({ addressOverride: "address must be an IP or hostname" });
  const port = typeof rec.port === "number" ? rec.port : hp.port > 0 ? hp.port : undefined;
  if (port !== undefined) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ValidationError({ addressOverride: "port must be 1-65535" });
    }
    if (!CF_PORT_SET.has(port)) {
      throw new ValidationError({ addressOverride: `port ${port} is not a Cloudflare-proxied port` });
    }
  }
  const label = typeof rec.label === "string" ? rec.label.trim() : "";
  if (label.length > 64) throw new ValidationError({ addressOverride: "label is too long" });
  const hostField = typeof rec.host === "string" ? rec.host.trim() : "";
  if (hostField.length > 0 && (!HOSTNAME_RE.test(hostField) || hostField.length > 253)) {
    throw new ValidationError({ addressOverride: "host must be a hostname" });
  }
  const sniField = typeof rec.sni === "string" ? rec.sni.trim() : "";
  if (sniField.length > 0 && (!HOSTNAME_RE.test(sniField) || sniField.length > 253)) {
    throw new ValidationError({ addressOverride: "sni must be a hostname" });
  }
  const entry: AddressSetting = { address: bracketIpv6(hp.host) };
  if (port !== undefined) entry.port = port;
  if (label.length > 0) entry.label = label;
  if (hostField.length > 0) entry.host = hostField;
  if (sniField.length > 0) entry.sni = sniField;
  return entry;
}

async function buildUser(body: Record<string, unknown>): Promise<{ user: UserAccount; plain: string }> {
  const plain = newUserToken();
  const tokenHash = await hashToken(plain);
  const tokenHint = tokenHintFor(plain);
  return {
    plain,
    user: {
      id: newUserId(),
      name: requireName(body.name),
      tokenHash,
      tokenHint,
      enabled: true,
      expiresAt: parseExpiry(body.expiresAt),
      dailyReqLimit: parseLimit(body.dailyReqLimit),
      protocols: parseProtocols(body.protocols),
      addressOverride: parseAddressOverride(body.addressOverride),
      createdAt: new Date().toISOString(),
    },
  };
}

function parseActivityDays(value: unknown): number {
  if (value === null || value === undefined || value === "") return USER_ACTIVITY_DEFAULT_DAYS;
  const n = Number(value);
  if (!Number.isFinite(n)) return USER_ACTIVITY_DEFAULT_DAYS;
  if (Math.floor(n) < 1) return 1;
  if (Math.floor(n) > USER_ACTIVITY_MAX_DAYS) return USER_ACTIVITY_MAX_DAYS;
  return Math.floor(n);
}

async function withHits(env: Parameters<RouteHandler>[1], users: UserAccount[]): Promise<PublicUser[]> {
  return Promise.all(
    users.map(async (u) => ({ ...sanitizeUser(u), todayHits: await getUserHits(env, u.tokenHash) })),
  );
}

export const handleUsersApi: RouteHandler = async (req, env, _s) => {
  const url = new URL(req.url);
  const segs = url.pathname.split("/").filter((p) => p.length > 0);
  const rest = segs.slice(segs.indexOf("users", 1) + 1);
  const method = req.method;

  if (rest.length === 0 && method === "GET") {
    return jsonOk({ users: await withHits(env, await listUsers(env)) });
  }
  if (rest.length === 0 && method === "POST") {
    const body = await readJsonObject(req);
    const { user, plain } = await buildUser(body);
    const fresh = await listUsers(env);
    if (fresh.length >= MAX_USERS) throw new ValidationError({ limit: `at most ${MAX_USERS} users` });
    fresh.push(user);
    await saveUsers(env, fresh);
    return jsonOk({ user: { ...sanitizeUser(user), token: plain } });
  }

  const id = rest[0];
  if (id !== undefined && UUID_RE.test(id)) {
    const users = await listUsers(env);
    const index = users.findIndex((u) => u.id === id);
    if (index < 0) throw new NotFoundError();
    const user = users[index]!;
    if (rest.length === 2 && rest[1] === "activity" && method === "GET") {
      const days = parseActivityDays(url.searchParams.get("days"));
      return jsonOk({ activity: await getUserActivity(env, user.tokenHash, days) });
    }
    if (rest.length === 1 && method === "PUT") {
      const body = await readJsonObject(req);
      let name = user.name;
      let protocols = user.protocols;
      let dailyReqLimit = user.dailyReqLimit;
      let expiresAt = user.expiresAt;
      let enabled = user.enabled;
      let addressOverride = user.addressOverride ?? null;
      if (body.name !== undefined) name = requireName(body.name);
      if (body.protocols !== undefined) protocols = parseProtocols(body.protocols);
      if (body.dailyReqLimit !== undefined) dailyReqLimit = parseLimit(body.dailyReqLimit);
      if (body.expiresAt !== undefined) expiresAt = parseExpiry(body.expiresAt);
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") throw new ValidationError({ enabled: "must be a boolean" });
        enabled = body.enabled;
      }
      if (body.addressOverride !== undefined) addressOverride = parseAddressOverride(body.addressOverride);
      users[index] = { ...user, name, protocols, dailyReqLimit, expiresAt, enabled, addressOverride };
      await saveUsers(env, users);
      return jsonOk({ user: sanitizeUser(users[index]!) });
    }
    if (rest.length === 1 && method === "DELETE") {
      users.splice(index, 1);
      await saveUsers(env, users);
      return jsonOk({ deleted: true });
    }
    if (rest.length === 2 && rest[1] === "regenerate-token" && method === "POST") {
      const oldHash = user.tokenHash;
      const plain = newUserToken();
      const tokenHash = await hashToken(plain);
      const tokenHint = tokenHintFor(plain);
      users[index] = { ...user, tokenHash, tokenHint };
      await migrateUserUsage(env, oldHash, plain);
      await saveUsers(env, users);
      return jsonOk({ token: plain });
    }
  }

  throw new NotFoundError();
};
