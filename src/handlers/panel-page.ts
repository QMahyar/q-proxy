import type { RouteHandler } from "../types/context";
import { ASSETS } from "../ui/assets";
import { htmlResponse } from "../core/respond";

const PANEL_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' https:; base-uri 'none'; form-action 'self'";

const ASSET_CACHE_CONTROL = "private, no-cache";

const assetEtags = new Map<string, Promise<string>>();

const assetEtag = (name: keyof typeof ASSETS, body: string): Promise<string> => {
  const cached = assetEtags.get(name);
  if (cached) return cached;
  const pending = crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(body))
    .then((digest) => {
      const bytes = new Uint8Array(digest);
      let s = "";
      for (let i = 0; i < 16; i++) s += bytes[i]!.toString(16).padStart(2, "0");
      return `"${s}"`;
    });
  assetEtags.set(name, pending);
  return pending;
};

const ifNoneMatchHit = (req: Request, etag: string): boolean => {
  const header = req.headers.get("If-None-Match");
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === etag || trimmed === `W/${etag}`;
  });
};

const serveAsset = async (
  name: keyof typeof ASSETS,
  headers: Record<string, string>,
  req: Request,
): Promise<Response> => {
  const etag = await assetEtag(name, ASSETS[name]);
  if (ifNoneMatchHit(req, etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": ASSET_CACHE_CONTROL } });
  }
  return htmlResponse(ASSETS[name], 200, { ...headers, ETag: etag, "Cache-Control": ASSET_CACHE_CONTROL });
};

export const servePanelPage: RouteHandler = async (req) => {
  return serveAsset("panel", { "Content-Security-Policy": PANEL_CSP }, req);
};

export const serveLoginPage: RouteHandler = async (req) => {
  return serveAsset("login", {}, req);
};
