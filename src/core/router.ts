import type { Env } from "../types/env";
import type { Settings } from "../types/settings";
import { AppError } from "./errors";
import { redirect } from "./respond";
import { setDebugEnabled, log } from "./log";
import { recordConnection } from "./counters";
import {
  HEALTHZ_PATH,
  identifyTunnel,
  resolveSecureRoute,
  type ApiRouteName,
  type SecureRoute,
} from "./routes";
import { loadSettings } from "../settings/store";
import { assertCsrf, requireAuth } from "../auth/guard";
import type { RouteHandler } from "../types/context";
import { handleTunnel } from "../handlers/tunnel";
import { isUpgradeRequest } from "../tunnel/websocket";
import { handleDoh } from "../handlers/doh";
import { handleSubscribe } from "../handlers/subscribe";
import { handleMyIp } from "../handlers/myip";
import { handleRobots } from "../handlers/robots";
import { handleHealth } from "../handlers/health";

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
import { handleProxyPoolApi } from "../handlers/api/proxy-pool";
import { handleAddressProbeApi } from "../handlers/api/address-probe";
import { handleTelegramRemove, handleTelegramSetup, handleTelegramWebhook } from "../handlers/api/telegram";
import { handleVersionCheck } from "../handlers/api/version";

function methodNotAllowed(): never {
  throw new AppError("method not allowed", 405, "METHOD");
}

function expectMethods(req: Request, allowed: readonly string[]): void {
  if (!allowed.includes(req.method)) methodNotAllowed();
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

function authed(handler: RouteHandler): RouteHandler {
  return requireAuth(handler);
}

type ApiAuthLevel = "none" | "read" | "write";

interface ApiRouteDescriptor {
  methods: string[];
  auth: ApiAuthLevel;
  handler: RouteHandler;
}

const guardedMyIp = authed(handleMyIp);

const settingsGetOrSave: RouteHandler = (req, env, s) =>
  req.method === "GET" ? handleGetSettings(req, env, s) : handleSaveSettings(req, env, s);

const API_ROUTES: Record<ApiRouteName, ApiRouteDescriptor> = {
  "auth-login": { methods: ["POST"], auth: "none", handler: handleLogin },
  "auth-logout": { methods: ["POST"], auth: "none", handler: csrfOnly(handleLogout) },
  "auth-setup": { methods: ["POST"], auth: "none", handler: csrfOnly(handleSetup) },
  "auth-password": { methods: ["POST"], auth: "write", handler: handlePasswordChange },
  "settings-get": { methods: ["GET", "PUT"], auth: "write", handler: settingsGetOrSave },
  bootstrap: { methods: ["GET"], auth: "read", handler: handleBootstrap },
  "settings-save": { methods: ["PUT"], auth: "write", handler: handleSaveSettings },
  "settings-reset": { methods: ["POST"], auth: "write", handler: handleResetSettings },
  "settings-export": { methods: ["GET"], auth: "read", handler: handleExportSettings },
  "settings-import": { methods: ["POST"], auth: "write", handler: handleImportSettings },
  "version-check": { methods: ["GET"], auth: "read", handler: handleVersionCheck },
  status: { methods: ["GET"], auth: "read", handler: handleStatus },
  killswitch: { methods: ["POST"], auth: "write", handler: handleKillSwitch },
  suburls: { methods: ["GET"], auth: "read", handler: handleSubUrls },
  warp: { methods: [], auth: "write", handler: handleWarpApi },
  users: { methods: [], auth: "write", handler: handleUsersApi },
  "proxy-pool": { methods: [], auth: "write", handler: handleProxyPoolApi },
  "address-probe": { methods: [], auth: "write", handler: handleAddressProbeApi },
  "telegram-webhook": { methods: ["POST"], auth: "none", handler: handleTelegramWebhook },
  "telegram-setup": { methods: ["POST"], auth: "write", handler: handleTelegramSetup },
  "telegram-remove": { methods: ["POST"], auth: "write", handler: handleTelegramRemove },
};

async function dispatchApi(
  api: ApiRouteName,
  req: Request,
  env: Env,
  s: Settings,
): Promise<Response> {
  const route = API_ROUTES[api]!;
  if (route.methods.length > 0) expectMethods(req, route.methods);
  if (route.auth === "none") return route.handler(req, env, s);
  if (route.auth === "read" || req.method === "GET") return authed(route.handler)(req, env, s);
  return authedCsrf(route.handler)(req, env, s);
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
      void recordConnection(env).catch((err: unknown) => log.error("counters", "record failed", String(err)));
      return handleSubscribe(req, env, s);
    case "warp-sub":
      expectMethods(req, ["GET", "HEAD"]);
      return handleWarpSub(req, env, s);
    case "user-sub":
      expectMethods(req, ["GET", "HEAD"]);
      void recordConnection(env).catch((err: unknown) => log.error("counters", "record failed", String(err)));
      return handleUserSub(req, env, s);
    case "myip":
      expectMethods(req, ["GET"]);
      return guardedMyIp(req, env, s);
    case "api":
      return dispatchApi(route.api, req, env, s);
  }
}

export async function routeRequest(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") methodNotAllowed();
  const url = new URL(req.url);

  if (url.pathname === "/robots.txt" && req.method === "GET") return handleRobots();
  if (url.pathname === HEALTHZ_PATH) {
    if (req.method !== "GET") methodNotAllowed();
    return handleHealth(req);
  }

  const s = await loadSettings(env);
  setDebugEnabled(s.debugLogging);

  if (url.pathname === "/robots.txt") {
    return handleCamouflage(req, env, s);
  }

  if (identifyTunnel(url.pathname, s) !== null) {
    if (!isUpgradeRequest(req)) return handleCamouflage(req, env, s);
    if (s.killSwitch) return killSwitchResponse();
    void recordConnection(env).catch((err: unknown) => log.error("counters", "record failed", String(err)));
    return handleTunnel(req, env, s);
  }

  const route = resolveSecureRoute(url, s);
  if (route !== null) return dispatchSecureRoute(route, req, env, s);

  return handleCamouflage(req, env, s);
}
