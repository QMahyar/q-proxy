import type { RouteHandler } from "../../types/context";
import { AppError } from "../../core/errors";
import { jsonOk } from "../../core/respond";
import { requireAuth } from "../../auth/guard";
import { tcpProbe } from "../../tunnel/proxyip-pool";
import { isLocalOrPrivateTarget } from "../../utils/net";
import { parseHostPort } from "../../utils/net";

const MAX_PROBES = 8;

export const handleAddressProbeApi: RouteHandler = requireAuth(async (req, _env, s) => {
  if (req.method !== "GET") throw new AppError("method not allowed", 405, "METHOD");
  const url = new URL(req.url);
  const defaultPort = typeof s.defaultPort === "number" && s.defaultPort > 0 ? s.defaultPort : 443;
  const list = s.addresses && s.addresses.length > 0 ? s.addresses : [{ address: url.hostname }];
  const results: Array<{ ip: string; port: number; label: string; status: "ok" | "fail"; latencyMs: number | null }> = [];
  for (const a of list.slice(0, MAX_PROBES)) {
    if (a.enabled === false) continue;
    const hp = parseHostPort(String(a.address ?? "").trim(), typeof a.port === "number" && a.port > 0 ? a.port : defaultPort);
    if (hp === null || hp.host.length === 0) continue;
    if (isLocalOrPrivateTarget(hp.host)) {
      results.push({ ip: hp.host, port: hp.port, label: a.label || a.address || hp.host, status: "fail", latencyMs: null });
      continue;
    }
    const latencyMs = await tcpProbe(hp.host, hp.port);
    results.push({
      ip: hp.host,
      port: hp.port,
      label: a.label || a.address || hp.host,
      status: latencyMs === null ? "fail" : "ok",
      latencyMs,
    });
  }
  return jsonOk({ results });
});
