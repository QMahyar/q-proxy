import type { RouteHandler } from "../types/context";
import type { Settings } from "../types/settings";
import { afterResponse } from "../core/counters";
import { settingsEtag } from "../settings/store";
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
import { findUserByToken, getUserHits, consumeUserHit } from "../users/store";

const SUB_EDGE_CACHE_SECONDS = 300;

function settingsCacheStamp(s: Settings): string {
  return settingsEtag() ?? `v${s.version}`;
}

function versionedEdgeCacheKey(base: Request, s: Settings): Request {
  const keyUrl = new URL(base.url);
  keyUrl.searchParams.set("_v", settingsCacheStamp(s));
  return new Request(keyUrl.toString(), { method: "GET" });
}

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
  if (!user.enabled || (user.expiresAt !== null && user.expiresAt <= now)) return plain(410, "gone");

  if (format === null) {
    const subUrls = SUB_FORMATS.map((f) => ({ format: f, url: `${url.origin}${url.pathname}?target=${f}` }));
    return htmlResponse(infoPageHtml(subUrls, s.profileTitle), 200, { "Cache-Control": "no-store" });
  }

  const cacheKey = versionedEdgeCacheKey(makeEdgeCacheKey(req, format, isFragmentMode, token), s);
  const cached = await matchEdgeCache(cacheKey);
  if (cached !== undefined) {
    const hits = await getUserHits(env, token);
    if (user.dailyReqLimit !== null && hits >= user.dailyReqLimit) {
      return plain(429, "daily quota exceeded", { "Retry-After": String(secondsUntilUtcMidnight(now)) });
    }
    return cached;
  }

  const { allowed, hits, total } = await consumeUserHit(env, token, user.dailyReqLimit);
  if (!allowed) {
    return plain(429, "daily quota exceeded", { "Retry-After": String(secondsUntilUtcMidnight(now)) });
  }

  const override = user.addressOverride ?? null;
  const nodeSettings: Settings =
    override === null ? s : { ...s, addresses: [override], defaultPort: override.port ?? s.defaultPort };
  const ctx = { settings: nodeSettings, hostname: resolveHostname(s, url), request: req };
  const allNodes = generateNodes(ctx);
  const scoped =
    user.protocols === "all" ? allNodes : allNodes.filter((n) => user.protocols.includes(n.kind));
  const nodes = selectVariantNodes(scoped, isFragmentMode ? "fragment" : "normal");
  const subSettings = { ...s, remoteSubUrls: [] as string[] };
  const body = await renderSubscriptionBody({
    settings: subSettings,
    nodes,
    format,
    isFragmentMode,
    subscriptionUrl: `${url.origin}${url.pathname}?target=${format}`,
  });

  const headers = subscriptionHeaders(
    format,
    s.profileTitle,
    nodes,
    { day: dayKeyUtc(), requestsToday: hits, requestsTotal: total },
    {
      updateIntervalHours: s.subUpdateIntervalHours,
      webPageUrl: `${url.origin}/${s.securePath}/panel`,
      expireAt: user.expiresAt,
    },
  );
  headers["Content-Type"] = SUB_CONTENT_TYPES[format];
  headers["Cache-Control"] = `public, max-age=${SUB_EDGE_CACHE_SECONDS}, s-maxage=${SUB_EDGE_CACHE_SECONDS}`;
  headers["Expires"] = new Date(Date.now() + SUB_EDGE_CACHE_SECONDS * 1000).toUTCString();
  const res = new Response(body, { status: 200, headers });
  if (typeof caches !== "undefined") afterResponse(caches.default.put(cacheKey, res.clone()));
  return res;
};
