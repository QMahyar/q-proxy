import type { Env } from "../types/env";
import type { Settings } from "../types/settings";
import { AppError, UnauthorizedError } from "./errors";
import { redirect } from "./respond";
import { setDebugEnabled } from "./log";
import { recordConnection } from "./counters";
import { identifyTunnel, resolveSecureRoute, splitPath, type ApiRouteName, type SecureRoute } from "./routes";
import { loadSettings } from "../settings/store";
import { assertCsrf, getSession, requireAuth } from "../auth/guard";
import { getSessionFloor, verifySession } from "../auth/session";
import type { RouteHandler } from "../types/context";
import { handleTunnel } from "../handlers/tunnel";
import { handleDoh } from "../handlers/doh";
import { handleSubscribe } from "../handlers/subscribe";
import { handleMyIp } from "../handlers/myip";
import { handleRobots } from "../handlers/robots";

import { serveLoginPage, servePanelPage } from "../handlers/panel-page";
import { handleCamouflage } from "../handlers/camouflage";
import { handleWarpSub } from "../handlers/warp-sub";
import { handleUserSub } from "../handlers/users-sub";
import { handleLogin, handleLogout, handlePasswordChange, handleSetup } from "../handlers/api/auth";
import {
  handleGetSettings,
  handleResetSettings,
  handleSaveSettings,
  handleExportSettings,
  handleImportSettings,
} from "../handlers/api/settings";
import { handleKillSwitch, handleStatus, handleSubUrls } from "../handlers/api/status";
import { handleBootstrap } from "../handlers/api/bootstrap";
import { handleWarpApi } from "../handlers/api/warp";
import { handleUsersApi } from "../handlers/api/users";
import { handleTelegramRemove, handleTelegramSetup, handleTelegramWebhook } from "../handlers/api/telegram";
import { handleVersionCheck } from "../handlers/api/version";

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
  return authed(async (req, env, s) => {
    assertCsrf(req);
    return handler(req, env, s);
  });
}

function csrfOnly(handler: RouteHandler): RouteHandler {
  return async (req, env, s) => {
    assertCsrf(req);
    return handler(req, env, s);
  };
}

function withSessionFloor(handler: RouteHandler): RouteHandler {
  return async (req, env, s) => {
    const raw = getSession(req);
    if (raw === null) return handler(req, env, s);
    const floor = await getSessionFloor(env);
    if (floor > 0 && (await verifySession(raw, s.sessionSecret, floor)) === null) {
      throw new UnauthorizedError();
    }
    return handler(req, env, s);
  };
}

function authed(handler: RouteHandler): RouteHandler {
  return requireAuth(withSessionFloor(handler));
}

const guardedSaveSettings = authedCsrf(handleSaveSettings);
const guardedResetSettings = authedCsrf(handleResetSettings);
const guardedStatus = authed(handleStatus);
const guardedKillSwitch = authedCsrf(handleKillSwitch);
const guardedSubUrls = authed(handleSubUrls);
const guardedMyIp = authed(handleMyIp);

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
      return csrfOnly(handleLogout)(req, env, s);
    case "auth-setup":
      expectMethods(req, ["POST"]);
      return handleSetup(req, env, s);
    case "auth-password":
      expectMethods(req, ["POST"]);
      return authedCsrf(handlePasswordChange)(req, env, s);
    case "settings-get":
      if (req.method === "GET") return authed(handleGetSettings)(req, env, s);
      expectMethods(req, ["PUT"]);
      return guardedSaveSettings(req, env, s);
    case "bootstrap":
      expectMethods(req, ["GET"]);
      return authed(handleBootstrap)(req, env, s);
    case "settings-save":
      expectMethods(req, ["PUT"]);
      return guardedSaveSettings(req, env, s);
    case "settings-reset":
      expectMethods(req, ["POST"]);
      return guardedResetSettings(req, env, s);
    case "settings-export":
      expectMethods(req, ["GET"]);
      return authed(handleExportSettings)(req, env, s);
    case "settings-import":
      expectMethods(req, ["POST"]);
      return authedCsrf(handleImportSettings)(req, env, s);
    case "version-check":
      expectMethods(req, ["GET"]);
      return authed(handleVersionCheck)(req, env, s);
    case "status":
      expectMethods(req, ["GET"]);
      return guardedStatus(req, env, s);
    case "killswitch":
      expectMethods(req, ["POST"]);
      return guardedKillSwitch(req, env, s);
    case "suburls":
      expectMethods(req, ["GET"]);
      return guardedSubUrls(req, env, s);
    case "warp":
      return authed(handleWarpApi)(req, env, s);
    case "users":
      return authed(handleUsersApi)(req, env, s);
    case "telegram-webhook":
      expectMethods(req, ["POST"]);
      return handleTelegramWebhook(req, env, s);
    case "telegram-setup":
      expectMethods(req, ["POST"]);
      return authedCsrf(handleTelegramSetup)(req, env, s);
    case "telegram-remove":
      expectMethods(req, ["POST"]);
      return authedCsrf(handleTelegramRemove)(req, env, s);
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
    case "warp-sub":
      expectMethods(req, ["GET", "HEAD"]);
      return handleWarpSub(req, env, s);
    case "user-sub":
      expectMethods(req, ["GET", "HEAD"]);
      void recordConnection(env).catch(() => {});
      return handleUserSub(req, env, s);
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
    case "password":
      return { kind: "api", api: "auth-password" };
    default:
      return null;
  }
}

export async function routeRequest(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") methodNotAllowed();
  const url = new URL(req.url);

  if (url.pathname === "/robots.txt" && req.method === "GET") return handleRobots();

  const s = await loadSettings(env);
  setDebugEnabled(s.debugLogging);

  if (url.pathname === "/robots.txt") {
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
