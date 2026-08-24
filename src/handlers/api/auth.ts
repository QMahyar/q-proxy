import type { RouteHandler } from "../../types/context";
import { BadRequestError, UnauthorizedError, ValidationError } from "../../core/errors";
import { jsonError, jsonOk } from "../../core/respond";
import { hashPassword, verifyPassword } from "../../auth/password";
import { clearedSessionCookie, issuedSessionCookie } from "../../auth/session";
import {
  assertLoginAllowed,
  clearLoginFailures,
  clientIp,
  recordLoginFailure,
} from "../../auth/guard";
import { loadSettingsFresh, saveSettings } from "../../settings/store";

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new BadRequestError("invalid json body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError("body must be a json object");
  }
  return parsed as Record<string, unknown>;
}

export const handleLogin: RouteHandler = async (req, _env, s) => {
  assertLoginAllowed(clientIp(req));
  const body = await readJsonObject(req);
  if (s.passwordHash === null || s.passwordSalt === null) {
    return jsonError(409, "SETUP_REQUIRED", "admin password is not configured yet");
  }
  const password = typeof body.password === "string" ? body.password : "";
  const ok = password.length > 0 && (await verifyPassword(password, s.passwordHash, s.passwordSalt));
  if (!ok) {
    recordLoginFailure(clientIp(req));
    throw new UnauthorizedError("invalid password");
  }
  clearLoginFailures(clientIp(req));
  return jsonOk({ hasPassword: true }, { "Set-Cookie": await issuedSessionCookie(s.sessionSecret) });
};

export const handleLogout: RouteHandler = async () => {
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
  await saveSettings(env, { ...structuredClone(fresh), passwordHash: hash, passwordSalt: salt });
  return jsonOk(
    { hasPassword: true },
    { "Set-Cookie": await issuedSessionCookie(fresh.sessionSecret) },
  );
};
