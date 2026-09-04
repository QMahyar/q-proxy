// @ts-expect-error node builtin available in the unit (node) project only
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  D1_SCHEMA,
  MAX_USERS,
  USER_ACTIVITY_DEFAULT_DAYS,
  USER_ACTIVITY_MAX_DAYS,
  USER_ACTIVITY_PREFIX,
  USER_USAGE_PREFIX,
  USER_TOTAL_PREFIX,
  USERS_KEY,
  findUserByToken,
  consumeUserHit,
  getUserActivity,
  getUserHits,
  getUserTotalHits,
  hashToken,
  listUsers,
  migrateUserUsage,
  newUserToken,
  normalizeProtocols,
  recordUserActivity,
  sanitizeUser,
  saveUsers,
  tokenHintFor,
  clearUsersMemoForTests,
  clearUserActivityForTests,
  clearUserTotalsForTests,
  flushPendingUserActivity,
  flushPendingUserTotals,
  type UserAccount,
} from "../../src/users/store";
import { dayKeyUtc } from "../../src/utils/time";

class FakeKV {
  map = new Map<string, string>();
  putCalls = 0;
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
    this.putCalls += 1;
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  puts(): number {
    return this.putCalls;
  }
  asEnv() {
    return { QPROXY_KV: this };
  }
}

async function mkUser(over: Partial<UserAccount> & { token?: string } = {}): Promise<UserAccount> {
  const plain = over.token ?? "22222222-2222-4222-8222-222222222222";
  const tokenHash = await hashToken(plain);
  const tokenHint = tokenHintFor(plain);
  const base: UserAccount = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alice",
    tokenHash,
    tokenHint,
    enabled: true,
    expiresAt: null,
    dailyReqLimit: null,
    protocols: "all",
    createdAt: "2026-08-25T00:00:00.000Z",
  };
  const { token: _t, ...rest } = over as Record<string, unknown>;
  return { ...base, ...(rest as Partial<UserAccount>) };
}

function mkLegacyRaw(token = "22222222-2222-4222-8222-222222222222", over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alice",
    token,
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
  clearUsersMemoForTests();
  clearUserActivityForTests();
  clearUserTotalsForTests();
});

