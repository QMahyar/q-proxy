import type { Env } from "../types/env";
import { decodeBase64Url, encodeBase64Url } from "../utils/base64";
import { hmacSha256Hex } from "../utils/hmac";
import { constantTimeEqual } from "../utils/random";
import { unixNow } from "../utils/time";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = "q_session";
export const SESSION_FLOOR_KEY = "qproxy:min-iat";

const SESSION_FLOOR_TTL_MS = 5_000;

export interface SessionPayload {
  exp: number;
  iat?: number;
}

interface FloorCacheEntry {
  value: number;
  expiresAt: number;
}

let floorCache: FloorCacheEntry | null = null;

export function clearSessionFloorCache(): void {
  floorCache = null;
}

export async function getSessionFloor(env: Env): Promise<number> {
  if (floorCache !== null && floorCache.expiresAt > Date.now()) return floorCache.value;
  const raw = await env.QPROXY_KV.get(SESSION_FLOOR_KEY);
  const value = raw !== null && /^[0-9]+$/.test(raw) ? Number(raw) : 0;
  floorCache = { value, expiresAt: Date.now() + SESSION_FLOOR_TTL_MS };
  return value;
}

export async function bumpSessionFloor(env: Env): Promise<void> {
  const at = unixNow() + 1;
  await env.QPROXY_KV.put(SESSION_FLOOR_KEY, String(at));
  floorCache = { value: at, expiresAt: Date.now() + SESSION_FLOOR_TTL_MS };
}

export async function issueSession(secret: string): Promise<string> {
  const now = unixNow();
  const payload = encodeBase64Url(JSON.stringify({ exp: now + SESSION_TTL_SECONDS, iat: now }));
  const sig = await hmacSha256Hex(payload, secret);
  return `${payload}.${sig}`;
}

export async function issueSessionWithIat(secret: string, iat: number): Promise<string> {
  const payload = encodeBase64Url(JSON.stringify({ exp: iat + SESSION_TTL_SECONDS, iat }));
  const sig = await hmacSha256Hex(payload, secret);
  return `${payload}.${sig}`;
}

function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function issuedSessionCookieWithIat(secret: string, iat: number): Promise<string> {
  return issueSessionWithIat(secret, iat).then((token) => sessionCookie(token, SESSION_TTL_SECONDS));
}

export function clearedSessionCookie(): string {
  return sessionCookie("", 0);
}

export async function verifySession(
  cookieValue: string,
  secret: string,
  minIat = 0,
): Promise<SessionPayload | null> {
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = await hmacSha256Hex(payload, secret);
  if (!constantTimeEqual(expected, sig.toLowerCase())) return null;
  const decoded = decodeBase64Url(payload);
  if (!decoded.ok) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decoded.value));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const exp = (parsed as { exp?: unknown }).exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp <= unixNow()) return null;
  const iatRaw = (parsed as { iat?: unknown }).iat;
  if (iatRaw !== undefined && (typeof iatRaw !== "number" || !Number.isFinite(iatRaw))) return null;
  const iat = typeof iatRaw === "number" ? iatRaw : undefined;
  if (minIat > 0 && (iat ?? 0) <= minIat) return null;
  return iat === undefined ? { exp } : { exp, iat };
}
