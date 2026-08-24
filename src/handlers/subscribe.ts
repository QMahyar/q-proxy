import type { RouteHandler } from "../types/context";
import type { SubFormat } from "../core/ua";
import { NotFoundError } from "../core/errors";
import { readUsage } from "../core/counters";
import { htmlResponse } from "../core/respond";
import { resolveHostname, resolveSecureRoute } from "../core/routes";
import { EMITTERS } from "../nodes/emitters/registry";
import { generateNodes } from "../nodes/generate";
import { buildShareUris } from "../nodes/share-uri";
import { subscriptionHeaders } from "../subscription/headers";
import { fetchRemoteSubLines } from "../subscription/merge";
import { pickSubFormat } from "../subscription/negotiate";
import { encodeUtf8Base64 } from "../utils/base64";

const FORMATS: readonly SubFormat[] = ["base64", "clash", "singbox", "surge", "loon"];

const CONTENT_TYPES: Record<SubFormat, string> = {
  base64: "text/plain; charset=utf-8",
  clash: "text/yaml; charset=utf-8",
  singbox: "application/json; charset=utf-8",
  surge: "text/plain; charset=utf-8",
  loon: "text/plain; charset=utf-8",
};

const FORMAT_LABELS: Record<SubFormat, string> = {
  base64: "Base64 / v2rayNG",
  clash: "Clash / mihomo",
  singbox: "sing-box",
  surge: "Surge",
  loon: "Loon",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
table{border-collapse:collapse;width:100%;margin-top:.5rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #1e293b;vertical-align:top}
code{word-break:break-all;font-size:.85rem;color:#7dd3fc}
[dir="rtl"]{direction:rtl;text-align:right}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>This is a VPN subscription endpoint. Open one of these URLs in your client app / add manually.</p>
<p dir="rtl" lang="fa">این یک اندپوینت اشتراک VPN است. یکی از آدرس‌های زیر را در برنامه کلاینت خود اضافه کنید.</p>
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

  const origin = url.origin;
  const panelUrl = `${origin}/${s.securePath}/panel`;
  const format = pickSubFormat(req);
  const isFragmentMode = url.searchParams.get("mode") === "fragment";

  if (format === null) {
    const subUrls = FORMATS.map((f) => ({
      format: f,
      url: `${origin}${url.pathname}?target=${f}`,
    }));
    return htmlResponse(infoPageHtml(subUrls, s.profileTitle));
  }

  const ctx = { settings: s, hostname: resolveHostname(s, url), request: req };
  const allNodes = generateNodes(ctx);
  let nodes = isFragmentMode ? allNodes.filter((n) => n.variant === "fragment") : allNodes;
  if (isFragmentMode && nodes.length === 0) nodes = allNodes;
  const opts = {
    remoteDns: s.remoteDns,
    urlTestIntervalSec: s.urlTestIntervalSec,
    isFragment: isFragmentMode,
    subscriptionUrl: `${origin}${url.pathname}?target=${format}`,
    updateIntervalHours: s.subUpdateIntervalHours,
  };

  let body: string;
  if (format === "base64") {
    const [ownLines, remoteLines] = await Promise.all([
      Promise.resolve(buildShareUris(nodes)),
      fetchRemoteSubLines(s.remoteSubUrls),
    ]);
    body = encodeUtf8Base64([...ownLines, ...remoteLines].join("\n"));
  } else {
    body = EMITTERS[format](nodes, opts);
  }

  const usage = await readUsage(env);
  const headers = subscriptionHeaders(format, s.profileTitle, nodes, usage, {
    updateIntervalHours: s.subUpdateIntervalHours,
    webPageUrl: panelUrl,
  });
  headers["Content-Type"] = CONTENT_TYPES[format];
  return new Response(body, { status: 200, headers });
};