describe("users store", () => {
  it("normalizes protocols to known kinds and drops garbage", () => {
    expect(normalizeProtocols("all")).toBe("all");
    expect(normalizeProtocols(["vless", "vmess"])).toEqual(["vless", "vmess"]);
    expect(normalizeProtocols(["vmess", "vmess", "vless"])).toEqual(["vmess", "vless"]);
    expect(normalizeProtocols(["__proto__", "vless", "smtp", 7, null])).toEqual(["vless"]);
    expect(normalizeProtocols([])).toEqual([]);
    expect(normalizeProtocols(undefined)).toBe("all");
    expect(normalizeProtocols({ hacked: true })).toBe("all");
  });

  it("sanitizes stored modern users with malformed fields", async () => {
    const env = kv.asEnv();
    const alice = await mkUser();
    const raw = JSON.parse(JSON.stringify(alice));
    raw.protocols = ["vless", "__proto__", "bogus"];
    raw.enabled = "yes";
    raw.expiresAt = "soon";
    raw.dailyReqLimit = -5;
    kv.map.set(USERS_KEY, JSON.stringify([raw]));
    const users = await listUsers(env);
    expect(users).toHaveLength(1);
    expect(users[0]!.protocols).toEqual(["vless"]);
    expect(users[0]!.enabled).toBe(true);
    expect(users[0]!.expiresAt).toBeNull();
  });

  it("normalizes legacy user protocols on migration", async () => {
    const env = kv.asEnv();
    kv.map.set(USERS_KEY, JSON.stringify([mkLegacyRaw("22222222-2222-4222-8222-222222222222", { protocols: ["trojan", "nope"] })]));
    const users = await listUsers(env);
    expect(users).toHaveLength(1);
    expect(users[0]!.protocols).toEqual(["trojan"]);
  });

  it("returns an empty list when the key is missing or corrupt", async () => {
    expect(await listUsers(kv.asEnv())).toEqual([]);
    kv.map.set(USERS_KEY, "{not json");
    expect(await listUsers(kv.asEnv())).toEqual([]);
  });

  it("saves, lists and drops malformed entries", async () => {
    const env = kv.asEnv();
    const alice = await mkUser();
    const bob = await mkUser({
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
    const alice = await mkUser();
    await saveUsers(env, [alice]);
    expect((await findUserByToken(env, "22222222-2222-4222-8222-222222222222"))!.id).toBe(alice.id);
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

  it("sanitizes to the exact public field set, exposing tokenHint but never token or tokenHash", async () => {
    const u = await mkUser({ dailyReqLimit: 100, expiresAt: 1893456000000 });
    const view = sanitizeUser(u);
    expect(Object.keys(view).sort()).toEqual(
      ["addressOverride", "createdAt", "dailyReqLimit", "enabled", "expiresAt", "id", "name", "protocols", "tokenHint"].sort(),
    );
    expect((view as Record<string, unknown>).token).toBeUndefined();
    expect((view as Record<string, unknown>).tokenHash).toBeUndefined();
    expect(view.tokenHint).toBe(u.tokenHint);
    expect(view.addressOverride).toBeNull();
  });

  it("persists addressOverride through save and list round-trip", async () => {
    const env = kv.asEnv();
    const alice = await mkUser({
      addressOverride: { address: "1.2.3.4", port: 2053, host: "cdn.example.com", sni: "sni.example.com", label: "Pinned" },
    });
    await saveUsers(env, [alice]);
    const raw = JSON.parse(kv.map.get(USERS_KEY)!) as Record<string, unknown>[];
    expect(raw[0]!.addressOverride).toEqual(alice.addressOverride);
    const users = await listUsers(env);
    expect(users).toHaveLength(1);
    expect(users[0]!.addressOverride).toEqual({
      address: "1.2.3.4",
      port: 2053,
      host: "cdn.example.com",
      sni: "sni.example.com",
      label: "Pinned",
    });
  });

  it("normalizes malformed stored overrides to null and drops unknown keys", async () => {
    const env = kv.asEnv();
    const alice = await mkUser();
    const garbage = JSON.parse(JSON.stringify(alice));
    garbage.addressOverride = "not-an-object";
    const missingAddress = JSON.parse(JSON.stringify(alice));
    missingAddress.id = "44444444-4444-4444-8444-444444444444";
    missingAddress.addressOverride = { port: 443 };
    const messy = JSON.parse(JSON.stringify(alice));
    messy.id = "55555555-5555-4555-8555-555555555555";
    messy.addressOverride = {
      address: " 1.2.3.4 ",
      port: 2053,
      host: " host.example.com ",
      sneaky: true,
      __proto__: { hacked: true },
    };
    kv.map.set(USERS_KEY, JSON.stringify([garbage, missingAddress, messy]));
    const users = await listUsers(env);
    expect(users[0]!.addressOverride).toBeNull();
    expect(users[1]!.addressOverride).toBeNull();
    expect(users[2]!.addressOverride).toEqual({
      address: "1.2.3.4",
      port: 2053,
      host: "host.example.com",
    });
    expect((users[2]!.addressOverride as unknown as Record<string, unknown>).sneaky).toBeUndefined();
  });

  it("sanitizeUser exposes addressOverride when set", async () => {
    const u = await mkUser({ addressOverride: { address: "5.6.7.8", port: 443 } });
    const view = sanitizeUser(u) as Record<string, unknown>;
    expect(view.addressOverride).toEqual({ address: "5.6.7.8", port: 443 });
    expect(view.tokenHash).toBeUndefined();
    expect(view.token).toBeUndefined();
  });

  it("records and reads per-token daily hits via hashed keys", async () => {
    const env = kv.asEnv();
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(0);
    await consumeUserHit(env, "22222222-2222-4222-8222-222222222222", null);
    await consumeUserHit(env, "22222222-2222-4222-8222-222222222222", null);
    await consumeUserHit(env, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", null);
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(2);
    expect(await getUserHits(env, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(1);
    expect(kv.map.has(USER_USAGE_PREFIX + new Date().toISOString().slice(0, 10))).toBe(false);
  });

  it("stores usage in per-hash keys, never the plaintext token", async () => {
    const env = kv.asEnv();
    const token = "77777777-7777-4777-8777-777777777777";
    await consumeUserHit(env, token, null);
    await consumeUserHit(env, token, null);
    const hash = await hashToken(token);
    const raw = kv.map.get(USER_USAGE_PREFIX + new Date().toISOString().slice(0, 10) + ":" + hash)!;
    expect(raw).toBe("2");
    for (const key of kv.map.keys()) {
      expect(key).not.toContain(token);
    }
    expect(await getUserHits(env, token)).toBe(2);
    expect(await getUserTotalHits(env, token)).toBe(2);
  });

  it("rekeys legacy plaintext usage rows on the first read", async () => {
    const env = kv.asEnv();
    const token = "88888888-8888-4888-8888-888888888888";
    const hash = await hashToken(token);
    kv.map.set(
      USER_USAGE_PREFIX + new Date().toISOString().slice(0, 10),
      JSON.stringify([{ token, count: 4 }]),
    );
    expect(await getUserHits(env, token)).toBe(4);
    expect(kv.map.get(USER_USAGE_PREFIX + new Date().toISOString().slice(0, 10) + ":" + hash)).toBe("4");
    await consumeUserHit(env, token, null);
    expect(await getUserHits(env, token)).toBe(5);
  });

  it("tolerates corrupt usage rows", async () => {
    const env = kv.asEnv();
    kv.map.set(USER_USAGE_PREFIX + "2026-08-25", JSON.stringify([{ token: "x", count: "bad" }, 7]));
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(0);
    await consumeUserHit(env, "22222222-2222-4222-8222-222222222222", null);
    expect(await getUserHits(env, "22222222-2222-4222-8222-222222222222")).toBe(1);
  });

  it("consumeUserHit enforces the daily limit and reports hits", async () => {
    const env = kv.asEnv();
    const token = "99999999-9999-4999-8999-999999999999";
    expect(await consumeUserHit(env, token, 2)).toEqual({ allowed: true, hits: 1, total: 1 });
    expect(await consumeUserHit(env, token, 2)).toEqual({ allowed: true, hits: 2, total: 2 });
    expect(await consumeUserHit(env, token, 2)).toEqual({ allowed: false, hits: 2, total: 2 });
    expect(await getUserHits(env, token)).toBe(2);
  });

  it("batches lifetime total writes until the flush threshold", async () => {
    const env = kv.asEnv();
    const token = "77777777-7777-4777-8777-777777777777";
    const hash = await hashToken(token);
    const totalKey = USER_TOTAL_PREFIX + hash;
    for (let i = 0; i < 3; i++) await consumeUserHit(env, token, null);
    expect(kv.map.has(totalKey)).toBe(false);
    expect(await getUserTotalHits(env, token)).toBe(3);
    await flushPendingUserTotals(env);
    expect(kv.map.get(totalKey)).toBe("3");
    expect(await getUserTotalHits(env, token)).toBe(3);
  });

  it("does not write usage or totals when the daily limit is already exhausted", async () => {
    const env = kv.asEnv();
    const token = "88888888-8888-4888-8888-888888888888";
    const hash = await hashToken(token);
    await consumeUserHit(env, token, 1);
    const totalKey = USER_TOTAL_PREFIX + hash;
    kv.map.delete(totalKey);
    const putsBefore = kv.puts();
    expect(await consumeUserHit(env, token, 1)).toEqual({ allowed: false, hits: 1, total: 1 });
    expect(kv.puts()).toBe(putsBefore);
    expect(kv.map.has(totalKey)).toBe(false);
  });

  it("caps the directory at 50 users", () => {
    expect(MAX_USERS).toBe(50);
  });

  it("keeps the embedded d1 schema in sync with migrations/0001_init.sql", () => {
    const sql = readFileSync("migrations/0001_init.sql", "utf8");
    const norm = (s: string): string =>
      s
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join("\n");
    expect(norm(D1_SCHEMA)).toBe(norm(sql));
    for (const table of ["users", "user_totals", "user_usage", "user_activity", "counters", "audit_log", "meta"]) {
      expect(D1_SCHEMA).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("hashes tokens to sha256 hex and round-trips via findUserByToken", async () => {
    const env = kv.asEnv();
    const plain = "33333333-3333-4333-8333-333333333333";
    const hash = await hashToken(plain);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const hint = tokenHintFor(plain);
    expect(hint).toBe(plain.slice(0, 8) + "…");
    const user: UserAccount = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Hashed",
      tokenHash: hash,
      tokenHint: hint,
      enabled: true,
      expiresAt: null,
      dailyReqLimit: null,
      protocols: "all",
      createdAt: new Date().toISOString(),
    };
    await saveUsers(env, [user]);
    const raw = kv.map.get(USERS_KEY)!;
    expect(raw).not.toContain(plain);
    expect(raw).toContain(hash);
    expect(await findUserByToken(env, plain)).not.toBeNull();
    expect((await findUserByToken(env, plain))!.id).toBe(user.id);
  });

  it("lazy-migrates legacy plaintext token records without persisting the plaintext", async () => {
    const env = kv.asEnv();
    const legacyToken = "44444444-4444-4444-8444-444444444444";
    const legacy = mkLegacyRaw(legacyToken);
    kv.map.set(USERS_KEY, JSON.stringify([legacy]));
    const users = await listUsers(env);
    expect(users.length).toBe(1);
    expect(users[0]!.tokenHash).toBe(await hashToken(legacyToken));
    expect(users[0]!.tokenHint).toBe(legacyToken.slice(0, 8) + "…");
    expect((users[0] as unknown as Record<string, unknown>).token).toBeUndefined();
    expect(await findUserByToken(env, legacyToken)).not.toBeNull();
    await saveUsers(env, users);
    const persisted = JSON.parse(kv.map.get(USERS_KEY)!) as unknown[];
    const rec = persisted[0] as Record<string, unknown>;
    expect(rec.token).toBeUndefined();
    expect(rec.tokenHash).toBe(await hashToken(legacyToken));
  });

  it("memoizes the users array in-isolate and refreshes on save", async () => {
    const env = kv.asEnv();
    const token = "22222222-2222-4222-8222-222222222222";
    await saveUsers(env, [await mkUser()]);
    kv.map.delete(USERS_KEY);
    expect(await findUserByToken(env, token)).not.toBeNull();

    const listed = await listUsers(env);
    listed.pop();
    expect((await listUsers(env)).length).toBe(1);

    await saveUsers(env, []);
    expect(await findUserByToken(env, token)).toBeNull();
  });

  it("tokenHint is first 8 chars plus ellipsis", () => {
    expect(tokenHintFor("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe("aaaaaaaa…");
    expect(tokenHintFor("12345678-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("12345678…");
  });

  it("migrates usage rows on token regeneration", async () => {
    const env = kv.asEnv();
    const oldPlain = "55555555-5555-4555-8555-555555555555";
    const newPlain = "66666666-6666-4666-8666-666666666666";
    const oldHash = await hashToken(oldPlain);
    await consumeUserHit(env, oldPlain, null);
    await consumeUserHit(env, oldPlain, null);
    await consumeUserHit(env, oldPlain, null);
    expect(await getUserHits(env, oldPlain)).toBe(3);
    expect(await getUserTotalHits(env, oldPlain)).toBe(3);
    await migrateUserUsage(env, oldHash, newPlain);
    expect(await getUserHits(env, oldPlain)).toBe(0);
    expect(await getUserHits(env, newPlain)).toBe(3);
    expect(await getUserTotalHits(env, oldPlain)).toBe(0);
    expect(await getUserTotalHits(env, newPlain)).toBe(3);
  });

  it("migrates legacy same-day plaintext rows on token regeneration", async () => {
    const env = kv.asEnv();
    const oldPlain = "55555555-5555-4555-8555-555555555555";
    const newPlain = "66666666-6666-4666-8666-666666666666";
    const oldHash = await hashToken(oldPlain);
    const legacyKey = USER_USAGE_PREFIX + new Date().toISOString().slice(0, 10);
    kv.map.set(legacyKey, JSON.stringify([{ token: oldPlain, count: 3 }]));
    await migrateUserUsage(env, oldHash, newPlain);
    expect(await getUserHits(env, oldPlain)).toBe(0);
    expect(await getUserHits(env, newPlain)).toBe(3);
    expect(kv.map.has(legacyKey)).toBe(false);
  });

  it("sanitizeUser never exposes tokenHash or token", async () => {
    const u = await mkUser();
    const sanitized = sanitizeUser(u) as Record<string, unknown>;
    expect(sanitized.tokenHash).toBeUndefined();
    expect(sanitized.token).toBeUndefined();
    expect(typeof sanitized.tokenHint).toBe("string");
  });

  it("aggregates request and byte deltas into today's activity row", async () => {
    const env = kv.asEnv();
    const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const hash = await hashToken(token);
    const today = dayKeyUtc();
    const key = USER_ACTIVITY_PREFIX + today + ":" + hash;
    await recordUserActivity(env, token, { requests: 2, bytesUp: 100, bytesDown: 200 });
    await recordUserActivity(env, hash, { requests: 3, bytesUp: 50 });
    await recordUserActivity(env, token, { bytesDown: 25 });
    expect(kv.map.has(key)).toBe(false);
    expect(await getUserActivity(env, token, 1)).toEqual([
      { day: today, requests: 5, bytesUp: 150, bytesDown: 225 },
    ]);
    const putsBefore = kv.puts();
    await flushPendingUserActivity(env);
    expect(kv.map.get(key)).toBe(JSON.stringify({ day: today, requests: 5, bytesUp: 150, bytesDown: 225 }));
    expect(await getUserActivity(env, token, 1)).toEqual([
      { day: today, requests: 5, bytesUp: 150, bytesDown: 225 },
    ]);
    await flushPendingUserActivity(env);
    expect(kv.puts()).toBe(putsBefore + 1);
  });

  it("keeps per-day rows across the UTC midnight rollover in chronological order", async () => {
    const env = kv.asEnv();
    const token = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const hash = await hashToken(token);
    const today = dayKeyUtc();
    const yesterday = dayKeyUtc(new Date(Date.now() - 86400000));
    expect(yesterday).not.toBe(today);
    kv.map.set(
      USER_ACTIVITY_PREFIX + yesterday + ":" + hash,
      JSON.stringify({ day: yesterday, requests: 4, bytesUp: 10, bytesDown: 20 }),
    );
    await recordUserActivity(env, token, { requests: 1 });
    const rows = await getUserActivity(env, token, 2);
    expect(rows.map((r) => r.day)).toEqual([yesterday, today]);
    expect(rows[0]).toEqual({ day: yesterday, requests: 4, bytesUp: 10, bytesDown: 20 });
    expect(rows[1]).toEqual({ day: today, requests: 1, bytesUp: 0, bytesDown: 0 });
    const week = await getUserActivity(env, token, 7);
    expect(week).toHaveLength(7);
    expect(week[6]).toEqual({ day: today, requests: 1, bytesUp: 0, bytesDown: 0 });
    for (const r of week.slice(0, 5)) expect(r).toEqual({ day: r.day, requests: 0, bytesUp: 0, bytesDown: 0 });
  });

  it("consumeUserHit bumps the activity row with zero bytes until the tunnel wiring follow-up", async () => {
    const env = kv.asEnv();
    const token = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const today = dayKeyUtc();
    await consumeUserHit(env, token, null);
    await consumeUserHit(env, token, null);
    expect(await getUserActivity(env, token, 1)).toEqual([
      { day: today, requests: 2, bytesUp: 0, bytesDown: 0 },
    ]);
  });

  it("denied quota hits do not bump the activity row", async () => {
    const env = kv.asEnv();
    const token = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const today = dayKeyUtc();
    expect(await consumeUserHit(env, token, 1)).toMatchObject({ allowed: true });
    expect(await consumeUserHit(env, token, 1)).toMatchObject({ allowed: false });
    expect(await getUserActivity(env, token, 1)).toEqual([
      { day: today, requests: 1, bytesUp: 0, bytesDown: 0 },
    ]);
  });

  it("stores activity under hashed keys and parses partial rows migrate-safe", async () => {
    const env = kv.asEnv();
    const token = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const hash = await hashToken(token);
    const today = dayKeyUtc();
    kv.map.set(USER_ACTIVITY_PREFIX + today + ":" + hash, JSON.stringify({ day: today, requests: 5 }));
    expect(await getUserActivity(env, token, 1)).toEqual([
      { day: today, requests: 5, bytesUp: 0, bytesDown: 0 },
    ]);
    await recordUserActivity(env, token, { requests: 1, bytesUp: 7, bytesDown: 9 });
    expect(await getUserActivity(env, token, 1)).toEqual([
      { day: today, requests: 6, bytesUp: 7, bytesDown: 9 },
    ]);
    await flushPendingUserActivity(env);
    kv.map.set(USER_ACTIVITY_PREFIX + today + ":" + hash, "{not json");
    expect(await getUserActivity(env, token, 1)).toEqual([
      { day: today, requests: 0, bytesUp: 0, bytesDown: 0 },
    ]);
    for (const key of kv.map.keys()) expect(key).not.toContain(token);
  });

  it("clamps the activity window to 1..31 days", async () => {
    const env = kv.asEnv();
    const token = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    expect(await getUserActivity(env, token, 0)).toHaveLength(1);
    expect(await getUserActivity(env, token, 1000)).toHaveLength(USER_ACTIVITY_MAX_DAYS);
    expect(await getUserActivity(env, token, Number.NaN)).toHaveLength(USER_ACTIVITY_DEFAULT_DAYS);
    expect(USER_ACTIVITY_MAX_DAYS).toBe(31);
  });

  it("migrates activity rows on token regeneration", async () => {
    const env = kv.asEnv();
    const oldPlain = "11111111-1111-4111-8111-111111111111";
    const newPlain = "22222222-2222-4222-8222-222222222222";
    const oldHash = await hashToken(oldPlain);
    const newHash = await hashToken(newPlain);
    const today = dayKeyUtc();
    await consumeUserHit(env, oldPlain, null);
    await consumeUserHit(env, oldPlain, null);
    await recordUserActivity(env, oldPlain, { bytesUp: 40, bytesDown: 60 });
    await migrateUserUsage(env, oldHash, newPlain);
    expect(await getUserActivity(env, newPlain, 1)).toEqual([
      { day: today, requests: 2, bytesUp: 40, bytesDown: 60 },
    ]);
    expect(await getUserActivity(env, oldPlain, 1)).toEqual([
      { day: today, requests: 0, bytesUp: 0, bytesDown: 0 },
    ]);
    expect(kv.map.has(USER_ACTIVITY_PREFIX + today + ":" + oldHash)).toBe(false);
    expect(kv.map.has(USER_ACTIVITY_PREFIX + today + ":" + newHash)).toBe(true);
  });
});
