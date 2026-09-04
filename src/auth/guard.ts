import type { Env } from "../types/env";
import type { RouteHandler } from "../types/context";
import { ForbiddenError, RateLimitedError, UnauthorizedError } from "../core/errors";
import { getSessionFloor, verifySession } from "./session";
import { cidrContains } from "../utils/net";
import { bytesToHex } from "../utils/bytes";

const COOKIE_RE = /(?:^|;\s*)q_session=([^;\s]+)/;
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES = 5;
const MAX_TRACKED_IPS = 10_000;
export const LOGIN_FAIL_PREFIX = "qproxy:login-fail:";
export const LOGIN_FAIL_TTL_SECONDS = 120;

interface FailureRecord {
  count: number;
  resetAt: number;
}

const failures = new Map<string, FailureRecord>();

export function getSession(req: Request): string | null {
  const header = req.headers.get("Cookie") ?? "";
  const m = COOKIE_RE.exec(header);
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

export function isIpAllowlisted(ip: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  const candidate = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (candidate.length === 0) return false;
  for (const raw of allowlist) {
    if (typeof raw !== "string") continue;
    const entry = raw.trim();
    if (entry.length === 0) continue;
    if (entry.includes("/")) {
      const slash = entry.indexOf("/");
      if (entry.indexOf("/", slash + 1) !== -1) continue;
      if (!/^\d+$/.test(entry.slice(slash + 1).trim())) continue;
      if (cidrContains(candidate, entry)) return true;
      continue;
    }
    if (candidate === entry.toLowerCase().replace(/^\[|\]$/g, "")) return true;
  }
  return false;
}

export function requireAuth(handler: RouteHandler): RouteHandler {
  return async (req, env, s) => {
    const raw = getSession(req);
    let floor = 0;
    try {
      floor = await getSessionFloor(env);
    } catch {
      throw new UnauthorizedError();
    }
    const session = raw !== null ? await verifySession(raw, s.sessionSecret, floor) : null;
    if (session === null) throw new UnauthorizedError();
    if (!isIpAllowlisted(clientIp(req), s.allowedIps ?? []))
      throw new ForbiddenError("client ip is not allowlisted for panel access");
    return handler(req, env, s);
  };
}

export function assertCsrf(req: Request): void {
  if (req.headers.get("X-Q-Panel") !== "1")
    throw new ForbiddenError("missing or invalid csrf header: expected X-Q-Panel: 1 — required for CSRF protection");
}

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

export function loginFailWindow(now: number): number {
  return Math.floor(now / FAILURE_WINDOW_MS);
}

export function loginFailKey(ipHash: string, window: number): string {
  return `${LOGIN_FAIL_PREFIX}${ipHash}:${window}`;
}

export async function hashLoginIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return bytesToHex(new Uint8Array(digest));
}

function parseFailCount(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

export async function assertLoginAllowed(env: Env, ip: string): Promise<void> {
  const now = Date.now();
  const rec = failures.get(ip);
  if (rec !== undefined && rec.resetAt > now && rec.count >= MAX_FAILURES) {
    throw new RateLimitedError(Math.ceil((rec.resetAt - now) / 1000));
  }
  const window = loginFailWindow(now);
  let count = 0;
  try {
    count = parseFailCount(await env.QPROXY_KV.get(loginFailKey(await hashLoginIp(ip), window)));
  } catch {
    return;
  }
  if (count >= MAX_FAILURES) {
    throw new RateLimitedError(Math.ceil(((window + 1) * FAILURE_WINDOW_MS - now) / 1000));
  }
}

export async function recordLoginFailure(env: Env, ip: string): Promise<void> {
  const now = Date.now();
  const rec = failures.get(ip);
  if (rec === undefined || rec.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  } else {
    rec.count += 1;
  }
  if (failures.size > MAX_TRACKED_IPS) {
    let checked = 0;
    for (const [key, value] of failures) {
      if (checked++ >= 8) break;
      if (value.resetAt <= now) failures.delete(key);
      if (failures.size <= MAX_TRACKED_IPS) break;
    }
    while (failures.size > MAX_TRACKED_IPS) {
      const oldest = failures.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      failures.delete(oldest);
    }
  }
  try {
    const key = loginFailKey(await hashLoginIp(ip), loginFailWindow(now));
    const next = parseFailCount(await env.QPROXY_KV.get(key)) + 1;
    await env.QPROXY_KV.put(key, String(next), { expirationTtl: LOGIN_FAIL_TTL_SECONDS });
  } catch {
    return;
  }
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}

export async function clearLoginThrottle(env: Env, ip: string): Promise<void> {
  failures.delete(ip);
  try {
    const hash = await hashLoginIp(ip);
    const window = loginFailWindow(Date.now());
    await Promise.all([
      env.QPROXY_KV.delete(loginFailKey(hash, window)),
      env.QPROXY_KV.delete(loginFailKey(hash, window - 1)),
    ]);
  } catch {
    return;
  }
}
