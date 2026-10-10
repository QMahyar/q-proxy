import type { RouteHandler } from "../../types/context";
import { jsonOk } from "../../core/respond";
import { readAccessEvents } from "../../log/access";

function positiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

// Paginated subscription access log. Read-only; page/limit are clamped
// (limit max 100) and always echoed back.
export const handleAccessLog: RouteHandler = async (req, env) => {
  const query = new URL(req.url).searchParams;
  const viewed = await readAccessEvents(env, positiveInt(query.get("page"), 1), positiveInt(query.get("limit"), 20));
  return jsonOk(viewed);
};
