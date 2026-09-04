import { beforeEach, describe, expect, it } from "vitest";
import { env as cfEnv } from "cloudflare:test";
import {
  applyD1Schema,
  clearLegacyKvForMigration,
  resetD1,
  seedLegacyKvForMigration,
} from "../helpers/seed";
import {
  bootstrapD1,
  clearUserActivityForTests,
  clearUserTotalsForTests,
  clearUsersMemoForTests,
  consumeUserHit,
  findUserByToken,
  getUserActivity,
  getUserHits,
  getUserTotalHits,
  listUsers,
  migrateUserUsage,
  recordUserActivity,
  saveUsers,
} from "../../src/users/store";
import { clearCounterBufferForTests, clearUsageMemoForTests, readUsage, recordConnection } from "../../src/core/counters";
import { audit } from "../../src/core/log";
import type { Env } from "../../src/types/env";

const env: Env = cfEnv as unknown as Env;
const db = env.QPROXY_DB;
const kv = env.QPROXY_KV;

async function guardRow(): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind("kv_migrated_v1").first<{ value: string }>();
  return row === null ? null : row.value;
}

async function kvUserKeys(): Promise<string[]> {
  const out: string[] = [];
  for (const prefix of ["qproxy:user-usage:", "qproxy:user-total:", "qproxy:user-activity:"]) {
    const page = await kv.list({ prefix });
    for (const k of page.keys) out.push(k.name);
  }
  return out;
}

async function waitForAudit(action: string): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const row = await db
      .prepare("SELECT ts, ip, action, detail FROM audit_log WHERE action = ?")
      .bind(action)
      .first<{ ts: number; ip: string; action: string; detail: string }>();
    if (row !== null) return row as unknown as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

beforeEach(async () => {
  clearUsersMemoForTests();
  clearUserTotalsForTests();
  clearUserActivityForTests();
  clearUsageMemoForTests();
  clearCounterBufferForTests();
  await applyD1Schema(db);
  await resetD1(db);
  await clearLegacyKvForMigration(kv);
});

