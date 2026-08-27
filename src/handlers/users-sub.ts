import type { RouteHandler } from "../types/context";
import { afterResponse } from "../core/counters";
import { resolveHostname, resolveSecureRoute } from "../core/routes";
import { htmlResponse } from "../core/respond";
import { handleCamouflage } from "./camouflage";
import { infoPageHtml } from "./subscribe";
import { generateNodes } from "../nodes/generate";
import { subscriptionHeaders } from "../subscription/headers";
import {
  makeEdgeCacheKey,
  matchEdgeCache,
  renderSubscriptionBody,
  selectVariantNodes,
  SUB_CONTENT_TYPES,
} from "../subscription/render";
import { pickSubFormat, SUB_FORMATS } from "../subscription/negotiate";
import { dayKeyUtc } from "../utils/time";
import { findUserByToken, getUserHits, recordUserHit } from "../users/store";

function plain(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
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
  const format = pickSubFormat(req, pathTarget);
  const isFragmentMode = url.searchParams.get("mode") === "fragment";

  const user = await findUserByToken(env, token);
  if (user === null) return handleCamouflage(req, env, s);

  const now = Date.now();
  if (!user.enabled || (user.expiresAt !== null && user.expiresAt < now)) return plain(410, "gone");

  const hits = await getUserHits(env, token);

  if (format === null) {
    const subUrls = SUB_FORMATS.map((f) => ({ format: f, url: `${url.origin}${url.pathname}?target=${f}` }));
    return htmlResponse(infoPageHtml(subUrls, s.profileTitle));
  }

  if (user.dailyReqLimit !== null && hits >= user.dailyReqLimit) {
    return plain(429, "daily quota exceeded", { "Retry-After": String(secondsUntilUtcMidnight(now)) });
  }

  const cacheKey = makeEdgeCacheKey(req, format, isFragmentMode, token);
  const cached = await matchEdgeCache(cacheKey);
  if (cached !== undefined) return cached;

  afterResponse(recordUserHit(env, token));

  const ctx = { settings: s, hostname: resolveHostname(s, url), request: req };
  const scoped =
    user.protocols === "all"
      ? generateNodes(ctx)
      : generateNodes(ctx).filter((n) => (user.protocols as string[]).includes(n.kind));
  const nodes = selectVariantNodes(scoped, isFragmentMode ? "fragment" : "normal");
  const body = await renderSubscriptionBody({
    settings: s,
    nodes,
    format,
    isFragmentMode,
    subscriptionUrl: `${url.origin}${url.pathname}?target=${format}`,
  });

  const headers = subscriptionHeaders(
    format,
    s.profileTitle,
    nodes,
    { day: dayKeyUtc(), requestsToday: hits, requestsTotal: hits },
    {
      updateIntervalHours: s.subUpdateIntervalHours,
      webPageUrl: `${url.origin}/${s.securePath}/panel`,
      expireAt: user.expiresAt,
    },
  );
  headers["Content-Type"] = SUB_CONTENT_TYPES[format];
  const res = new Response(body, { status: 200, headers });
  if (typeof caches !== "undefined") afterResponse(caches.default.put(cacheKey, res.clone()));
  return res;
};
