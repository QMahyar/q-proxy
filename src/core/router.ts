import type { Settings } from "../types/settings";
import { AppError } from "./errors";
import { jsonError, redirect } from "./respond";
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
import { handleRobots } from "../handlers/robots";
import { handleHealth } from "../handlers/health";

import { serveLoginPage, servePanelPage } from "../handlers/panel-page";
import { handleCamouflage } from "../handlers/camouflage";
import { handleWarpSub } from "../handlers/warp-sub";
import { handleLogin, handleLogout, handlePasswordChange, handleSetup, handleAuthStatus } from "../handlers/api/auth";
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
import { handleProxyPoolApi } from "../handlers/api/proxy-pool";
import { handleAddressProbeApi } from "../handlers/api/address-probe";
import { handleTelegramRemove, handleTelegramSetup, handleTelegramWebhook } from "../handlers/api/telegram";

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
  return authed(async (req, env, s, ctx) => {
    assertCsrf(req);
    return handler(req, env, s, ctx);
  });
}

function csrfOnly(handler: RouteHandler): RouteHandler {
  return async (req, env, s, ctx) => {
    assertCsrf(req);
    return handler(req, env, s, ctx);
  };
}

function authed(handler: RouteHandler): RouteHandler {
  return requireAuth(handler);
}

type ApiAuthLevel = "none" | "read" | "write";
type BootstrapExemption = "allow" | "read";

interface ApiRouteDescriptor {
  methods: string[];
  auth: ApiAuthLevel;
  handler: RouteHandler;
  bootstrap?: BootstrapExemption;
}

function passwordChangeRequired(): Response {
  return jsonError(403, "PASSWORD_CHANGE_REQUIRED", "choose a personal admin password before using the panel");
}

function bootstrapAllowed(route: ApiRouteDescriptor, req: Request): boolean {
  if (route.bootstrap === "allow") return true;
  return route.bootstrap === "read" && req.method === "GET";
}

function bootstrapGated(handler: RouteHandler, route: ApiRouteDescriptor): RouteHandler {
  return async (req, env, s, ctx) => {
    if (s.passwordIsBootstrap && !bootstrapAllowed(route, req)) return passwordChangeRequired();
    return handler(req, env, s, ctx);
  };
}

const settingsGetOrSave: RouteHandler = (req, env, s, ctx) =>
  req.method === "GET" ? handleGetSettings(req, env, s, ctx) : handleSaveSettings(req, env, s, ctx);

const API_ROUTES: Record<ApiRouteName, ApiRouteDescriptor> = {
  "auth-login": { methods: ["POST"], auth: "none", handler: handleLogin },
  "auth-logout": { methods: ["POST"], auth: "none", handler: csrfOnly(handleLogout), bootstrap: "allow" },
  "auth-setup": { methods: ["POST"], auth: "none", handler: csrfOnly(handleSetup) },
  "auth-status": { methods: ["GET"], auth: "none", handler: handleAuthStatus },
  "auth-password": { methods: ["POST"], auth: "write", handler: handlePasswordChange, bootstrap: "allow" },
  "settings-get": { methods: ["GET", "PUT"], auth: "write", handler: settingsGetOrSave, bootstrap: "read" },
  bootstrap: { methods: ["GET"], auth: "read", handler: handleBootstrap, bootstrap: "allow" },
  "settings-save": { methods: ["PUT"], auth: "write", handler: handleSaveSettings },
  "settings-reset": { methods: ["POST"], auth: "write", handler: handleResetSettings },
  "settings-export": { methods: ["GET"], auth: "read", handler: handleExportSettings },
  "settings-import": { methods: ["POST"], auth: "write", handler: handleImportSettings },
  status: { methods: ["GET"], auth: "read", handler: handleStatus },
  killswitch: { methods: ["POST"], auth: "write", handler: handleKillSwitch },
  suburls: { methods: ["GET"], auth: "read", handler: handleSubUrls },
  warp: { methods: [], auth: "write", handler: handleWarpApi },
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
  ctx?: ExecutionContext | null,
): Promise<Response> {
  const route = API_ROUTES[api]!;
  if (route.methods.length > 0) expectMethods(req, route.methods);
  if (route.auth === "none") return route.handler(req, env, s, ctx);
  if (route.auth === "read" || req.method === "GET") {
    return authed(bootstrapGated(route.handler, route))(req, env, s, ctx);
  }
  return authedCsrf(bootstrapGated(route.handler, route))(req, env, s, ctx);
}

async function dispatchSecureRoute(
  route: SecureRoute,
  req: Request,
  env: Env,
  s: Settings,
  ctx?: ExecutionContext | null,
): Promise<Response> {
  switch (route.kind) {
    case "root":
      expectMethods(req, ["GET"]);
      return redirect(`/${s.securePath}/panel`, 302);
    case "page":
      expectMethods(req, ["GET"]);
      return route.page === "panel" ? servePanelPage(req, env, s, ctx) : serveLoginPage(req, env, s, ctx);
    case "doh":
      return handleDoh(req, env, s, ctx);
    case "sub":
      expectMethods(req, ["GET"]);
      void recordConnection(env, undefined, ctx).catch((err: unknown) => log.error("counters", "record failed", String(err)));
      return handleSubscribe(req, env, s, ctx);
    case "warp-sub":
      expectMethods(req, ["GET", "HEAD"]);
      return handleWarpSub(req, env, s, ctx);
    case "api":
      return dispatchApi(route.api, req, env, s, ctx);
  }
}

export async function routeRequest(req: Request, env: Env, ctx?: ExecutionContext | null): Promise<Response> {
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
    return handleCamouflage(req, env, s, ctx);
  }

  if (identifyTunnel(url.pathname, s) !== null) {
    if (!isUpgradeRequest(req)) return handleCamouflage(req, env, s, ctx);
    if (s.killSwitch) return killSwitchResponse();
    void recordConnection(env, undefined, ctx).catch((err: unknown) => log.error("counters", "record failed", String(err)));
    return handleTunnel(req, env, s, ctx);
  }

  const route = resolveSecureRoute(url, s);
  if (route !== null) return dispatchSecureRoute(route, req, env, s, ctx);

  return handleCamouflage(req, env, s, ctx);
}
