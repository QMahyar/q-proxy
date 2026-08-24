import type { RouteHandler } from "../../types/context";
import type { PublicSettings, Settings } from "../../types/settings";
import { DEFAULT_SETTINGS, SENSITIVE_SETTING_PATHS } from "../../types/settings";
import { ValidationError } from "../../core/errors";
import { jsonOk } from "../../core/respond";
import { assertCsrf } from "../../auth/guard";
import { deepMergeDefaults } from "../../settings/migrate";
import { validateSettings } from "../../settings/validate";
import { saveSettings } from "../../settings/store";
import { readJsonObject } from "./auth";

export function publicSettingsView(s: Settings): PublicSettings & { hasPassword: boolean } {
  const view = structuredClone(s) as unknown as Record<string, unknown>;
  for (const path of SENSITIVE_SETTING_PATHS) delete view[path];
  view.hasPassword = s.passwordHash !== null;
  return view as PublicSettings & { hasPassword: boolean };
}

export const handleGetSettings: RouteHandler = async (_req, _env, s) => {
  return jsonOk(publicSettingsView(s));
};

export const handleSaveSettings: RouteHandler = async (req, env, s) => {
  assertCsrf(req);
  const body = await readJsonObject(req);
  for (const k of ["passwordHash", "passwordSalt", "sessionSecret", "securePath"]) delete (body as Record<string, unknown>)[k];
  const merged = deepMergeDefaults(s, body);
  const result = validateSettings(merged);
  if (!result.ok) throw new ValidationError(result.fields);
  await saveSettings(env, result.value);
  return jsonOk({ saved: true });
};

export const handleResetSettings: RouteHandler = async (req, env, s) => {
  assertCsrf(req);
  const fresh = structuredClone(DEFAULT_SETTINGS);
  fresh.securePath = s.securePath;
  fresh.passwordHash = s.passwordHash;
  fresh.passwordSalt = s.passwordSalt;
  fresh.sessionSecret = s.sessionSecret;
  fresh.language = s.language;
  fresh.vlessUuid = s.vlessUuid;
  fresh.vmessUuid = s.vmessUuid;
  fresh.trojanPassword = s.trojanPassword;
  fresh.ssPassword = s.ssPassword;
  fresh.vlessPath = s.vlessPath;
  fresh.vmessPath = s.vmessPath;
  fresh.trojanPath = s.trojanPath;
  fresh.ssPath = s.ssPath;
  await saveSettings(env, fresh);
  return jsonOk({ saved: true });
};
