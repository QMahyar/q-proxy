import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { ensureD1Schema } from "../../src/settings/store";
import { invalidateSettingsCache } from "../../src/settings/store";
import { SESSION_FLOOR_KEY, clearSessionFloorCache } from "../../src/auth/session";
import { LOGIN_FAIL_PREFIX, clearLoginFailures, clientIp } from "../../src/auth/guard";

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
      version: 3,
      updatedAt: Date.now(),
      data: { ...structuredClone(DEFAULT_SETTINGS), securePath, ...overrides },
    }),
  );
  invalidateSettingsCache();
  clearSessionFloorCache();
}

export function resetThrottle(): void {
  clearLoginFailures(clientIp(new Request("https://example.com/")));
}

export async function applyD1Schema(db: D1Database): Promise<void> {
  await ensureD1Schema(db);
}

export async function resetD1(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM counters"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM meta"),
  ]);
}
