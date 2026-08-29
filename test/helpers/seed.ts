import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { invalidateSettingsCache } from "../../src/settings/store";
import { clearSessionFloorCache } from "../../src/auth/session";
import { clearLoginFailures, clientIp } from "../../src/auth/guard";
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
