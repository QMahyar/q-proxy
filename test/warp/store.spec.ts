import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRESETS,
  deleteAccount,
  ensureWarpDefaults,
  getAccount,
  getAccountByToken,
  getGlobalSettings,
  listAccounts,
  listPresets,
  regenerateToken,
  resolveAmnezia,
  sanitizeAccount,
  setGlobalSettings,
  storeAccount,
  validateAmnezia,
} from "../../src/warp/store";
import type { WarpAccount } from "../../src/types/warp";

class FakeKV {
  map = new Map<string, string>();
  async get(key: string): Promise<unknown> {
    const raw = this.map.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(options: { prefix: string }): Promise<{ keys: Array<{ name: string }> }> {
    return { keys: [...this.map.keys()].filter((k) => k.startsWith(options.prefix)).map((name) => ({ name })) };
  }
  asEnv() {
    return { QPROXY_KV: this };
  }
}

function mkAccount(): WarpAccount {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test Account",
    token: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-24T00:00:00.000Z",
    warp_id: "warp-device-id",
    warp_token: "warp-bearer-token",
    config: {
      private_key: "PRIV",
      public_key: "PUB",
      addresses: { ipv4: "10.2.0.2/32", ipv6: "fd00::/128" },
      peer_public_key: "PEER",
      mtu: 1280,
      reserved: [1, 2, 3],
    },
    endpoint_list: { type: "preset", preset_id: "default" },
    amnezia_overrides: null,
    dns: null,
  };
}

let kv: FakeKV;
beforeEach(() => {
  kv = new FakeKV();
});

describe("warp store", () => {
  it("seeds presets and global settings once", async () => {
    await ensureWarpDefaults(kv.asEnv());
    const presets = await listPresets(kv.asEnv());
    expect(presets.map((p) => p.id)).toEqual(["default", "iran", "china"]);
    expect((await getGlobalSettings(kv.asEnv())).amnezia.Jc).toBe(5);
    await ensureWarpDefaults(kv.asEnv());
    expect(kv.map.get("qproxy:warp:presets")).toBeDefined();
  });

  it("stores, lists, fetches by id and by token, sanitizes, deletes", async () => {
    const a = mkAccount();
    await storeAccount(kv.asEnv(), a);
    expect((await listAccounts(kv.asEnv())).length).toBe(1);
    expect((await getAccount(kv.asEnv(), a.id))?.name).toBe("Test Account");
    expect((await getAccountByToken(kv.asEnv(), a.token))?.id).toBe(a.id);
    expect(await getAccountByToken(kv.asEnv(), "../etc")).toBeNull();
    const view = sanitizeAccount(a);
    expect(JSON.stringify(view)).not.toContain("PRIV");
    expect(JSON.stringify(view)).not.toContain("warp-bearer-token");
    expect(view.config.public_key).toBe("PUB");
    expect(view.config.reserved).toEqual([1, 2, 3]);
    await deleteAccount(kv.asEnv(), a);
    expect(await getAccount(kv.asEnv(), a.id)).toBeNull();
    expect(await getAccountByToken(kv.asEnv(), a.token)).toBeNull();
  });

  it("regenerates the sub token and drops the old index", async () => {
    const a = mkAccount();
    await storeAccount(kv.asEnv(), a);
    const old = a.token;
    const next = await regenerateToken(kv.asEnv(), a);
    expect(next).not.toBe(old);
    expect(await getAccountByToken(kv.asEnv(), old)).toBeNull();
    expect((await getAccountByToken(kv.asEnv(), next))?.id).toBe(a.id);
  });

  it("keeps the old token index until the new state commits when the index write fails", async () => {
    const a = mkAccount();
    await storeAccount(kv.asEnv(), a);
    const old = a.token;
    const failing = {
      QPROXY_KV: {
        get: kv.get.bind(kv),
        put: async (key: string, value: string) => {
          if (key.startsWith("qproxy:warp:token:")) throw new Error("kv put failed");
          await kv.put(key, value);
        },
        delete: kv.delete.bind(kv),
        list: kv.list.bind(kv),
      },
    };
    await expect(regenerateToken(failing as never, a)).rejects.toThrow("kv put failed");
    expect(kv.map.has(`qproxy:warp:token:${old}`)).toBe(true);
  });

  it("validates amnezia ranges and overlap", () => {
    expect(validateAmnezia({ Jc: 4, Jmin: 40, Jmax: 70 }).ok).toBe(true);
    expect(validateAmnezia({ Jc: 999 }).ok).toBe(false);
    expect(validateAmnezia({ Jmin: 100, Jmax: 50 }).ok).toBe(false);
    expect(validateAmnezia({ H1: "100-200", H2: "150-300" }).ok).toBe(false);
    expect(validateAmnezia({ H1: "100-200", H2: "300-400" }).ok).toBe(true);
    expect(validateAmnezia({ S1: 300 }).ok).toBe(true);
    expect(validateAmnezia({ S1: 65536 }).ok).toBe(false);
    expect(validateAmnezia({ I1: "<r 20>" }).ok).toBe(true);
    expect(validateAmnezia({ I1: "junk" }).ok).toBe(false);
  });

  it("labels the first key of an overlapping H pair", () => {
    const h1h2 = validateAmnezia({ H1: "100-200", H2: "150-300" });
    expect(h1h2.ok).toBe(false);
    if (!h1h2.ok) {
      expect(h1h2.fields.H1).toBe("H ranges must not overlap");
      expect(h1h2.fields.H2).toBeUndefined();
    }
    const h2h3 = validateAmnezia({ H2: "150-300", H3: "250-400" });
    expect(h2h3.ok).toBe(false);
    if (!h2h3.ok) {
      expect(h2h3.fields.H2).toBe("H ranges must not overlap");
      expect(h2h3.fields.H1).toBeUndefined();
      expect(h2h3.fields.H3).toBeUndefined();
    }
    const h3h4 = validateAmnezia({ H3: "250-400", H4: "350-500" });
    expect(h3h4.ok).toBe(false);
    if (!h3h4.ok) {
      expect(h3h4.fields.H3).toBe("H ranges must not overlap");
      expect(h3h4.fields.H1).toBeUndefined();
      expect(h3h4.fields.H4).toBeUndefined();
    }
  });

  it("resolves global then per-account overrides, keeping explicit zeros", () => {
    const resolved = resolveAmnezia({ Jc: 10, Jmin: 60, Jmax: 900, H1: 0 }, { Jc: 20 });
    expect(resolved.Jc).toBe(20);
    expect(resolved.Jmin).toBe(60);
    expect(resolved.H1).toBe(0);
    expect(resolveAmnezia({}, null).Jmin).toBe(DEFAULT_PRESETS.length > 0 ? 50 : 0);
  });

  it("honors an explicit Jmin=0 override", () => {
    const resolved = resolveAmnezia({ Jmin: 60 }, { Jmin: 0 });
    expect(resolved.Jmin).toBe(0);
  });

  it("persists global settings", async () => {
    await setGlobalSettings(kv.asEnv(), { amnezia: { Jc: 9 } });
    expect((await getGlobalSettings(kv.asEnv())).amnezia.Jc).toBe(9);
  });
});
