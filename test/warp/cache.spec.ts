import { afterEach, describe, expect, it, vi } from "vitest";
import { purgeAllWarpSubs, purgeWarpSub } from "../../src/warp/cache";
import { WARP_FORMATS } from "../../src/warp/formats/registry";
import { WARP_ACCOUNT_PREFIX } from "../../src/warp/store";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface DeletedCall {
  url: string;
  method: string;
  ignoreSearch: boolean;
}

function stubCache(deleteImpl: (url: string) => boolean | Promise<boolean>): DeletedCall[] {
  const deleted: DeletedCall[] = [];
  vi.stubGlobal("caches", {
    default: {
      delete: async (req: Request, opts?: { ignoreSearch?: boolean }) => {
        deleted.push({ url: req.url, method: req.method, ignoreSearch: opts?.ignoreSearch === true });
        return deleteImpl(req.url);
      },
    },
  });
  return deleted;
}

function kvEnv(accounts: Record<string, unknown>, onList?: (prefix: string) => void) {
  const store = new Map<string, string>();
  for (const [name, value] of Object.entries(accounts)) store.set(name, JSON.stringify(value));
  return {
    QPROXY_KV: {
      list: async (options: { prefix: string; cursor?: string }) => {
        onList?.(options.prefix);
        return {
          keys: [...store.keys()].filter((k) => k.startsWith(options.prefix)).map((name) => ({ name })),
          list_complete: true,
        };
      },
      get: async (key: string, _type: string) => {
        const raw = store.get(key);
        return raw === undefined ? null : (JSON.parse(raw) as unknown);
      },
    },
  };
}

describe("purgeWarpSub", () => {
  it("no-ops when the cache storage is unavailable", async () => {
    vi.unstubAllGlobals();
    expect(typeof caches).toBe("undefined");
    await expect(purgeWarpSub("https://panel.example", "sp", "tok")).resolves.toBeUndefined();
  });

  it("deletes one GET copy per format with a widened match", async () => {
    const deleted = stubCache(() => true);
    await purgeWarpSub("https://panel.example", "sp123", "tok-1");
    expect(deleted).toHaveLength(WARP_FORMATS.length);
    const urls = deleted.map((d) => d.url);
    for (const format of WARP_FORMATS) {
      expect(urls).toContain(`https://panel.example/sp123/sub/wg/tok-1/${format}`);
    }
    expect(deleted.every((d) => d.method === "GET" && d.ignoreSearch)).toBe(true);
  });

  it("attempts every format even when individual deletes fail", async () => {
    const seen: string[] = [];
    const deleted = stubCache((url) => {
      seen.push(url);
      if (url.endsWith("/throne")) throw new Error("cache down");
      return true;
    });
    await expect(purgeWarpSub("https://panel.example", "sp123", "tok-1")).resolves.toBeUndefined();
    expect(seen).toHaveLength(WARP_FORMATS.length);
    expect(deleted).toHaveLength(WARP_FORMATS.length);
  });
});

describe("purgeAllWarpSubs", () => {
  it("never touches KV when the cache storage is unavailable", async () => {
    vi.unstubAllGlobals();
    let lists = 0;
    const env = kvEnv({}, () => {
      lists += 1;
    });
    await expect(purgeAllWarpSubs(env, "https://panel.example", "sp")).resolves.toBeUndefined();
    expect(lists).toBe(0);
  });

  it("purges every stored token and skips rows without one", async () => {
    const deleted = stubCache(() => true);
    const env = kvEnv({
      [`${WARP_ACCOUNT_PREFIX}good-1`]: { token: "tok-a" },
      [`${WARP_ACCOUNT_PREFIX}good-2`]: { token: "tok-b" },
      [`${WARP_ACCOUNT_PREFIX}no-token`]: { name: "nameless" },
      [`${WARP_ACCOUNT_PREFIX}null-token`]: { token: null },
      [`${WARP_ACCOUNT_PREFIX}null-row`]: null,
      [`${WARP_ACCOUNT_PREFIX}array-row`]: [1, 2],
      "other:key": { token: "tok-other" },
    });
    await purgeAllWarpSubs(env, "https://panel.example", "sp123");
    expect(deleted).toHaveLength(2 * WARP_FORMATS.length);
    const urls = deleted.map((d) => d.url);
    for (const token of ["tok-a", "tok-b"]) {
      for (const format of WARP_FORMATS) {
        expect(urls).toContain(`https://panel.example/sp123/sub/wg/${token}/${format}`);
      }
    }
    expect(urls.join("\n")).not.toContain("tok-other");
  });

  it("follows KV pagination cursors until the listing completes", async () => {
    const deleted = stubCache(() => true);
    const tokens: Record<string, string> = {
      [`${WARP_ACCOUNT_PREFIX}page-1`]: JSON.stringify({ token: "tok-p1" }),
      [`${WARP_ACCOUNT_PREFIX}page-2`]: JSON.stringify({ token: "tok-p2" }),
    };
    const seenCursors: Array<string | undefined> = [];
    const env = {
      QPROXY_KV: {
        list: async (options: { prefix: string; cursor?: string }) => {
          seenCursors.push(options.cursor);
          expect(options.prefix).toBe(WARP_ACCOUNT_PREFIX);
          if (options.cursor === undefined) {
            return { keys: [{ name: `${WARP_ACCOUNT_PREFIX}page-1` }], list_complete: false, cursor: "c1" };
          }
          return { keys: [{ name: `${WARP_ACCOUNT_PREFIX}page-2` }], list_complete: true };
        },
        get: async (key: string, _type: string) => JSON.parse(tokens[key] as string) as unknown,
      },
    };
    await purgeAllWarpSubs(env, "https://panel.example", "sp123");
    expect(seenCursors).toEqual([undefined, "c1"]);
    expect(deleted).toHaveLength(2 * WARP_FORMATS.length);
  });
});
