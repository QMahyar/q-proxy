import type { RouteHandler } from "../types/context";
import { ASSETS } from "../ui/assets";
import { htmlResponse } from "../core/respond";

const PANEL_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' https:; base-uri 'none'; form-action 'self'";

export const servePanelPage: RouteHandler = async () => {
  return htmlResponse(ASSETS.panel, 200, { "Cache-Control": "no-store", "Content-Security-Policy": PANEL_CSP });
};

export const serveLoginPage: RouteHandler = async () => {
  return htmlResponse(ASSETS.login, 200, { "Cache-Control": "no-store" });
};
