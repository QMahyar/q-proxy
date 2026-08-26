import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_USERS,
  USER_USAGE_PREFIX,
  USERS_KEY,
  findUserByToken,
  getUserHits,
  listUsers,
  newUserToken,
  recordUserHit,
  sanitizeUser,
  saveUsers,
  type UserAccount,
} from "../../src/users/store";

class FakeKV {
  map = new Map<string, string>();
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
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  asEnv() {
    return { QPROXY_KV: this };
  }
}

function mkUser(over: Partial<UserAccount> = {}): UserAccount {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alice",
    token: "22222222-2222-4222-8222-222222222222",
    enabled: true,
    expiresAt: null,
    dailyReqLimit: null,
    protocols: "all",
    createdAt: "2026-08-25T00:00:00.000Z",
    ...over,
  };
}

let kv: FakeKV;
beforeEach(() => {
  kv = new FakeKV();
});

describe("users store", () => {
  it("returns an empty list when the key is missing or corrupt", async () => {
    expect(await listUsers(kv.asEnv())).toEqual([]);
    kv.map.set(USERS_KEY, "{not json");
    expect(await listUsers(kv.asEnv())).toEqual([]);
  });

  it("saves, lists and drops malformed entries", async () => {
    const env = kv.asEnv();
    const alice = mkUser();
    const bob = mkUser({
      id: "99999999-9999-4999-8999-999999999999",
      name: "Bob",
      token: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      protocols: ["vless", "ss"],
    });
    await saveUsers(env, [alice, { broken: true } as unknown as UserAccount, bob]);
    const users = await listUsers(env);
    expect(users.length).toBe(2);
    expect(users.map((u) => u.name)).toEqual(["Alice", "Bob"]);
    expect(users[1]!.protocols).toEqual(["vless", "ss"]);
  });

  it("finds a user by token and rejects malformed or unknown tokens", async () => {
    const env = kv.asEnv();
    const alice = mkUser();
    await saveUsers(env, [alice]);
    expect((await findUserByToken(env, alice.token))!.id).toBe(alice.id);
    expect(await findUserByToken(env, "../etc/passwd")).toBeNull();
    expect(await findUserByToken(env, "")).toBeNull();
    expect(await findUserByToken(env, "33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("mints uuid tokens", () => {
    const a = newUserToken();
    const b = newUserToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it("sanitizes to the exact public field set, keeping the token as the credential", () => {
    const u = mkUser({ dailyReqLimit: 100, expiresAt: 1893456000000 });
    const view = sanitizeUser(u);
    expect(Object.keys(view).sort()).toEqual(
      [
        "createdAt",
        "dailyReqLimit",
        "enabled",
        "expiresAt",
        "id",
        "name",
        "protocols",
        "token",
      ].sort(),
    );
    expect(view.token).toBe(u.token);
  });

  it("records and reads per-token daily hits", async () => {
    const env = kv.asEnv();
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(0);
    await recordUserHit(env, "22222222-2222-4222-8222-222222222222");
    await recordUserHit(env, "22222222-2222-4222-8222-222222222222");
    await recordUserHit(env, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(2);
    expect(await getUserHits(env, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(1);
    expect(kv.map.has(USER_USAGE_PREFIX + new Date().toISOString().slice(0, 10))).toBe(true);
  });

  it("tolerates corrupt usage rows", async () => {
    const env = kv.asEnv();
    kv.map.set(USER_USAGE_PREFIX + "2026-08-25", JSON.stringify([{ token: "x", count: "bad" }, 7]));
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(0);
    await recordUserHit(env, "22222222-2222-4222-8222-222222222222");
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(1);
  });

  it("caps the directory at 50 users", () => {
    expect(MAX_USERS).toBe(50);
  });
});
