import type { RouteHandler } from "../types/context";
import { NotFoundError } from "../core/errors";
import { htmlResponse } from "../core/respond";
import { ASSETS } from "../ui/assets";

const PROXY_TIMEOUT_MS = 5000;

async function proxyPassthrough(url: string): Promise<Response | null> {
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });
    if (!upstream.ok || upstream.body === null) return null;
    const headers = new Headers();
    const contentType = upstream.headers.get("Content-Type");
    if (contentType !== null) headers.set("Content-Type", contentType);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return null;
  }
}

export const handleCamouflage: RouteHandler = async (_req, _env, s) => {
  switch (s.camouflage.mode) {
    case "off":
      throw new NotFoundError();
    case "static":
      return htmlResponse(ASSETS.camo);
    case "proxy": {
      const passthrough = await proxyPassthrough(s.camouflage.url);
      if (passthrough !== null) return passthrough;
      return htmlResponse(ASSETS.camo);
    }
  }
};
