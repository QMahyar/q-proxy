import type { RouteHandler } from "../types/context";
import { ASSETS } from "../ui/assets";
import { htmlResponse } from "../core/respond";

export const servePanelPage: RouteHandler = async () => {
  return htmlResponse(ASSETS.panel, 200, { "Cache-Control": "private, max-age=60" });
};

export const serveLoginPage: RouteHandler = async () => {
  return htmlResponse(ASSETS.login, 200, { "Cache-Control": "private, max-age=60" });
};
