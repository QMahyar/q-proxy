import { decodeBase64Url, encodeBase64Url } from "../utils/base64";
import { bytesToHex } from "../utils/bytes";
import { utf8Encode } from "../utils/bytes";
import { constantTimeEqual } from "../utils/random";
import { unixNow } from "../utils/time";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = "q_session";

export interface SessionPayload {
  exp: number;
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8Encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

export async function issueSession(secret: string): Promise<string> {
  const payload = encodeBase64Url(JSON.stringify({ exp: unixNow() + SESSION_TTL_SECONDS }));
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function issuedSessionCookie(secret: string): Promise<string> {
  return issueSession(secret).then((token) => sessionCookie(token, SESSION_TTL_SECONDS));
}

export function clearedSessionCookie(): string {
  return sessionCookie("", 0);
}

export async function verifySession(cookieValue: string, secret: string): Promise<SessionPayload | null> {
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = await hmacHex(payload, secret);
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
  return { exp };
}
