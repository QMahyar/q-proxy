import { WARP_FORMATS } from "./formats/registry";
import { WARP_ACCOUNT_PREFIX } from "./store";

function subUrl(securePath: string, token: string, format: string): string {
  return `/${securePath}/sub/wg/${token}/${format}`;
}

export async function purgeWarpSub(origin: string, securePath: string, token: string): Promise<void> {
  if (typeof caches === "undefined") return;
  const cache = caches.default;
  await Promise.all(
    WARP_FORMATS.map((f) =>
      cache
        .delete(new Request(`${origin}${subUrl(securePath, token, f)}`, { method: "GET" }))
        .catch(() => false),
    ),
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
  securePath: string,
): Promise<void> {
  if (typeof caches === "undefined") return;
  let cursor: string | undefined;
  for (;;) {
    const res = await env.QPROXY_KV.list({ prefix: WARP_ACCOUNT_PREFIX, cursor });
    await Promise.all(
      res.keys.map(async (key) => {
        const raw = (await env.QPROXY_KV.get(key.name, "json")) as unknown;
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
        const token = (raw as Record<string, unknown>).token;
        if (typeof token === "string") await purgeWarpSub(origin, securePath, token);
      }),
    );
    if (res.list_complete !== false) break;
    cursor = res.cursor;
    if (cursor === undefined || cursor.length === 0) break;
  }
}
