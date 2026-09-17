import type { RouteHandler } from "../types/context";
import { NotFoundError } from "../core/errors";
import { htmlResponse } from "../core/respond";
import { ASSETS } from "../ui/assets";

export const handleCamouflage: RouteHandler = async (_req, _env, s) => {
  if (s.camouflage.mode === "static") return htmlResponse(ASSETS.camo);
  throw new NotFoundError();
};
