import type { RouteHandler } from "../../types/context";
import type { Settings } from "../../types/settings";
import { ValidationError } from "../../core/errors";
import { jsonOk, readJsonObject } from "../../core/respond";
import { clientIp } from "../../auth/guard";
import { audit } from "../../core/log";
import { deepMergeDefaults } from "../../settings/migrate";
import { loadSettingsFresh, saveSettings } from "../../settings/store";
import { validateSettings } from "../../settings/validate";
import { fetchCfUsage } from "../../cf/usage";

export function isCfConfigured(s: Pick<Settings, "cf">): boolean {
  if (s.cf.usageApiUrl.trim().length > 0) return true;
  if (s.cf.accountId.trim().length === 0) return false;
  if (s.cf.apiToken.trim().length > 0) return true;
  return s.cf.email.trim().length > 0 && s.cf.globalApiKey.trim().length > 0;
}

// GET reads the cached snapshot; POST optionally applies a `cf` patch
// (validated) then refreshes from Cloudflare and persists the snapshot.
// Unconfigured or failed refreshes answer 200 with `refreshed: false` so the
// panel can show a hint instead of an error toast. Keys never leave the
// server: responses carry only the snapshot and static reasons.
export const handleCfUsage: RouteHandler = async (req, env, s, ctx) => {
  void s;
  if (req.method === "GET") {
    const fresh = await loadSettingsFresh(env);
    return jsonOk({ cfUsage: fresh.cfUsage, configured: isCfConfigured(fresh) });
  }
  const body = await readJsonObject(req);
  let base = await loadSettingsFresh(env);
  const patch = (body as Record<string, unknown>).cf;
  if (patch !== undefined) {
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      throw new ValidationError({ cf: "must be an object" });
    }
    const merged = deepMergeDefaults(base, { cf: patch });
    const v = validateSettings(merged);
    if (!v.ok) throw new ValidationError(v.fields);
    await saveSettings(env, v.value);
    base = v.value;
  }
  if (!isCfConfigured(base)) {
    return jsonOk({ cfUsage: base.cfUsage, refreshed: false, configured: false });
  }
  const fetched = await fetchCfUsage(base);
  if (!fetched.ok) {
    audit("cf-usage.refresh-failed", { ip: clientIp(req), reason: fetched.reason }, undefined, ctx);
    return jsonOk({ cfUsage: base.cfUsage, refreshed: false, configured: true, reason: fetched.reason });
  }
  const next = validateSettings({ ...structuredClone(base), cfUsage: fetched.value });
  if (!next.ok) throw new ValidationError(next.fields);
  await saveSettings(env, next.value);
  audit("cf-usage.refresh", { ip: clientIp(req) }, undefined, ctx);
  return jsonOk({ cfUsage: next.value.cfUsage, refreshed: true, configured: true });
};
