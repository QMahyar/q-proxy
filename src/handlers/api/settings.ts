import type { RouteHandler } from "../../types/context";
import type { PublicSettings, Settings } from "../../types/settings";
import { DEFAULT_SETTINGS, SENSITIVE_SETTING_PATHS, SETTINGS_VERSION } from "../../types/settings";
import { ValidationError } from "../../core/errors";
import { jsonOk } from "../../core/respond";
import { assertCsrf } from "../../auth/guard";
import { deepMergeDefaults } from "../../settings/migrate";
import { validateSettings } from "../../settings/validate";
import { saveSettings, settingsEtag } from "../../settings/store";
import { readJsonObject } from "./auth";

export function publicSettingsView(s: Settings): PublicSettings & { hasPassword: boolean } {
  const view = structuredClone(s) as unknown as Record<string, unknown>;
  for (const path of SENSITIVE_SETTING_PATHS) delete view[path];
  if (view.telegram !== null && typeof view.telegram === "object") {
    delete (view.telegram as Record<string, unknown>).botToken;
  }
  view.hasPassword = s.passwordHash !== null;
  return view as PublicSettings & { hasPassword: boolean };
}

export const handleGetSettings: RouteHandler = async (req, _env, s) => {
  const etag = settingsEtag();
  if (etag !== null && req.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const headers: Record<string, string> = {};
  if (etag !== null) headers["ETag"] = etag;
  return jsonOk(publicSettingsView(s), headers);
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

export const handleExportSettings: RouteHandler = async (_req, _env, s) => {
  const view = structuredClone(s) as unknown as Record<string, unknown>;
  for (const path of [...SENSITIVE_SETTING_PATHS, "securePath"]) delete view[path];
  if (view.telegram !== null && typeof view.telegram === "object") {
    delete (view.telegram as Record<string, unknown>).botToken;
  }
  const body = JSON.stringify({ kind: "q-proxy-settings", version: SETTINGS_VERSION, exportedAt: new Date().toISOString(), settings: view }, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="q-proxy-settings-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
};

export const handleImportSettings: RouteHandler = async (req, env, s) => {
  assertCsrf(req);
  const body = await readJsonObject(req);
  const incoming = (body as Record<string, unknown>).settings;
  if (incoming === null || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new ValidationError({ settings: "must be an exported settings object" });
  }
  const blob = incoming as Record<string, unknown>;
  if (typeof blob.version === "number" && blob.version > SETTINGS_VERSION) {
    throw new ValidationError({ settings: `exported by a newer version (${blob.version} > ${SETTINGS_VERSION})` });
  }
  for (const k of ["passwordHash", "passwordSalt", "sessionSecret", "securePath", "version", "updatedAt"]) delete blob[k];
  const merged = deepMergeDefaults(structuredClone(DEFAULT_SETTINGS), blob);
  merged.securePath = s.securePath;
  merged.passwordHash = s.passwordHash;
  merged.passwordSalt = s.passwordSalt;
  merged.sessionSecret = s.sessionSecret;
  merged.vlessUuid = s.vlessUuid;
  merged.vmessUuid = s.vmessUuid;
  merged.trojanPassword = s.trojanPassword;
  merged.ssPassword = s.ssPassword;
  merged.vlessPath = s.vlessPath;
  merged.vmessPath = s.vmessPath;
  merged.trojanPath = s.trojanPath;
  merged.ssPath = s.ssPath;
  const result = validateSettings(merged);
  if (!result.ok) throw new ValidationError(result.fields);
  await saveSettings(env, result.value);
  return jsonOk({ saved: true, imported: publicSettingsView(result.value) });
};
