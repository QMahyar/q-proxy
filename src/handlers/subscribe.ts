import type { RouteHandler } from "../types/context";
import type { SubFormat } from "../core/ua";
import { NotFoundError } from "../core/errors";
import { afterResponse, readUsage } from "../core/counters";
import { htmlResponse } from "../core/respond";
import { resolveHostname, resolveSecureRoute } from "../core/routes";
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
import { escapeHtml } from "../utils/html";

const FORMAT_LABELS: Record<SubFormat, string> = {
  base64: "Base64 / v2rayNG",
  clash: "Clash / mihomo",
  singbox: "sing-box",
  surge: "Surge",
  loon: "Loon",
};

export function infoPageHtml(subUrls: Array<{ format: SubFormat; url: string }>, title: string): string {
  const rows = subUrls
    .map(
      ({ format, url }) =>
        `<tr><th scope="row">${escapeHtml(FORMAT_LABELS[format])}</th><td><code>${escapeHtml(url)}</code></td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:2rem;background:#0f172a;color:#e2e8f0;line-height:1.6}
main{max-width:60rem;margin:0 auto}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}
section{margin:1rem 0}
table{border-collapse:collapse;width:100%;margin-top:.5rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #1e293b;vertical-align:top}
code{word-break:break-all;font-size:.85rem;color:#7dd3fc}
[dir="rtl"]{direction:rtl;text-align:right}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<section lang="en">
<p>This is a VPN subscription endpoint. Open one of these URLs in your client app / add manually.</p>
</section>
<section lang="fa" dir="rtl">
<p>این یک اندپوینت اشتراک VPN است. یکی از آدرس‌های زیر را در برنامه کلاینت خود اضافه کنید.</p>
</section>
<h2>Subscription URLs</h2>
<table>
${rows}
</table>
</main>
</body>
</html>`;
}

export const handleSubscribe: RouteHandler = async (req, env, s) => {
  const url = new URL(req.url);
  const route = resolveSecureRoute(url, s);
  if (route === null || route.kind !== "sub") throw new NotFoundError();

  const format = pickSubFormat(req);
  const isFragmentMode = url.searchParams.get("mode") === "fragment";

  if (format === null) {
    const origin = url.origin;
    const subUrls = SUB_FORMATS.map((f) => ({
      format: f,
      url: `${origin}${url.pathname}?target=${f}`,
    }));
    return htmlResponse(infoPageHtml(subUrls, s.profileTitle));
  }

  const cacheKey = makeEdgeCacheKey(req, format, isFragmentMode);
  const cached = await matchEdgeCache(cacheKey);
  if (cached !== undefined) return cached;

  const ctx = { settings: s, hostname: resolveHostname(s, url), request: req };
  const nodes = selectVariantNodes(generateNodes(ctx), isFragmentMode ? "fragment" : "normal");
  const body = await renderSubscriptionBody({
    settings: s,
    nodes,
    format,
    isFragmentMode,
    subscriptionUrl: `${url.origin}${url.pathname}?target=${format}`,
  });

  const usage = await readUsage(env);
  const headers = subscriptionHeaders(format, s.profileTitle, nodes, usage, {
    updateIntervalHours: s.subUpdateIntervalHours,
    webPageUrl: `${url.origin}/${s.securePath}/panel`,
  });
  headers["Content-Type"] = SUB_CONTENT_TYPES[format];
  const res = new Response(body, { status: 200, headers });
  if (typeof caches !== "undefined") afterResponse(caches.default.put(cacheKey, res.clone()));
  return res;
};
