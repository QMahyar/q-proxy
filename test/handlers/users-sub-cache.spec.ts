import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleUserSub } from "../../src/handlers/users-sub";
import { USERS_KEY, hashToken, clearUsersMemoForTests, clearUserTotalsForTests } from "../../src/users/store";
import type { UserAccount } from "../../src/users/store";
import type { Settings } from "../../src/types/settings";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

class CountingKV {
  map = new Map<string, string>();
  puts = 0;
  async get(key: string): Promise<unknown> {
    const raw = this.map.get(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  async put(key: string, value: string): Promise<void> {
    this.puts += 1;
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  asEnv() {
    return { QPROXY_KV: this };
  }
}

const TOKEN = "22222222-2222-4222-8222-222222222222";

function baseSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    securePath: "s",
    vlessUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    addresses: [{ address: "1.1.1.1", port: 443, label: "Global" }],
  };
}

async function userRows(over: Partial<UserAccount> = {}): Promise<Record<string, unknown>> {
  const user: UserAccount = {
    id: "u-1",
    name: "tester",
    tokenHash: await hashToken(TOKEN),
    tokenHint: "22222222…",
    enabled: true,
    expiresAt: null,
    dailyReqLimit: null,
    protocols: "all",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
  return { [USERS_KEY]: [user] };
}

function seedUser(into: CountingKV, over: Partial<UserAccount> = {}): Promise<void> {
  return userRows(over).then((rows) => {
    into.map.set(USERS_KEY, JSON.stringify(rows[USERS_KEY]));
  });
}

const SUB_URL = `https://w.test/s/sub/u/${TOKEN}?target=base64`;

function edgeCacheStub() {
  const store = new Map<string, Response>();
  let hits = 0;
  return {
    store,
    hitCount: () => hits,
    caches: {
      default: {
        match: async (req: Request): Promise<Response | undefined> => {
          const found = store.get(req.url);
          if (found !== undefined) hits += 1;
          return found;
        },
        put: async (req: Request, res: Response): Promise<void> => {
          store.set(req.url, res);
        },
      },
    },
  };
}

const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("handleUserSub edge-cache ordering", () => {
  let kv: CountingKV;
  let edge: ReturnType<typeof edgeCacheStub>;

  beforeEach(() => {
    kv = new CountingKV();
    edge = edgeCacheStub();
    vi.stubGlobal("caches", edge.caches);
    clearUsersMemoForTests();
    clearUserTotalsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves an edge-cache hit with zero KV writes", async () => {
    await seedUser(kv);

    const first = (await handleUserSub(new Request(SUB_URL), kv.asEnv() as never, baseSettings())) as Response;
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    await flushMicrotasks();
    expect(edge.store.size).toBe(1);
    expect(kv.puts).toBeGreaterThanOrEqual(1);

    kv.puts = 0;
    const second = (await handleUserSub(new Request(SUB_URL), kv.asEnv() as never, baseSettings())) as Response;
    expect(second.status).toBe(200);
    expect(edge.hitCount()).toBe(1);
    expect(kv.puts).toBe(0);
    expect(await second.text()).toBe(firstBody);
  });

  it("still 429s an exhausted user on an edge-cache hit", async () => {
    await seedUser(kv, { dailyReqLimit: 1 });

    const first = (await handleUserSub(new Request(SUB_URL), kv.asEnv() as never, baseSettings())) as Response;
    expect(first.status).toBe(200);
    await first.text();
    await flushMicrotasks();
    expect(edge.store.size).toBe(1);

    const second = (await handleUserSub(new Request(SUB_URL), kv.asEnv() as never, baseSettings())) as Response;
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(kv.puts).toBe(1);
  });
});
