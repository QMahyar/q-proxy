import type { RouteHandler } from "../../types/context";
import type { SubFormat } from "../../core/ua";
import { ValidationError } from "../../core/errors";
import { audit } from "../../core/log";
import { jsonOk, readJsonObject } from "../../core/respond";
import { resolveHostname } from "../../core/routes";
import { readUsage, type UsageWithBytes } from "../../core/counters";
import { assertCsrf, clientIp } from "../../auth/guard";
import { appVersion, loadSettingsFresh, saveSettings } from "../../settings/store";
import { validateSettings } from "../../settings/validate";

export interface UsageView {
  requestsToday: number;
  requestsTotal: number;
  bytesUpTotal: number;
  bytesDownTotal: number;
  estimated: true;
}

export function usageView(usage: UsageWithBytes): UsageView {
  return {
    requestsToday: usage.requestsToday,
    requestsTotal: usage.requestsTotal,
    bytesUpTotal: usage.bytesUpTotal,
    bytesDownTotal: usage.bytesDownTotal,
    estimated: true,
  };
}

export const handleStatus: RouteHandler = async (req, env, s) => {
  const usage = await readUsage(env);
  const colo = (req.cf as { colo?: string } | undefined)?.colo;
  return jsonOk({
    version: appVersion(),
    killSwitch: s.killSwitch,
    colo: colo ?? null,
    language: s.language,
    hasPassword: s.passwordHash !== null,
    usage: usageView(usage),
  });
};

export const handleKillSwitch: RouteHandler = async (req, env, _s, ctx) => {
  assertCsrf(req);
  const body = await readJsonObject(req);
  if (typeof body.enabled !== "boolean") {
    throw new ValidationError({ enabled: "must be a boolean" });
  }
  const fresh = await loadSettingsFresh(env);
  const v = validateSettings({ ...fresh, killSwitch: body.enabled });
  if (!v.ok) throw new ValidationError(v.fields);
  audit("killswitch", { ip: clientIp(req), enabled: body.enabled }, env, ctx);
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
    { format: "singbox", label: "sing-box", url: `${base}?target=singbox` },
    { format: "clash", label: "Clash/Mihomo", url: `${base}?target=clash` },
    { format: "base64", label: "Panel info", url: `${base}?view=html` },
  ];
}

export const handleSubUrls: RouteHandler = async (req, _env, s) => {
  const url = new URL(req.url);
  const hostname = resolveHostname(s, url);
  return jsonOk({ urls: buildSubUrls(hostname, s.securePath) });
};