describe("kv to d1 migration", () => {
  it("copies legacy kv state into empty d1 tables and deletes the legacy keys", async () => {
    const fx = await seedLegacyKvForMigration(kv);
    await bootstrapD1(env);

    const users = await listUsers(env);
    expect(users).toHaveLength(2);
    const modern = users.find((u) => u.name === "Modern")!;
    expect(modern.tokenHash).toBe(fx.modernHash);
    expect(modern.protocols).toEqual(["vless", "ss"]);
    expect(modern.dailyReqLimit).toBe(5);
    const legacy = users.find((u) => u.name === "Legacy")!;
    expect(legacy.tokenHash).toBe(fx.legacyHash);
    expect(legacy.tokenHint).toBe(fx.legacyToken.slice(0, 8) + "…");
    expect(legacy.enabled).toBe(false);
    expect((legacy as unknown as Record<string, unknown>).token).toBeUndefined();

    expect((await findUserByToken(env, fx.modernToken))!.id).toBe(modern.id);
    expect((await findUserByToken(env, fx.legacyToken))!.id).toBe(legacy.id);

    expect(await getUserHits(env, fx.modernToken)).toBe(3);
    expect(await getUserHits(env, fx.legacyToken)).toBe(4);
    expect(await getUserTotalHits(env, fx.modernToken)).toBe(9);
    expect(await getUserTotalHits(env, fx.legacyToken)).toBe(7);
    expect(await getUserActivity(env, fx.modernToken, 1)).toEqual([
      { day: fx.today, requests: 5, bytesUp: 50, bytesDown: 60 },
    ]);

    const usage = await readUsage(env);
    expect(usage.requestsToday).toBe(11);
    expect(usage.requestsTotal).toBe(100);
    expect(usage.bytesUpTotal).toBe(70);
    expect(usage.bytesDownTotal).toBe(80);

    expect(await guardRow()).not.toBeNull();
    expect(await kv.get("qproxy:users")).toBeNull();
    expect(await kv.get("qproxy:counters")).toBeNull();
    expect(await kvUserKeys()).toEqual([]);
  });

  it("is idempotent and keeps post-migration writes on d1", async () => {
    const fx = await seedLegacyKvForMigration(kv);
    await bootstrapD1(env);
    await bootstrapD1(env);

    expect(await listUsers(env)).toHaveLength(2);
    expect(await getUserHits(env, fx.modernToken)).toBe(3);
    expect(await getUserTotalHits(env, fx.modernToken)).toBe(9);

    expect(await consumeUserHit(env, fx.modernToken, 5)).toEqual({ allowed: true, hits: 4, total: 10 });
    expect(await consumeUserHit(env, fx.modernToken, 5)).toEqual({ allowed: true, hits: 5, total: 11 });
    expect(await consumeUserHit(env, fx.modernToken, 5)).toEqual({ allowed: false, hits: 5, total: 11 });
    expect(await getUserHits(env, fx.modernToken)).toBe(5);
    expect(await getUserTotalHits(env, fx.modernToken)).toBe(11);
    expect(await getUserActivity(env, fx.modernToken, 1)).toEqual([
      { day: fx.today, requests: 7, bytesUp: 50, bytesDown: 60 },
    ]);

    for (let i = 0; i < 32; i++) await recordConnection(env);
    const usage = await readUsage(env);
    expect(usage.requestsToday).toBe(11 + 32);
    expect(usage.requestsTotal).toBe(100 + 32);

    expect(await kv.get("qproxy:counters")).toBeNull();
    expect(await kvUserKeys()).toEqual([]);
  });

  it("skips the copy when d1 already holds rows and only sets the guard", async () => {
    await saveUsers(env, [
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Existing",
        tokenHash: "a".repeat(64),
        tokenHint: "aaaaaaaa…",
        enabled: true,
        expiresAt: null,
        dailyReqLimit: null,
        protocols: "all",
        createdAt: new Date().toISOString(),
      },
    ]);
    await seedLegacyKvForMigration(kv);
    await bootstrapD1(env);

    expect((await listUsers(env)).map((u) => u.name)).toEqual(["Existing"]);
    expect(await kv.get("qproxy:users")).not.toBeNull();
    expect(await guardRow()).not.toBeNull();

    await bootstrapD1(env);
    expect((await listUsers(env)).map((u) => u.name)).toEqual(["Existing"]);
  });

  it("moves quota, activity and totals on token regeneration without a directory save", async () => {
    const fx = await seedLegacyKvForMigration(kv);
    await bootstrapD1(env);
    const replacement = "cccccccc-dddd-4eee-8fff-000000000000";
    await migrateUserUsage(env, fx.modernToken, replacement);

    expect(await getUserHits(env, fx.modernToken)).toBe(0);
    expect(await getUserHits(env, replacement)).toBe(3);
    expect(await getUserTotalHits(env, fx.modernToken)).toBe(0);
    expect(await getUserTotalHits(env, replacement)).toBe(9);
    expect(await getUserActivity(env, replacement, 1)).toEqual([
      { day: fx.today, requests: 5, bytesUp: 50, bytesDown: 60 },
    ]);
    expect(await getUserActivity(env, fx.modernToken, 1)).toEqual([
      { day: fx.today, requests: 0, bytesUp: 0, bytesDown: 0 },
    ]);
  });

  it("records activity deltas straight into d1 rows", async () => {
    const fx = await seedLegacyKvForMigration(kv);
    await bootstrapD1(env);
    await recordUserActivity(env, fx.legacyToken, { requests: 2, bytesUp: 10, bytesDown: 20 });
    expect(await getUserActivity(env, fx.legacyToken, 1)).toEqual([
      { day: fx.today, requests: 2, bytesUp: 10, bytesDown: 20 },
    ]);
    expect(await kvUserKeys()).toEqual([]);
  });

  it("appends audit rows without failing the request", async () => {
    await bootstrapD1(env);
    audit("test.action", { ip: "203.0.113.9", aging: 7 }, env);
    const row = await waitForAudit("test.action");
    expect(row).not.toBeNull();
    expect(row!.ip).toBe("203.0.113.9");
    expect(row!.action).toBe("test.action");
    expect(JSON.parse(row!.detail as string)).toEqual({ ip: "203.0.113.9", aging: 7 });
    expect(typeof row!.ts).toBe("number");

    audit("test.noenv", { ip: "203.0.113.10" });
    audit("test.nodb", { ip: "203.0.113.11" }, {});
    expect(await waitForAudit("test.noenv")).toBeNull();
  });
});
