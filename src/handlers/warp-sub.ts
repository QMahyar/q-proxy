import type { RouteHandler } from "../types/context";
import { getAccountByToken } from "../warp/store";
import { expandAccount, sanitizeFilename } from "../warp/expand";
import { isWarpFormat, WARP_CONTENT_TYPES, WARP_EXTENSIONS, WARP_EMITTERS } from "../warp/formats/registry";
import { resolveSecureRoute } from "../core/routes";
import { appVersion } from "../settings/store";
import { afterResponse, readUsage } from "../core/counters";
import { encodeUtf8Base64 } from "../utils/base64";

function notFound(): Response {
  return new Response("not found\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const handleWarpSub: RouteHandler = async (req, env, s) => {
  const url = new URL(req.url);
  const route = resolveSecureRoute(url, s);
  if (route === null || route.kind !== "warp-sub") return notFound();
  const segs = url.pathname.split("/").filter((p) => p.length > 0);
  const token = segs[segs.length - 2]!;
  const formatName = segs[segs.length - 1]!;
  if (!isWarpFormat(formatName)) return notFound();

  const account = await getAccountByToken(env, token);
  if (account === null) return notFound();

  const cacheKeyUrl = new URL(url.toString());
  cacheKeyUrl.search = "";
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: "GET" });
  const edgeCache: Cache | null = typeof caches === "undefined" ? null : caches.default;
  if (edgeCache !== null) {
    const cached = await edgeCache.match(cacheKey);
    if (cached !== undefined) return cached;
  }

  const ctx = await expandAccount(env, account);
  if (ctx.rows.length === 0) return notFound();
  const result = WARP_EMITTERS[formatName](ctx);

  const origin = url.origin;
  const usage = await readUsage(env);
  const headers: Record<string, string> = {
    "Content-Type": WARP_CONTENT_TYPES[formatName],
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${sanitizeFilename(account.name)}-${formatName}.${WARP_EXTENSIONS[formatName]}`)}`,
    "Profile-Update-Interval": String(Math.max(1, Math.floor(s.subUpdateIntervalHours))),
    "Profile-Title": `base64:${encodeUtf8Base64(account.name)}`,
    "Subscription-Userinfo": `upload=0; download=${usage.requestsTotal * 1024 * 1024}`,
    "profile-web-page-url": `${origin}/${s.securePath}/panel`,
    "X-WG-Version": appVersion(),
    "Cache-Control": "public, max-age=60",
  };
  const body: BodyInit = typeof result === "string" ? result : new Uint8Array(result);
  const res = new Response(body, { status: 200, headers });
  if (edgeCache !== null) afterResponse(edgeCache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
};
