import type { RouteHandler } from "../../types/context";
import { AppError } from "../../core/errors";
import { jsonOk } from "../../core/respond";
import { requireAuth } from "../../auth/guard";
import { collectProxyPoolDetailed, tcpProbe } from "../../tunnel/proxyip-pool";

const MAX_PROBES = 8;

interface PoolApiEntry {
  ip: string;
  port: number;
}

interface ProbeOutcome {
  ip: string;
  port: number;
  status: "ok" | "fail";
  latencyMs: number | null;
}

function requestColo(req: Request): string {
  const cf = req.cf as { colo?: string } | undefined;
  return (cf?.colo ?? "").trim().toLowerCase();
}

export const handleProxyPoolApi: RouteHandler = requireAuth(async (req, _env, s) => {
  if (req.method !== "GET") throw new AppError("method not allowed", 405, "METHOD");
  const url = new URL(req.url);
  const colo = (url.searchParams.get("colo") ?? "").trim().toLowerCase() || requestColo(req);
  const { endpoints, source } = await collectProxyPoolDetailed(s, colo);
  const pool: PoolApiEntry[] = endpoints.map((e) => ({ ip: e.ip, port: e.port }));
  if (url.searchParams.get("probe") !== "1") {
    return jsonOk({ pool, source });
  }
  const probe: ProbeOutcome[] = [];
  for (const ep of endpoints.slice(0, MAX_PROBES)) {
    const latencyMs = await tcpProbe(ep.ip, ep.port);
    probe.push({ ip: ep.ip, port: ep.port, status: latencyMs === null ? "fail" : "ok", latencyMs });
  }
  return jsonOk({ pool, source, probe });
});
