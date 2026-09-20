import type { RouteHandler } from "../../types/context";
import { jsonOk, readJsonObject } from "../../core/respond";
import { requireAuth } from "../../auth/guard";
import { parseForeignLists } from "../../subscription/foreign";

export const handleSubImport: RouteHandler = requireAuth(async (req) => {
  const body = await readJsonObject(req);
  const text = typeof body.text === "string" ? body.text : "";
  return jsonOk({ sources: parseForeignLists(text) });
});
