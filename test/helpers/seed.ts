import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { ensureD1Schema } from "../../src/users/store";
import { invalidateSettingsCache } from "../../src/settings/store";
import { SESSION_FLOOR_KEY, clearSessionFloorCache } from "../../src/auth/session";
import { LOGIN_FAIL_PREFIX, clearLoginFailures, clientIp } from "../../src/auth/guard";
import { clearRemoteSubCache } from "../../src/subscription/merge";
import { clearSaltRegistry } from "../../src/protocols/shadowsocks";
import { clearVmessReplayCache } from "../../src/protocols/vmess";

export const SETTINGS_KEY = "qproxy:settings";

export function testKv(env: unknown): KVNamespace {
  return (env as { QPROXY_KV: KVNamespace }).QPROXY_KV;
}

export async function seed(
  kv: KVNamespace,
  securePath: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await kv.delete(SETTINGS_KEY);
  await kv.delete(SESSION_FLOOR_KEY);
  const listed = await kv.list({ prefix: LOGIN_FAIL_PREFIX });
  for (const key of listed.keys) await kv.delete(key.name);
  await kv.put(
    SETTINGS_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      data: { ...structuredClone(DEFAULT_SETTINGS), securePath, ...overrides },
    }),
  );
  invalidateSettingsCache();
  clearSessionFloorCache();
  clearRemoteSubCache();
  clearSaltRegistry();
  clearVmessReplayCache();
}

export function resetThrottle(): void {
  clearLoginFailures(clientIp(new Request("https://example.com/")));
}

export async function applyD1Schema(db: D1Database): Promise<void> {
  await ensureD1Schema(db);
}

export async function resetD1(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM user_activity"),
    db.prepare("DELETE FROM user_usage"),
    db.prepare("DELETE FROM user_totals"),
    db.prepare("DELETE FROM users"),
    db.prepare("DELETE FROM counters"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM meta"),
  ]);
}

export interface MigrationFixtureTokens {
  modernToken: string;
  legacyToken: string;
  modernHash: string;
  legacyHash: string;
  today: string;
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seedLegacyKvForMigration(kv: KVNamespace): Promise<MigrationFixtureTokens> {
  const today = new Date().toISOString().slice(0, 10);
  const modernToken = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const legacyToken = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
  const modernHash = await sha256Hex(modernToken);
  const legacyHash = await sha256Hex(legacyToken);
  await kv.put(
    "qproxy:users",
    JSON.stringify([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Modern",
        tokenHash: modernHash,
        tokenHint: modernToken.slice(0, 8) + "…",
        enabled: true,
        expiresAt: null,
        dailyReqLimit: 5,
        protocols: ["vless", "ss"],
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Legacy",
        token: legacyToken,
        enabled: false,
        expiresAt: null,
        dailyReqLimit: null,
        protocols: "all",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
    ]),
  );
  await kv.put(`qproxy:user-usage:${today}`, JSON.stringify([{ token: legacyToken, count: 4 }]));
  await kv.put(`qproxy:user-usage:${today}:${modernHash}`, "3");
  await kv.put(`qproxy:user-total:${modernHash}`, "9");
  await kv.put(`qproxy:user-total:${legacyHash}`, "7");
  await kv.put(
    `qproxy:user-activity:${today}:${modernHash}`,
    JSON.stringify({ day: today, requests: 5, bytesUp: 50, bytesDown: 60 }),
  );
  await kv.put(
    "qproxy:counters",
    JSON.stringify({ day: today, requestsToday: 11, requestsTotal: 100, bytesUpTotal: 70, bytesDownTotal: 80 }),
  );
  return { modernToken, legacyToken, modernHash, legacyHash, today };
}

export async function clearLegacyKvForMigration(kv: KVNamespace): Promise<void> {
  const names = new Set<string>(["qproxy:users", "qproxy:counters"]);
  for (const prefix of ["qproxy:user-usage:", "qproxy:user-total:", "qproxy:user-activity:"]) {
    let cursor: string | undefined = undefined;
    for (let i = 0; i < 10; i++) {
      const opts: { prefix: string; cursor?: string } = { prefix };
      if (cursor !== undefined) opts.cursor = cursor;
      const page: { keys: Array<{ name: string }>; list_complete: boolean; cursor?: string } = await kv.list(opts);
      for (const k of page.keys) names.add(k.name);
      if (page.list_complete || typeof page.cursor !== "string") break;
      cursor = page.cursor;
    }
  }
  await Promise.all([...names].map((k) => kv.delete(k)));
}
