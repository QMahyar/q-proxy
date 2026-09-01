import type { RouteHandler } from "../types/context";
import { BadRequestError, UpstreamError } from "../core/errors";
import { log } from "../core/log";
import { jsonError } from "../core/respond";
import { isLocalOrPrivateTarget } from "../utils/net";

const MAX_DOH_BODY_BYTES = 64 * 1024;
const PASSTHROUGH_HEADERS = ["content-type", "cache-control"] as const;

async function readCappedBody(req: Request, cap: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    total += value.byteLength;
    if (total > cap) {
      void reader.cancel().catch(() => {});
      throw new BadRequestError(`dns query body exceeds the ${Math.floor(cap / 1024)} KiB cap`);
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export const handleDoh: RouteHandler = async (req, _env, s) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "doh endpoint supports GET and POST only");
  }
  const upstream = new URL(s.dohUpstream);
  if (isLocalOrPrivateTarget(upstream.hostname)) {
    throw new BadRequestError("doh upstream must not target a local or private address");
  }
  const headers: Record<string, string> = {
    Accept: req.headers.get("accept") ?? "application/dns-message",
  };
  let init: RequestInit;
  if (req.method === "POST") {
    const clRaw = req.headers.get("content-length");
    if (clRaw !== null) {
      const declared = Number(clRaw.trim());
      if (!Number.isInteger(declared) || declared < 0) throw new BadRequestError("invalid content-length");
      if (declared > MAX_DOH_BODY_BYTES) throw new BadRequestError("dns query body exceeds the 64 KiB cap");
    }
    const body = await readCappedBody(req, MAX_DOH_BODY_BYTES);
    if (body.byteLength === 0) throw new BadRequestError("empty dns query body");
    headers["Content-Type"] = req.headers.get("content-type") ?? "application/dns-message";
    init = { method: "POST", headers, body, signal: AbortSignal.timeout(5000) };
  } else {
    const dns = new URL(req.url).searchParams.get("dns");
    if (dns !== null) upstream.searchParams.set("dns", dns);
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
