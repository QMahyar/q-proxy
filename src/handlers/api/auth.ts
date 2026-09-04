import type { Env } from "../../types/env";
import type { Settings } from "../../types/settings";
import type { RouteHandler } from "../../types/context";
import { UnauthorizedError, ValidationError } from "../../core/errors";
import { jsonError, jsonOk, readJsonObject } from "../../core/respond";
import { log } from "../../core/log";
import { decodeBase64Url, encodeBase64Url } from "../../utils/base64";
import { bytesToHex, utf8Encode } from "../../utils/bytes";
import { hmacSha256Hex } from "../../utils/hmac";
import { constantTimeEqual } from "../../utils/random";
import { hashPassword, verifyPassword } from "../../auth/password";
import {
  bumpSessionFloor,
  clearedSessionCookie,
  getSessionFloor,
  issuedSessionCookieWithIat,
  verifySession,
} from "../../auth/session";
import { unixNow } from "../../utils/time";
import {
  assertLoginAllowed,
  clearLoginThrottle,
  clientIp,
  getSession,
  recordLoginFailure,
} from "../../auth/guard";
import { loadSettingsFresh, saveSettings } from "../../settings/store";
import { validateSettings } from "../../settings/validate";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_WINDOW = 1;
export const TOTP_DIGITS = 6;
export const PRE_AUTH_TTL_SECONDS = 300;
export const PRE_AUTH_COOKIE_NAME = "q_totp";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PRE_AUTH_VERSION = "tp1";
const PRE_AUTH_COOKIE_RE = /(?:^|;\s*)q_totp=([^;\s]+)/;

