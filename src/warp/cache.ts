import { WARP_FORMATS } from "./formats/registry";

function subUrl(origin: string, token: string, format: string): string {
  return `${origin}/sub/wg/${token}/${format}`;
}

export async function purgeWarpSub(origin: string, token: string): Promise<void> {
  if (typeof caches === "undefined") return;
  const cache = caches.default;
  await Promise.all(
    WARP_FORMATS.map((f) => cache.delete(new Request(subUrl(origin, token, f), { method: "GET" })).catch(() => false)),
  );
}

export async function purgeAllWarpSubs(
  env: {
    QPROXY_KV: {
      list(options: { prefix: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete?: boolean; cursor?: string }>;
      get(key: string, type: "json"): Promise<unknown>;
    };
  },
  origin: string,
): Promise<void> {
  if (typeof caches === "undefined") return;
  let cursor: string | undefined;
  for (;;) {
    const res = await env.QPROXY_KV.list({ prefix: "qproxy:warp:account:", cursor });
    await Promise.all(
      res.keys.map(async (key) => {
        const raw = (await env.QPROXY_KV.get(key.name, "json")) as { token?: string } | null;
        if (raw !== null && typeof raw.token === "string") await purgeWarpSub(origin, raw.token);
      }),
    );
    if (res.list_complete !== false) break;
    cursor = res.cursor;
    if (cursor === undefined || cursor.length === 0) break;
  }
}
