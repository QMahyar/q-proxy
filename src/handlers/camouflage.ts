import type { RouteHandler } from "../types/context";
import { NotFoundError } from "../core/errors";
import { htmlResponse } from "../core/respond";
import { isLocalOrPrivateTarget } from "../utils/net";
import { ASSETS } from "../ui/assets";

const PROXY_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function proxyPassthrough(reqUrl: string, upstreamBase: string): Promise<Response | null> {
  try {
    const incoming = new URL(reqUrl);
    const base = new URL(upstreamBase);
    if (isLocalOrPrivateTarget(base.hostname)) return null;
    let target = new URL(incoming.pathname.replace(/\/+$/, "") || "/", base.origin);
    if (target.origin !== base.origin) return null;
    target.pathname = (base.pathname.replace(/\/+$/, "") + incoming.pathname).replace(/\/{2,}/g, "/") || "/";
    target.search = incoming.search;
    let upstream = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
    let hops = 0;
    while (REDIRECT_STATUSES.has(upstream.status)) {
      const loc = upstream.headers.get("Location");
      if (loc === null) return null;
      const next = new URL(loc, target);
      if (next.origin !== base.origin) return null;
      if (++hops > MAX_REDIRECTS) return null;
      target = next;
      upstream = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
    }
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