export function base32Decode(input: string): Uint8Array | null {
  const clean = input.trim().toUpperCase().replace(/[\s-]+/g, "").replace(/=+$/, "");
  if (clean.length < 16 || clean.length > 128 || !/^[A-Z2-7]+$/.test(clean)) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    acc = (acc << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

async function hotpToken(key: Uint8Array, counter: number, digits: number): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c % 256;
    c = Math.floor(c / 256);
  }
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
  const offset = sig[sig.length - 1]! & 0x0f;
  const code =
    ((sig[offset]! & 0x7f) << 24) |
    (sig[offset + 1]! << 16) |
    (sig[offset + 2]! << 8) |
    sig[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

export interface TotpVerifyOptions {
  nowMs?: number;
  window?: number;
  digits?: number;
}

export async function totpVerify(secret: string, code: string, opts: TotpVerifyOptions = {}): Promise<boolean> {
  const digits = opts.digits ?? TOTP_DIGITS;
  const window = opts.window ?? TOTP_WINDOW;
  const normalized = code.replace(/[\s-]+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return false;
  const key = base32Decode(secret);
  if (key === null) return false;
  const counter = Math.floor(Math.floor(opts.nowMs ?? Date.now()) / 1000 / TOTP_STEP_SECONDS);
  for (let d = -window; d <= window; d++) {
    const c = counter + d;
    if (c < 0) continue;
    if (constantTimeEqual(await hotpToken(key, c, digits), normalized)) return true;
  }
  return false;
}

function normalizeRecoveryCode(code: string): string | null {
  const clean = code.trim().replace(/[\s-]+/g, "").toUpperCase();
  return clean.length > 0 ? clean : null;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const clean = normalizeRecoveryCode(code);
  if (clean === null) return "";
  const digest = await crypto.subtle.digest("SHA-256", utf8Encode(clean));
  return bytesToHex(new Uint8Array(digest));
}

function preAuthCookie(token: string, maxAge: number): string {
  return `${PRE_AUTH_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearedPreAuthCookie(): string {
  return preAuthCookie("", 0);
}

async function issuePreAuthCookie(secret: string): Promise<string> {
  const now = unixNow();
  const payload = encodeBase64Url(JSON.stringify({ typ: "totp-pre", exp: now + PRE_AUTH_TTL_SECONDS, iat: now }));
  const sig = await hmacSha256Hex(`${PRE_AUTH_VERSION}.${payload}`, secret);
  return preAuthCookie(`${PRE_AUTH_VERSION}.${payload}.${sig}`, PRE_AUTH_TTL_SECONDS);
}

function getPreAuth(req: Request): string | null {
  const header = req.headers.get("Cookie") ?? "";
  const m = PRE_AUTH_COOKIE_RE.exec(header);
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

async function verifyPreAuth(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PRE_AUTH_VERSION) return false;
  const payload = parts[1]!;
  const sig = parts[2]!;
  const expected = await hmacSha256Hex(`${PRE_AUTH_VERSION}.${payload}`, secret);
  if (!constantTimeEqual(expected, sig.toLowerCase())) return false;
  const decoded = decodeBase64Url(payload);
  if (!decoded.ok) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decoded.value));
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const rec = parsed as Record<string, unknown>;
  if (rec.typ !== "totp-pre") return false;
  const exp = rec.exp;
  const iat = rec.iat;
  if (typeof exp !== "number" || typeof iat !== "number" || !Number.isFinite(exp) || !Number.isFinite(iat)) return false;
  const now = unixNow();
  if (exp <= now || iat > now + 60 || exp <= iat || exp - iat > PRE_AUTH_TTL_SECONDS) return false;
  return true;
}

async function verifySecondFactor(env: Env, s: Settings, code: string): Promise<boolean> {
  if (await totpVerify(s.totp.secret, code)) return true;
  const digest = await hashRecoveryCode(code);
  if (digest.length === 0) return false;
  const fresh = await loadSettingsFresh(env);
  const at = fresh.totp.recoveryCodes.findIndex((h) => constantTimeEqual(h, digest));
  if (at < 0) return false;
  const remaining = fresh.totp.recoveryCodes.filter((_, i) => i !== at);
  const v = validateSettings({ ...structuredClone(fresh), totp: { ...fresh.totp, recoveryCodes: remaining } });
  if (!v.ok) return false;
  await saveSettings(env, v.value);
  return true;
}

async function upgradeLegacyHash(env: Env, password: string, pepper: string): Promise<void> {
  try {
    const fresh = await loadSettingsFresh(env);
    if (fresh.passwordHash === null || fresh.passwordSalt === null) return;
    const verified = await verifyPassword(password, fresh.passwordHash, fresh.passwordSalt, pepper);
    if (verified.tier !== "legacy") return;
    const { hash, salt } = await hashPassword(password, pepper);
    const v = validateSettings({ ...structuredClone(fresh), passwordHash: hash, passwordSalt: salt });
    if (!v.ok) return;
    await saveSettings(env, v.value);
  } catch (err) {
    log.debug("auth", "legacy hash upgrade failed", String(err));
  }
}

export const handleLogin: RouteHandler = async (req, env, s) => {
  const ip = clientIp(req);
  await assertLoginAllowed(env, ip);
  const body = await readJsonObject(req);
  if (s.passwordHash === null || s.passwordSalt === null) {
    return jsonError(409, "SETUP_REQUIRED", "admin password is not configured yet");
  }
  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.totp === "string" ? body.totp : "";
  const totpOn = s.totp.enabled && s.totp.secret.length > 0;
  if (password.length > 0) {
    const verified = await verifyPassword(password, s.passwordHash, s.passwordSalt, s.sessionSecret);
    if (!verified.ok) {
      await recordLoginFailure(env, ip);
      throw new UnauthorizedError("invalid password");
    }
    if (verified.tier === "legacy") await upgradeLegacyHash(env, password, s.sessionSecret);
    if (totpOn && code.length === 0) {
      return jsonOk({ totpRequired: true }, { "Set-Cookie": await issuePreAuthCookie(s.sessionSecret) });
    }
    if (totpOn) {
      const secondOk = await verifySecondFactor(env, s, code);
      if (!secondOk) {
        await recordLoginFailure(env, ip);
        throw new UnauthorizedError("invalid verification code");
      }
    }
    await clearLoginThrottle(env, ip);
    const floor = await getSessionFloor(env);
    const res = jsonOk(
      { hasPassword: true },
      { "Set-Cookie": await issuedSessionCookieWithIat(s.sessionSecret, Math.max(unixNow(), floor + 1)) },
    );
    if (totpOn) res.headers.append("Set-Cookie", clearedPreAuthCookie());
    return res;
  }
  if (code.length > 0 && totpOn) {
    const pre = getPreAuth(req);
    if (pre === null || !(await verifyPreAuth(pre, s.sessionSecret))) {
      throw new UnauthorizedError("verification expired, sign in again");
    }
    const secondOk = await verifySecondFactor(env, s, code);
    if (!secondOk) {
      await recordLoginFailure(env, ip);
      throw new UnauthorizedError("invalid verification code");
    }
    await clearLoginThrottle(env, ip);
    const floor = await getSessionFloor(env);
    const res = jsonOk(
      { hasPassword: true },
      { "Set-Cookie": await issuedSessionCookieWithIat(s.sessionSecret, Math.max(unixNow(), floor + 1)) },
    );
    res.headers.append("Set-Cookie", clearedPreAuthCookie());
    return res;
  }
  await recordLoginFailure(env, ip);
  throw new UnauthorizedError("invalid password");
};

export const handleLogout: RouteHandler = async (req, env, s) => {
  const raw = getSession(req);
  if (raw !== null) {
    const floor = await getSessionFloor(env);
    const session = await verifySession(raw, s.sessionSecret, floor);
    if (session !== null) await bumpSessionFloor(env);
  }
  return jsonOk({ loggedOut: true }, { "Set-Cookie": clearedSessionCookie() });
};

export const handleSetup: RouteHandler = async (req, env, s) => {
  const body = await readJsonObject(req);
  if (s.passwordHash !== null) {
    return jsonError(409, "ALREADY_SET", "admin password is already configured");
  }
  const fresh = await loadSettingsFresh(env);
  if (fresh.passwordHash !== null) {
    return jsonError(409, "ALREADY_SET", "admin password is already configured");
  }
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8) {
    throw new ValidationError({ newPassword: "must be at least 8 characters" });
  }
  const { hash, salt } = await hashPassword(newPassword, fresh.sessionSecret);
  const v = validateSettings({ ...structuredClone(fresh), passwordHash: hash, passwordSalt: salt });
  if (!v.ok) throw new ValidationError(v.fields);
  await saveSettings(env, v.value);
  return jsonOk(
    { hasPassword: true },
    { "Set-Cookie": await issuedSessionCookieWithIat(fresh.sessionSecret, unixNow() + 1) },
  );
};

export const handlePasswordChange: RouteHandler = async (req, env, _s) => {
  void _s;
  const body = await readJsonObject(req);
  const fresh = await loadSettingsFresh(env);
  if (fresh.passwordHash === null || fresh.passwordSalt === null) {
    throw new UnauthorizedError("invalid password");
  }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const currentOk =
    currentPassword.length > 0 &&
    (
      await verifyPassword(
        currentPassword,
        fresh.passwordHash,
        fresh.passwordSalt,
        fresh.sessionSecret,
      )
    ).ok;
  if (!currentOk) throw new UnauthorizedError("invalid password");
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8) {
    throw new ValidationError({ newPassword: "must be at least 8 characters" });
  }
  const { hash, salt } = await hashPassword(newPassword, fresh.sessionSecret);
  const v = validateSettings({ ...structuredClone(fresh), passwordHash: hash, passwordSalt: salt });
  if (!v.ok) throw new ValidationError(v.fields);
  await saveSettings(env, v.value);
  await bumpSessionFloor(env);
  const floor = await getSessionFloor(env);
  return jsonOk(
    { changed: true },
    { "Set-Cookie": await issuedSessionCookieWithIat(fresh.sessionSecret, floor + 1) },
  );
};
