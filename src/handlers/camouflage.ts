import type { RouteHandler } from "../types/context";
import { NotFoundError, ServiceUnavailableError, UpstreamError } from "../core/errors";
import { log } from "../core/log";
import { htmlResponse } from "../core/respond";
import { ASSETS } from "../ui/assets";
import { isLocalOrPrivateTarget } from "../utils/net";

export const CAMO_REVERSE_TIMEOUT_MS = 8000;
export const CAMO_REVERSE_MAX_BYTES = 2 * 1024 * 1024;

const MINIMAL_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>1101</title></head>
<body><h1>1101</h1><p>Worker threw exception.</p></body>
</html>
`;

export interface FetchReverseOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export interface ReverseUpstream {
  status: number;
  contentType: string;
  body: string;
}

// Replace upstream origin/host occurrences with the request's own so the
// mirrored page links back to this worker. Pure string surgery on text
// bodies only; never throws.
export function rewriteReverseHosts(
  text: string,
  upstreamOrigin: string,
  upstreamHost: string,
  reqOrigin: string,
  reqHost: string,
): string {
  try {
    let out = String(text ?? "");
    if (upstreamOrigin.length > 0 && reqOrigin.length > 0) out = out.split(upstreamOrigin).join(reqOrigin);
    if (upstreamHost.length > 0 && reqHost.length > 0) out = out.split(upstreamHost).join(reqHost);
    return out;
  } catch {
    return String(text ?? "");
  }
}

function isRewritableContent(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.length === 0) return true;
  if (ct.startsWith("text/")) return true;
  return ct.includes("html") || ct.includes("javascript") || ct.includes("json") || ct.includes("xml");
}

// Bounded reverse fetch: timeout + byte cap, never throws. Reasons are
// static (no URLs, no hosts).
export async function fetchReverseText(
  targetUrl: string,
  fetchFn: typeof fetch = fetch,
  opts: FetchReverseOptions = {},
): Promise<{ ok: true; value: ReverseUpstream } | { ok: false; reason: string }> {
  const maxBytes = opts.maxBytes ?? CAMO_REVERSE_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? CAMO_REVERSE_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetchFn(targetUrl, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, reason: "reverse upstream request failed" };
  }
  if (!res.ok) return { ok: false, reason: `reverse upstream ${res.status}` };
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared.trim());
    if (Number.isInteger(n) && n > maxBytes) return { ok: false, reason: "reverse upstream response too large" };
  }
  try {
    const reader = res.body?.getReader() ?? null;
    if (reader === null) {
      const text = await res.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        return { ok: false, reason: "reverse upstream response too large" };
      }
      return { ok: true, value: { status: res.status, contentType, body: text } };
    }
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, reason: "reverse upstream response too large" };
      }
      out += decoder.decode(value, { stream: true });
    }
    return { ok: true, value: { status: res.status, contentType, body: out + decoder.decode() } };
  } catch {
    return { ok: false, reason: "reverse upstream response unreadable" };
  }
}

export const handleCamouflage: RouteHandler = async (req, _env, s) => {
  const mode = s.camouflage.mode;
  // nginx renders the default static page (edgetunnel parity of the mode
  // list, not a separate asset).
  if (mode === "static" || mode === "nginx") return htmlResponse(ASSETS.camo);
  if (mode === "minimal") return htmlResponse(MINIMAL_PAGE, 200, { "Cache-Control": "no-store" });
  if (mode === "off") throw new NotFoundError();
  const raw = s.camouflage.reverseUrl.trim();
  if (raw.length === 0) throw new ServiceUnavailableError("reverse camouflage URL is not configured");
  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UpstreamError("reverse camouflage target is invalid");
  }
  // Settings validation already forces https; the handler additionally
  // upgrades a legacy http store instead of failing the request.
  if (target.protocol === "http:") target.protocol = "https:";
  if (target.protocol !== "https:" || target.hostname.length === 0) {
    throw new UpstreamError("reverse camouflage target is invalid");
  }
  if (isLocalOrPrivateTarget(target.hostname)) throw new UpstreamError("reverse camouflage target is not allowed");
  const url = new URL(req.url);
  const upstreamUrl = `${target.origin}${url.pathname}${url.search}`;
  const fetched = await fetchReverseText(upstreamUrl);
  if (!fetched.ok) {
    // Never log the upstream URL: origins may carry tokens in path/query.
    log.error("camouflage", `reverse fetch failed (${fetched.reason})`);
    throw new UpstreamError("reverse camouflage unreachable");
  }
  const { status, contentType, body } = fetched.value;
  const reqOrigin = url.origin;
  const text = isRewritableContent(contentType)
    ? rewriteReverseHosts(body, target.origin, target.hostname, reqOrigin, url.hostname)
    : body;
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (contentType.length > 0) headers["Content-Type"] = contentType;
  else headers["Content-Type"] = "text/html; charset=utf-8";
  return new Response(text, { status, headers });
};
