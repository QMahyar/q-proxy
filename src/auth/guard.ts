import type { RouteHandler } from "../types/context";
import { ForbiddenError, RateLimitedError, UnauthorizedError } from "../core/errors";
import { verifySession } from "./session";

const COOKIE_RE = /(?:^|;\s*)q_session=([^;\s]+)/;
const FAILURE_WINDOW_MS = 60_000;
const MAX_FAILURES = 5;
const MAX_TRACKED_IPS = 10_000;

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

export function requireAuth(handler: RouteHandler): RouteHandler {
  return async (req, env, s) => {
    const raw = getSession(req);
    const session = raw !== null ? await verifySession(raw, s.sessionSecret) : null;
    if (session === null) throw new UnauthorizedError();
    return handler(req, env, s);
  };
}

export function assertCsrf(req: Request): void {
  if (req.headers.get("X-Q-Panel") !== "1") throw new ForbiddenError("missing csrf header");
}

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

export function assertLoginAllowed(ip: string): void {
  const rec = failures.get(ip);
  if (rec !== undefined && rec.resetAt > Date.now() && rec.count >= MAX_FAILURES) {
    throw new RateLimitedError(Math.ceil((rec.resetAt - Date.now()) / 1000));
  }
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const rec = failures.get(ip);
  if (rec === undefined || rec.resetAt <= now) {
    failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  } else {
    rec.count += 1;
  }
  if (failures.size > MAX_TRACKED_IPS) {
    for (const [key, value] of failures) {
      if (value.resetAt <= now) failures.delete(key);
    }
    while (failures.size > MAX_TRACKED_IPS) {
      const oldest = failures.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      failures.delete(oldest);
    }
  }
}

export function clearLoginFailures(ip: string): void {
  failures.delete(ip);
}
