import { beforeEach, describe, expect, it } from "vitest";
import { expandAccount, sanitizeFilename } from "../../src/warp/expand";
import type { WarpAccount } from "../../src/types/warp";
import type { Settings } from "../../src/types/settings";
import { makeTestSettings } from "../helpers/settings";

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

function settingsWith(overrides: Partial<Settings> = {}): Settings {
  return makeTestSettings({ warpPresets: [], ...overrides });
}

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
    const s = settingsWith({ warpCustomEndpoints: ["162.159.192.1:2408", "[2606:4700:d0::a29f:c001]:2408"] });
    const ctx = await expandAccount(env, mkAccount(), s);
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
    const s = settingsWith({ warpCustomEndpoints: ["1.2.3.4:2408"] });
    const ctx = await expandAccount(env, mkAccount(), s);
    expect(ctx.rows).toHaveLength(1);
    expect(ctx.rows[0]?.tag).toBe("Home ISP");
  });

  it("dedupes endpoints by ip and port, keeping first occurrence order", async () => {
    const s = settingsWith({
      warpCustomEndpoints: [
        "1.2.3.4:2408",
        "1.2.3.4:2408",
        "1.2.3.4:500",
        "[2606:4700:d0::a29f:c001]:2408",
        "[2606:4700:d0::a29f:c001]:2408",
      ],
    });
    const ctx = await expandAccount(env, mkAccount(), s);
    expect(ctx.rows.map((r) => r.endpoint)).toEqual([
      "1.2.3.4:2408",
      "1.2.3.4:500",
      "[2606:4700:d0::a29f:c001]:2408",
    ]);
    expect(ctx.rows.every((r) => r.tag.startsWith("Home ISP 1") || r.tag.startsWith("Home ISP 2606"))).toBe(true);
  });

  it("renders ticked presets for every account from the global selection", async () => {
    const s = settingsWith({ warpPresets: ["default"] });
    const ctx = await expandAccount(env, mkAccount(), s);
    expect(ctx.rows.length).toBeGreaterThan(0);
    expect(ctx.rows[0]?.endpoint).toBe("engage.cloudflareclient.com:2408");
  });

  it("falls back to the default preset on empty selection or unknown ids", async () => {
    const empty = await expandAccount(env, mkAccount(), settingsWith());
    expect(empty.rows.length).toBeGreaterThan(0);
    expect(empty.rows[0]?.endpoint).toBe("engage.cloudflareclient.com:2408");
    const unknown = await expandAccount(env, mkAccount(), settingsWith({ warpPresets: ["missing"] }));
    expect(unknown.rows.length).toBeGreaterThan(0);
    expect(unknown.rows[0]?.endpoint).toBe("engage.cloudflareclient.com:2408");
  });

  it("ignores stored per-account endpoint lists (retired selection)", async () => {
    const account = mkAccount();
    account.endpoint_list = {
      type: "custom",
      custom_endpoints: [{ ip: "9.9.9.9", port: 2408 }],
    };
    const s = settingsWith({ warpPresets: ["default"] });
    const ctx = await expandAccount(env, account, s);
    expect(ctx.rows.some((r) => r.ip === "9.9.9.9")).toBe(false);
    expect(ctx.rows[0]?.endpoint).toBe("engage.cloudflareclient.com:2408");
  });

  it("prefers account dns over preset dns and defaults to 1.1.1.1", async () => {
    const account = mkAccount();
    account.dns = "9.9.9.9";
    const custom = await expandAccount(env, account, settingsWith({ warpCustomEndpoints: ["1.2.3.4:2408"] }));
    expect(custom.rows[0]?.dns).toBe("9.9.9.9");
    const viaPreset = await expandAccount(env, mkAccount(), settingsWith({ warpPresets: ["default"] }));
    expect(viaPreset.rows[0]?.dns).toBe("1.1.1.1");
    const { savePresets } = await import("../../src/warp/store");
    await savePresets(env, [{ id: "default", name: "Cloudflare Default", dns: null, endpoints: [{ ip: "5.6.7.8", port: 2408 }] }]);
    const noDnsAnywhere = await expandAccount(env, mkAccount(), settingsWith({ warpPresets: ["default"] }));
    expect(noDnsAnywhere.rows[0]?.dns).toBe("1.1.1.1");
  });

  it("resolves the global toggle and ignores per-account amnezia overrides", async () => {
    const s = settingsWith({ warpCustomEndpoints: ["1.2.3.4:2408"] });
    const { setGlobalSettings } = await import("../../src/warp/store");
    await setGlobalSettings(env, { amnezia: { Jc: 9 }, amneziaEnabled: false });
    const off = await expandAccount(env, mkAccount(), s);
    expect(off.amneziaEnabled).toBe(false);
    expect(off.amnezia).toMatchObject({ Jc: 9, Jmin: 50, Jmax: 1000 });
    const account = mkAccount();
    account.amnezia_overrides = { Jc: 7 };
    const inert = await expandAccount(env, account, s);
    expect(inert.amnezia).toMatchObject({ Jc: 9 });
    expect(inert.amnezia).not.toMatchObject({ Jc: 7 });
    await setGlobalSettings(env, { amnezia: { Jc: 9 }, amneziaEnabled: true });
    const on = await expandAccount(env, account, s);
    expect(on.amneziaEnabled).toBe(true);
    expect(on.amnezia).toMatchObject({ Jc: 9, Jmin: 50, Jmax: 1000 });
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
