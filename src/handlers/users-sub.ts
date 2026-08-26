import type { RouteHandler } from "../types/context";
import type { SubFormat } from "../core/ua";
import { classifyUA } from "../core/ua";
import { resolveHostname, resolveSecureRoute } from "../core/routes";
import { htmlResponse } from "../core/respond";
import { handleCamouflage } from "./camouflage";
import { infoPageHtml, SUB_CONTENT_TYPES } from "./subscribe";
import { EMITTERS } from "../nodes/emitters/registry";
import { generateNodes } from "../nodes/generate";
import { buildShareUris } from "../nodes/share-uri";
import { subscriptionHeaders } from "../subscription/headers";
import { encodeUtf8Base64 } from "../utils/base64";
import { dayKeyUtc } from "../utils/time";
import { findUserByToken, getUserHits, recordUserHit } from "../users/store";

const FORMATS: readonly SubFormat[] = ["base64", "clash", "singbox", "surge", "loon"];

function plain(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

function pickFormat(req: Request, pathTarget: string | undefined): SubFormat | null {
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "html") return null;
  const target = url.searchParams.get("target");
  if (target !== null && (FORMATS as readonly string[]).includes(target)) return target as SubFormat;
  if (pathTarget !== undefined && (FORMATS as readonly string[]).includes(pathTarget)) return pathTarget as SubFormat;
  const detected = classifyUA(req.headers.get("user-agent") ?? "");
  return detected === "browser" ? null : detected;
}

function secondsUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / 1000));
}

export const handleUserSub: RouteHandler = async (req, env, s) => {
  const url = new URL(req.url);
  const route = resolveSecureRoute(url, s);
  if (route === null || route.kind !== "user-sub") return plain(404, "not found");
  const segs = url.pathname.split("/").filter((p) => p.length > 0);
  const token = segs[3]!;
  const pathTarget = segs.length === 5 ? segs[4] : undefined;
  const format = pickFormat(req, pathTarget);
  const isFragmentMode = url.searchParams.get("mode") === "fragment";

  const cacheKeyUrl = new URL(req.url);
  cacheKeyUrl.searchParams.set("_k", `${format ?? "info"}:${isFragmentMode ? "f" : "n"}:${token}`);
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });
  const edgeCache: Cache | null = typeof caches === "undefined" ? null : caches.default;
  if (edgeCache !== null && format !== null) {
    const cached = await edgeCache.match(cacheKey);
    if (cached !== undefined) return cached;
  }

  const user = await findUserByToken(env, token);
  if (user === null) return handleCamouflage(req, env, s);

  const now = Date.now();
  if (!user.enabled || (user.expiresAt !== null && user.expiresAt < now)) return plain(410, "gone");

  const hits = await getUserHits(env, token);

  if (format === null) {
    const subUrls = FORMATS.map((f) => ({ format: f, url: `${url.origin}${url.pathname}?target=${f}` }));
    return htmlResponse(infoPageHtml(subUrls, s.profileTitle));
  }

  if (user.dailyReqLimit !== null && hits >= user.dailyReqLimit) {
    return plain(429, "daily quota exceeded", { "Retry-After": String(secondsUntilUtcMidnight(now)) });
  }

  void recordUserHit(env, token).catch(() => {});

  const origin = url.origin;
  const panelUrl = `${origin}/${s.securePath}/panel`;
  const ctx = { settings: s, hostname: resolveHostname(s, url), request: req };
  const allNodes = generateNodes(ctx);
  const scoped =
    user.protocols === "all" ? allNodes : allNodes.filter((n) => (user.protocols as string[]).includes(n.kind));
  let nodes = isFragmentMode ? scoped.filter((n) => n.variant === "fragment") : scoped;
  if (isFragmentMode && nodes.length === 0) nodes = scoped;

  let body: string;
  if (format === "base64") {
    body = encodeUtf8Base64(buildShareUris(nodes).join("\n"));
  } else {
    const opts = {
      remoteDns: s.remoteDns,
      urlTestIntervalSec: s.urlTestIntervalSec,
      isFragment: isFragmentMode,
      subscriptionUrl: `${origin}${url.pathname}?target=${format}`,
      updateIntervalHours: s.subUpdateIntervalHours,
      rules: {
        bypassLan: s.routingRules.bypassLan,
        bypassDomains: [...s.routingRules.customBypass],
        blockDomains: [...s.routingRules.customBlock],
        blockQuic: s.routingRules.blockQuic,
      },
    };
    body = EMITTERS[format](nodes, opts);
  }

  const headers = subscriptionHeaders(
    format,
    s.profileTitle,
    nodes,
    { day: dayKeyUtc(), requestsToday: hits, requestsTotal: hits },
    { updateIntervalHours: s.subUpdateIntervalHours, webPageUrl: panelUrl },
  );
  headers["Content-Type"] = SUB_CONTENT_TYPES[format];
  const res = new Response(body, { status: 200, headers });
  if (edgeCache !== null) void edgeCache.put(cacheKey, res.clone()).catch(() => {});
  return res;
};
