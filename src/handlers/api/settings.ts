import type { RouteHandler } from "../../types/context";
import type { PublicSettings, Settings } from "../../types/settings";
import { DEFAULT_SETTINGS, SENSITIVE_SETTING_PATHS, SETTINGS_VERSION } from "../../types/settings";
import { ValidationError } from "../../core/errors";
import { jsonOk, readJsonObject } from "../../core/respond";
import { deepMergeDefaults } from "../../settings/migrate";
import { validateSettings } from "../../settings/validate";
import { loadSettingsFresh, saveSettings, settingsEtag } from "../../settings/store";

const PRESERVED_FIELDS = [
  "securePath",
  "passwordHash",
  "passwordSalt",
  "sessionSecret",
  "language",
  "vlessUuid",
  "vmessUuid",
  "trojanPassword",
  "ssPassword",
  "vlessPath",
  "vmessPath",
  "trojanPath",
  "ssPath",
] as const satisfies readonly (keyof Settings)[];

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

export const handleSaveSettings: RouteHandler = async (req, _env, s) => {
  const body = await readJsonObject(req);
  for (const k of ["passwordHash", "passwordSalt", "sessionSecret", "securePath"]) delete (body as Record<string, unknown>)[k];
  const fresh = await loadSettingsFresh(_env);
  const merged = deepMergeDefaults(fresh, body);
  void s;
  const result = validateSettings(merged);
  if (!result.ok) throw new ValidationError(result.fields);
  const rev = await saveSettings(_env, result.value);
  return jsonOk({ saved: true, rev });
};

export const handleResetSettings: RouteHandler = async (_req, env, _s) => {
  const freshSrc = await loadSettingsFresh(env);
  void _s;
  const fresh = structuredClone(DEFAULT_SETTINGS);
  for (const key of PRESERVED_FIELDS) {
    (fresh as unknown as Record<string, unknown>)[key] = (freshSrc as unknown as Record<string, unknown>)[key];
  }
  const result = validateSettings(fresh);
  if (!result.ok) throw new ValidationError(result.fields);
  const rev = await saveSettings(env, result.value);
  return jsonOk({ saved: true, rev });
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
  const fresh = await loadSettingsFresh(env);
  void s;
  for (const key of PRESERVED_FIELDS) {
    (merged as unknown as Record<string, unknown>)[key] = (fresh as unknown as Record<string, unknown>)[key];
  }
  const result = validateSettings(merged);
  if (!result.ok) throw new ValidationError(result.fields);
  const rev = await saveSettings(env, result.value);
  return jsonOk({ saved: true, rev, imported: publicSettingsView(result.value) });
};
