import type { Env } from "../types/env";
import type { Settings } from "../types/settings";
import { AppError } from "./errors";
import { redirect } from "./respond";
import { setDebugEnabled } from "./log";
import { recordConnection } from "./counters";
import { identifyTunnel, resolveSecureRoute, splitPath, type ApiRouteName, type SecureRoute } from "./routes";
import { loadSettings } from "../settings/store";
import { requireAuth, assertCsrf } from "../auth/guard";
import type { RouteHandler } from "../types/context";
import { handleTunnel } from "../handlers/tunnel";
import { handleDoh } from "../handlers/doh";
import { handleSubscribe } from "../handlers/subscribe";
import { handleMyIp } from "../handlers/myip";
import { handleRobots } from "../handlers/robots";
import { serveLoginPage, servePanelPage } from "../handlers/panel-page";
import { handleCamouflage } from "../handlers/camouflage";
import { handleLogin, handleLogout, handleSetup } from "../handlers/api/auth";
import {
  handleGetSettings,
  handleResetSettings,
  handleSaveSettings,
} from "../handlers/api/settings";
import { handleKillSwitch, handleStatus, handleSubUrls } from "../handlers/api/status";

function methodNotAllowed(): never {
  throw new AppError("method not allowed", 405, "METHOD");
}

function expectMethods(req: Request, allowed: readonly string[]): void {
  if (!allowed.includes(req.method)) methodNotAllowed();
}

function isWebSocketUpgrade(req: Request): boolean {
  return (req.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

function killSwitchResponse(): Response {
  return new Response("service unavailable\n", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function authedCsrf(handler: RouteHandler): RouteHandler {
  return requireAuth(async (req, env, s) => {
    assertCsrf(req);
    return handler(req, env, s);
  });
}

const guardedSaveSettings = authedCsrf(handleSaveSettings);
const guardedResetSettings = authedCsrf(handleResetSettings);
const guardedStatus = requireAuth(handleStatus);
const guardedKillSwitch = authedCsrf(handleKillSwitch);
const guardedSubUrls = requireAuth(handleSubUrls);
const guardedMyIp = requireAuth(handleMyIp);

async function dispatchApi(
  api: ApiRouteName,
  req: Request,
  env: Env,
  s: Settings,
): Promise<Response> {
  if (req.method === "OPTIONS") methodNotAllowed();
  switch (api) {
    case "auth-login":
      expectMethods(req, ["POST"]);
      return handleLogin(req, env, s);
    case "auth-logout":
      expectMethods(req, ["POST"]);
      return handleLogout(req, env, s);
    case "auth-setup":
      expectMethods(req, ["POST"]);
      return handleSetup(req, env, s);
    case "settings-get":
      if (req.method === "GET") return requireAuth(handleGetSettings)(req, env, s);
      expectMethods(req, ["PUT"]);
      return guardedSaveSettings(req, env, s);
    case "settings-save":
      expectMethods(req, ["PUT"]);
      return guardedSaveSettings(req, env, s);
    case "settings-reset":
      expectMethods(req, ["POST"]);
      return guardedResetSettings(req, env, s);
    case "status":
      expectMethods(req, ["GET"]);
      return guardedStatus(req, env, s);
    case "killswitch":
      expectMethods(req, ["POST"]);
      return guardedKillSwitch(req, env, s);
    case "suburls":
      expectMethods(req, ["GET"]);
      return guardedSubUrls(req, env, s);
  }
}

async function dispatchSecureRoute(
  route: SecureRoute,
  req: Request,
  env: Env,
  s: Settings,
): Promise<Response> {
  switch (route.kind) {
    case "root":
      expectMethods(req, ["GET"]);
      return redirect(`/${s.securePath}/panel`, 302);
    case "page":
      expectMethods(req, ["GET"]);
      return route.page === "panel" ? servePanelPage(req, env, s) : serveLoginPage(req, env, s);
    case "doh":
      return handleDoh(req, env, s);
    case "sub":
      expectMethods(req, ["GET"]);
      void recordConnection(env).catch(() => {});
      return handleSubscribe(req, env, s);
    case "myip":
      expectMethods(req, ["GET"]);
      return guardedMyIp(req, env, s);
    case "api":
      return dispatchApi(route.api, req, env, s);
  }
}

function resolveAuthAlias(url: URL, s: Settings): SecureRoute | null {
  const segs = splitPath(url.pathname);
  if (segs.length !== 4 || segs[0] !== s.securePath || segs[1] !== "api" || segs[2] !== "auth") {
    return null;
  }
  switch (segs[3]) {
    case "login":
      return { kind: "api", api: "auth-login" };
    case "logout":
      return { kind: "api", api: "auth-logout" };
    case "setup":
      return { kind: "api", api: "auth-setup" };
    default:
      return null;
  }
}

export async function routeRequest(req: Request, env: Env): Promise<Response> {
  const s = await loadSettings(env);
  setDebugEnabled(s.debugLogging);
  const url = new URL(req.url);

  if (req.method === "OPTIONS") methodNotAllowed();

  if (url.pathname === "/robots.txt") {
    if (req.method === "GET") return handleRobots(req, env, s);
    return handleCamouflage(req, env, s);
  }

  if (identifyTunnel(url.pathname, s) !== null) {
    if (!isWebSocketUpgrade(req)) return handleCamouflage(req, env, s);
    if (s.killSwitch) return killSwitchResponse();
    void recordConnection(env).catch(() => {});
    return handleTunnel(req, env, s);
  }

  const route = resolveSecureRoute(url, s) ?? resolveAuthAlias(url, s);
  if (route !== null) return dispatchSecureRoute(route, req, env, s);

  return handleCamouflage(req, env, s);
}
