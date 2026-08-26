import type { RouteHandler } from "../../types/context";
import { jsonOk } from "../../core/respond";
import { resolveHostname } from "../../core/routes";
import { readUsage } from "../../core/counters";
import { appVersion, settingsEtag } from "../../settings/store";
import { publicSettingsView } from "./settings";
import { buildSubUrls } from "./status";

export const handleBootstrap: RouteHandler = async (req, env, s) => {
  const etag = settingsEtag();
  if (etag !== null && req.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const url = new URL(req.url);
  const hostname = resolveHostname(s, url);
  const colo = (req.cf as { colo?: string } | undefined)?.colo;
  const usage = await readUsage(env);
  const headers: Record<string, string> = {};
  if (etag !== null) headers["ETag"] = etag;
  return jsonOk(
    {
      settings: publicSettingsView(s),
      status: {
        version: appVersion(),
        killSwitch: s.killSwitch,
        colo: colo ?? null,
        language: s.language,
        hasPassword: s.passwordHash !== null,
        usage: { requestsToday: usage.requestsToday, requestsTotal: usage.requestsTotal },
      },
      subUrls: { urls: buildSubUrls(hostname, s.securePath) },
    },
    headers,
  );
};
