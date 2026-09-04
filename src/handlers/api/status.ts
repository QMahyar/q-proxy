import type { RouteHandler } from "../../types/context";
import type { SubFormat } from "../../core/ua";
import { ValidationError } from "../../core/errors";
import { audit } from "../../core/log";
import { jsonOk, readJsonObject } from "../../core/respond";
import { resolveHostname } from "../../core/routes";
import { readUsage } from "../../core/counters";
import { assertCsrf, clientIp } from "../../auth/guard";
import { appVersion, loadSettingsFresh, saveSettings } from "../../settings/store";
import { validateSettings } from "../../settings/validate";

export const handleStatus: RouteHandler = async (req, env, s) => {
  const usage = await readUsage(env);
  const colo = (req.cf as { colo?: string } | undefined)?.colo;
  return jsonOk({
    version: appVersion(),
    killSwitch: s.killSwitch,
    colo: colo ?? null,
    language: s.language,
    hasPassword: s.passwordHash !== null,
    usage: { requestsToday: usage.requestsToday, requestsTotal: usage.requestsTotal },
  });
};

export const handleKillSwitch: RouteHandler = async (req, env, _s) => {
  assertCsrf(req);
  const body = await readJsonObject(req);
  if (typeof body.enabled !== "boolean") {
    throw new ValidationError({ enabled: "must be a boolean" });
  }
  const fresh = await loadSettingsFresh(env);
  const v = validateSettings({ ...fresh, killSwitch: body.enabled });
  if (!v.ok) throw new ValidationError(v.fields);
  audit("killswitch", { ip: clientIp(req), enabled: body.enabled });
  const rev = await saveSettings(env, v.value);
  return jsonOk({ killSwitch: body.enabled, rev });
};

export interface SubUrlEntry {
  format: SubFormat;
  label: string;
  url: string;
}

export function buildSubUrls(hostname: string, securePath: string): SubUrlEntry[] {
  const base = `https://${hostname}/${securePath}/sub`;
  return [
    { format: "base64", label: "Base64/Mixed", url: base },
    { format: "clash", label: "Clash / mihomo", url: `${base}?target=clash` },
    { format: "singbox", label: "sing-box", url: `${base}?target=singbox` },
    { format: "surge", label: "Surge", url: `${base}?target=surge` },
    { format: "loon", label: "Loon", url: `${base}?target=loon` },
    { format: "quantumult", label: "Quantumult X", url: `${base}?target=quantumult` },
    { format: "base64", label: "Panel info", url: `${base}?view=html` },
  ];
}

export const handleSubUrls: RouteHandler = async (req, _env, s) => {
  const url = new URL(req.url);
  const hostname = resolveHostname(s, url);
  return jsonOk({ urls: buildSubUrls(hostname, s.securePath) });
};
