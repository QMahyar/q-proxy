import type { RouteHandler } from "../types/context";
import { NotFoundError } from "../core/errors";
import { htmlResponse } from "../core/respond";
import { isLocalOrPrivateTarget } from "../utils/net";
import { ASSETS } from "../ui/assets";

const PROXY_TIMEOUT_MS = 5000;

async function proxyPassthrough(reqUrl: string, upstreamBase: string): Promise<Response | null> {
  try {
    const incoming = new URL(reqUrl);
    const base = new URL(upstreamBase);
    if (isLocalOrPrivateTarget(base.hostname)) return null;
    const target = new URL(incoming.pathname.replace(/\/+$/, "") || "/", base.origin);
    target.pathname = (base.pathname.replace(/\/+$/, "") + incoming.pathname).replace(/\/{2,}/g, "/") || "/";
    target.search = incoming.search;
    const upstream = await fetch(target, { signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
    if (!upstream.ok || upstream.body === null) return null;
    const headers = new Headers();
    const contentType = upstream.headers.get("Content-Type");
    if (contentType !== null) headers.set("Content-Type", contentType);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return null;
  }
}

export const handleCamouflage: RouteHandler = async (req, _env, s) => {
  switch (s.camouflage.mode) {
    case "off":
      throw new NotFoundError();
    case "static":
      return htmlResponse(ASSETS.camo);
    case "proxy": {
      const passthrough = await proxyPassthrough(req.url, s.camouflage.url);
      if (passthrough !== null) return passthrough;
      return htmlResponse(ASSETS.camo);
    }
  }
};
