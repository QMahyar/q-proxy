import type { RouteHandler } from "../types/context";
import { jsonOk, htmlResponse } from "../core/respond";

const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const TRACE_TIMEOUT_MS = 3000;

export function parseTraceIp(traceText: string): string | null {
  const m = /^ip=(.+)$/m.exec(traceText);
  if (m === null) return null;
  const value = m[1]!.trim();
  return value.length > 0 ? value : null;
}

async function fetchCfEgressIp(): Promise<string | null> {
  try {
    const res = await fetch(TRACE_URL, { signal: AbortSignal.timeout(TRACE_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseTraceIp(await res.text());
  } catch {
    return null;
  }
}

interface IpInfo {
  ip: string;
  colo: string | null;
  country: string | null;
  city: string | null;
  asn: number | null;
  cfEgressIp: string | null;
}

interface CfGeo {
  colo?: string;
  country?: string;
  city?: string;
  asn?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderIpHtml(info: IpInfo): string {
  const rows: Array<[string, string]> = [
    ["Your IP / IP شما", info.ip],
    ["Colo", info.colo ?? "-"],
    ["Country / کشور", info.country ?? "-"],
    ["City / شهر", info.city ?? "-"],
    ["ASN", info.asn === null ? "-" : String(info.asn)],
    ["Cloudflare egress IP", info.cfEgressIp ?? "-"],
  ];
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td><code>${escapeHtml(value)}</code></td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>My IP</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:2rem;background:#0f172a;color:#e2e8f0;line-height:1.6}
main{max-width:40rem;margin:0 auto}
h1{font-size:1.3rem}
table{border-collapse:collapse;width:100%;margin-top:.5rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #1e293b;vertical-align:top}
code{word-break:break-all;font-size:.9rem;color:#7dd3fc}
[dir="rtl"]{direction:rtl;text-align:right}
</style>
</head>
<body>
<main>
<h1>My IP</h1>
<p dir="rtl" lang="fa">اطلاعات اتصال شما:</p>
<table>${body}</table>
</main>
</body>
</html>`;
}
export const handleMyIp: RouteHandler = async (req, _env, _s) => {
  const cf = req.cf as CfGeo | undefined;
  const cfEgressIp = await fetchCfEgressIp();
  const info: IpInfo = {
    ip: req.headers.get("CF-Connecting-IP") ?? "",
    colo: cf?.colo ?? null,
    country: cf?.country ?? null,
    city: cf?.city ?? null,
    asn: cf?.asn ?? null,
    cfEgressIp,
  };
  const accept = req.headers.get("Accept") ?? "";
  if (accept.includes("application/json")) {
    return jsonOk({
      ip: info.ip,
      colo: info.colo,
      country: info.country,
      city: info.city,
      asn: info.asn,
      cfEgressIp: info.cfEgressIp,
    });
  }
  return htmlResponse(renderIpHtml(info));
};
