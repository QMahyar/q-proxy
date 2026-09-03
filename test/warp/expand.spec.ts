import { beforeEach, describe, expect, it } from "vitest";
import { expandAccount, sanitizeFilename } from "../../src/warp/expand";
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
    return {
      keys: [...this.map.keys()].filter((k) => k.startsWith(options.prefix)).map((name) => ({ name })),
    };
  }
  asEnv() {
    return { QPROXY_KV: this };
  }
}

const kv = new FakeKV();
const env = kv.asEnv();

function mkAccount(): WarpAccount {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Home ISP",
    token: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-24T00:00:00.000Z",
    warp_id: null,
    warp_token: null,
    config: {
      private_key: "eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=",
      public_key: "P1vJ68IAegYlxHHEpzUlkYQ9Ae7vwgG989pSoFU+lG4=",
      addresses: { ipv4: "10.2.0.2/32", ipv6: "2606:4700:110:8d4a::/128" },
      peer_public_key: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
      mtu: 1280,
      reserved: [5, 6, 7],
    },
    endpoint_list: {
      type: "custom",
      custom_endpoints: [
        { ip: "162.159.192.1", port: 2408 },
        { ip: "2606:4700:d0::a29f:c001", port: 2408 },
      ],
    },
    amnezia_overrides: null,
    dns: null,
  };
}

beforeEach(async () => {
  const { ensureWarpDefaults } = await import("../../src/warp/store");
  await ensureWarpDefaults(env);
});

describe("expandAccount", () => {
  it("brackets ipv6 endpoints and builds bare host fields from the config addresses", async () => {
    const ctx = await expandAccount(env, mkAccount());
    expect(ctx.rows.map((r) => r.endpoint)).toEqual([
      "162.159.192.1:2408",
      "[2606:4700:d0::a29f:c001]:2408",
    ]);
    expect(ctx.rows[0]?.v4Host).toBe("10.2.0.2");
    expect(ctx.rows[0]?.v6Host).toBe("2606:4700:110:8d4a::");
    expect(ctx.rows[0]?.addressCidr).toEqual(["10.2.0.2/32", "2606:4700:110:8d4a::/128"]);
    expect(ctx.rows[0]?.allowedIps).toEqual(["0.0.0.0/0", "::/0"]);
    expect(ctx.rows[0]?.dns).toBe("1.1.1.1");
  });

  it("tags each row with the account name when there is one endpoint", async () => {
    const account = mkAccount();
    account.endpoint_list = { type: "custom", custom_endpoints: [{ ip: "1.2.3.4", port: 2408 }] };
    const ctx = await expandAccount(env, account);
    expect(ctx.rows).toHaveLength(1);
    expect(ctx.rows[0]?.tag).toBe("Home ISP");
  });

  it("dedupes endpoints by ip and port, keeping first occurrence order", async () => {
    const account = mkAccount();
    account.endpoint_list = {
      type: "custom",
      custom_endpoints: [
        { ip: "1.2.3.4", port: 2408 },
        { ip: "1.2.3.4", port: 2408 },
        { ip: "1.2.3.4", port: 500 },
        { ip: "2606:4700:d0::a29f:c001", port: 2408 },
        { ip: "2606:4700:d0::a29f:c001", port: 2408 },
      ],
    };
    const ctx = await expandAccount(env, account);
    expect(ctx.rows.map((r) => r.endpoint)).toEqual([
      "1.2.3.4:2408",
      "1.2.3.4:500",
      "[2606:4700:d0::a29f:c001]:2408",
    ]);
    expect(ctx.rows.every((r) => r.tag.startsWith("Home ISP 1") || r.tag.startsWith("Home ISP 2606"))).toBe(true);
  });

  it("falls back to the selected preset endpoints when the account has no custom list", async () => {
    const account = mkAccount();
    account.endpoint_list = { type: "preset", preset_id: "default" };
    const ctx = await expandAccount(env, account);
    expect(ctx.rows.length).toBeGreaterThan(0);
    expect(ctx.rows[0]?.endpoint).toBe("engage.cloudflareclient.com:2408");
  });

  it("yields no rows when the preset id is unknown", async () => {
    const account = mkAccount();
    account.endpoint_list = { type: "preset", preset_id: "missing" };
    const ctx = await expandAccount(env, account);
    expect(ctx.rows).toEqual([]);
  });

  it("prefers account dns over preset dns and defaults to 1.1.1.1", async () => {
    const account = mkAccount();
    account.dns = "9.9.9.9";
    const custom = await expandAccount(env, account);
    expect(custom.rows[0]?.dns).toBe("9.9.9.9");
    const presetAccount = mkAccount();
    presetAccount.endpoint_list = { type: "preset", preset_id: "default" };
    const viaPreset = await expandAccount(env, presetAccount);
    expect(viaPreset.rows[0]?.dns).toBe("1.1.1.1");
    const bare = mkAccount();
    bare.endpoint_list = { type: "custom", custom_endpoints: [{ ip: "1.2.3.4", port: 2408 }] };
    const { savePresets } = await import("../../src/warp/store");
    await savePresets(env, [{ id: "default", name: "Cloudflare Default", dns: null, endpoints: [{ ip: "5.6.7.8", port: 2408 }] }]);
    const noDnsAnywhere = await expandAccount(env, bare);
    expect(noDnsAnywhere.rows[0]?.dns).toBe("1.1.1.1");
  });

  it("seeds default amnezia for clean accounts and lets account overrides win", async () => {
    const clean = await expandAccount(env, mkAccount());
    expect(clean.amnezia).toMatchObject({ Jc: 5, Jmin: 50, Jmax: 1000 });
    const { setGlobalSettings } = await import("../../src/warp/store");
    await setGlobalSettings(env, { amnezia: { Jc: 9 } });
    const withGlobal = await expandAccount(env, mkAccount());
    expect(withGlobal.amnezia).toMatchObject({ Jc: 9, Jmin: 50, Jmax: 1000 });
    const account = mkAccount();
    account.amnezia_overrides = { Jc: 7 };
    const withOverride = await expandAccount(env, account);
    expect(withOverride.amnezia).toMatchObject({ Jc: 7 });
  });
});

describe("sanitizeFilename", () => {
  it("keeps safe characters and replaces runs of unsafe ones", () => {
    expect(sanitizeFilename("Home ISP 162.159.192.1:2408")).toBe("Home-ISP-162.159.192.1-2408");
    expect(sanitizeFilename("--weird__name--")).toBe("weird__name");
    expect(sanitizeFilename("a/b\\c*d")).toBe("a-b-c-d");
  });

  it("caps the length and never returns an empty name", () => {
    expect(sanitizeFilename("x".repeat(120)).length).toBeLessThanOrEqual(80);
    expect(sanitizeFilename("///")).toBe("account");
    expect(sanitizeFilename("")).toBe("account");
  });
});
