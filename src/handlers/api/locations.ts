import type { RouteHandler } from "../../types/context";
import { UpstreamError } from "../../core/errors";
import { log } from "../../core/log";
import { matchEdgeCache } from "../../subscription/render";

export const LOCATIONS_URL = "https://speed.cloudflare.com/locations";
export const LOCATIONS_CACHE_TTL_SECONDS = 3600;
export const LOCATIONS_MAX_BYTES = 1024 * 1024;
export const LOCATIONS_TIMEOUT_MS = 10_000;

export interface FetchLocationsOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

// Bounded upstream fetch: timeout + byte cap, never throws. The URL is a
// fixed public constant, so there is nothing secret to leak.
export async function fetchLocationsText(
  fetchFn: typeof fetch = fetch,
  opts: FetchLocationsOptions = {},
): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  const maxBytes = opts.maxBytes ?? LOCATIONS_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? LOCATIONS_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetchFn(LOCATIONS_URL, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, reason: "locations request failed" };
  }
  if (!res.ok) return { ok: false, reason: `locations upstream ${res.status}` };
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared.trim());
    if (Number.isInteger(n) && n > maxBytes) return { ok: false, reason: "locations response too large" };
  }
  try {
    const reader = res.body?.getReader() ?? null;
    if (reader === null) {
      const text = await res.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        return { ok: false, reason: "locations response too large" };
      }
      return { ok: true, value: text };
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
        return { ok: false, reason: "locations response too large" };
      }
      out += decoder.decode(value, { stream: true });
    }
    return { ok: true, value: out + decoder.decode() };
  } catch {
    return { ok: false, reason: "locations response unreadable" };
  }
}

// GET proxy for the public Cloudflare locations feed: edge-cached for an
// hour, 1MB cap, served to the panel as cacheable public JSON in the usual
// `{ok:true,data}` envelope (jsonOk forces no-store, so the Response is
// built by hand to keep `public, max-age=3600`).
export const handleLocations: RouteHandler = async (_req) => {
  const cacheKey = new Request(LOCATIONS_URL, { method: "GET" });
  const cached = await matchEdgeCache(cacheKey);
  if (cached !== undefined) return cached;
  const fetched = await fetchLocationsText();
  if (!fetched.ok) {
    log.error("api/locations", `locations fetch failed (${fetched.reason})`);
    throw new UpstreamError("locations unreachable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.value);
  } catch {
    throw new UpstreamError("locations unreachable");
  }
  if (!Array.isArray(parsed)) throw new UpstreamError("locations unreachable");
  const res = new Response(JSON.stringify({ ok: true, data: { locations: parsed } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${LOCATIONS_CACHE_TTL_SECONDS}`,
    },
  });
  if (typeof caches !== "undefined") {
    await caches.default.put(cacheKey, res.clone()).catch(() => {
      // Best-effort: a failed edge-cache write must not fail the request.
    });
  }
  return res;
};
