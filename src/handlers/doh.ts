import type { RouteHandler } from "../types/context";
import { BadRequestError, UpstreamError } from "../core/errors";
import { log } from "../core/log";
import { jsonError } from "../core/respond";

const MAX_DOH_BODY_BYTES = 10 * 1024 * 1024;
const PASSTHROUGH_HEADERS = ["content-type", "cache-control"] as const;

export const handleDoh: RouteHandler = async (req, _env, s) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "doh endpoint supports GET and POST only");
  }
  const upstream = new URL(s.dohUpstream);
  const incoming = new URL(req.url);
  for (const [key, value] of incoming.searchParams) {
    upstream.searchParams.set(key, value);
  }
  const headers: Record<string, string> = {
    Accept: req.headers.get("accept") ?? "application/dns-message",
  };
  let init: RequestInit;
  if (req.method === "POST") {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_DOH_BODY_BYTES) {
      throw new BadRequestError("dns query body exceeds the 10 MiB cap");
    }
    const body = await req.arrayBuffer();
    if (body.byteLength === 0) throw new BadRequestError("empty dns query body");
    if (body.byteLength > MAX_DOH_BODY_BYTES) {
      throw new BadRequestError("dns query body exceeds the 10 MiB cap");
    }
    headers["Content-Type"] = req.headers.get("content-type") ?? "application/dns-message";
    init = { method: "POST", headers, body, signal: AbortSignal.timeout(5000) };
  } else {
    init = { method: "GET", headers, signal: AbortSignal.timeout(5000) };
  }
  let resp: Response;
  try {
    resp = await fetch(upstream, init);
  } catch (err) {
    log.error("doh", "upstream fetch failed", String(err));
    throw new UpstreamError("doh upstream unreachable");
  }
  if (!resp.ok || resp.body === null) {
    throw new UpstreamError(`doh upstream returned status ${resp.status}`);
  }
  const outHeaders = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = resp.headers.get(name);
    if (value !== null) outHeaders.set(name, value);
  }
  if (!outHeaders.has("Content-Type")) outHeaders.set("Content-Type", "application/dns-message");
  return new Response(resp.body, { status: resp.status, headers: outHeaders });
};
