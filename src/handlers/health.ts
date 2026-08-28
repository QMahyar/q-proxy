import type { RouteHandler } from "../types/context";
import { appVersion } from "../settings/store";

export const handleHealth: RouteHandler = async (req) => {
  const cf = req.cf as { colo?: string } | undefined;
  const colo = cf?.colo ?? null;
  const body = JSON.stringify({ ok: true, version: appVersion(), colo });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
