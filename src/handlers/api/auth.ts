import type { Env } from "../../types/env";
import type { RouteHandler } from "../../types/context";
import { UnauthorizedError, ValidationError } from "../../core/errors";
import { jsonError, jsonOk, readJsonObject } from "../../core/respond";
import { log } from "../../core/log";
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
  clearLoginFailures,
  clientIp,
  getSession,
  recordLoginFailure,
} from "../../auth/guard";
import { loadSettingsFresh, saveSettings } from "../../settings/store";
import { validateSettings } from "../../settings/validate";

async function upgradeLegacyHash(env: Env, password: string): Promise<void> {
  try {
    const fresh = await loadSettingsFresh(env);
    if (fresh.passwordHash === null || fresh.passwordSalt === null) return;
    const verified = await verifyPassword(password, fresh.passwordHash, fresh.passwordSalt);
    if (verified.tier !== "legacy") return;
    const { hash, salt } = await hashPassword(password);
    const v = validateSettings({ ...structuredClone(fresh), passwordHash: hash, passwordSalt: salt });
    if (!v.ok) return;
    await saveSettings(env, v.value);
  } catch (err) {
    log.debug("auth", "legacy hash upgrade failed", String(err));
  }
}

export const handleLogin: RouteHandler = async (req, env, s) => {
  assertLoginAllowed(clientIp(req));
  const body = await readJsonObject(req);
  if (s.passwordHash === null || s.passwordSalt === null) {
    return jsonError(409, "SETUP_REQUIRED", "admin password is not configured yet");
  }
  const password = typeof body.password === "string" ? body.password : "";
  const verified =
    password.length > 0 ? await verifyPassword(password, s.passwordHash, s.passwordSalt) : null;
  if (verified === null || !verified.ok) {
    recordLoginFailure(clientIp(req));
    throw new UnauthorizedError("invalid password");
  }
  clearLoginFailures(clientIp(req));
  if (verified.tier === "legacy") await upgradeLegacyHash(env, password);
  const floor = await getSessionFloor(env);
  return jsonOk(
    { hasPassword: true },
    { "Set-Cookie": await issuedSessionCookieWithIat(s.sessionSecret, Math.max(unixNow(), floor + 1)) },
  );
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
  const { hash, salt } = await hashPassword(newPassword);
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
    (await verifyPassword(currentPassword, fresh.passwordHash, fresh.passwordSalt)).ok;
  if (!currentOk) throw new UnauthorizedError("invalid password");
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8) {
    throw new ValidationError({ newPassword: "must be at least 8 characters" });
  }
  const { hash, salt } = await hashPassword(newPassword);
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
