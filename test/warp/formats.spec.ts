import { beforeEach, describe, expect, it } from "vitest";
import { makeTestSettings } from "../helpers/settings";
const G = (lines: string[]) => makeTestSettings({ warpPresets: [], warpCustomEndpoints: lines });
const STD = ["162.159.192.1:2408", "[2606:4700:d0::a29f:c001]:2408"];
import { expandAccount } from "../../src/warp/expand";
import { isWarpFormat, WARP_EMITTERS, WARP_FORMATS } from "../../src/warp/formats/registry";
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
  it("expands custom endpoints with bracketed v6, cidrs, tags and dns", async () => {
    const ctx = await expandAccount(env, mkAccount(), G(STD));
    expect(ctx.rows.length).toBe(2);
    expect(ctx.rows[0]!.endpoint).toBe("162.159.192.1:2408");
    expect(ctx.rows[1]!.endpoint).toBe("[2606:4700:d0::a29f:c001]:2408");
    expect(ctx.rows[0]!.tag).toBe("Home ISP 162.159.192.1:2408");
    expect(ctx.rows[0]!.addressCidr).toEqual(["10.2.0.2/32", "2606:4700:110:8d4a::/128"]);
    expect(ctx.rows[0]!.v4Host).toBe("10.2.0.2");
    expect(ctx.rows[0]!.v6Host).toBe("2606:4700:110:8d4a::");
    expect(ctx.rows[0]!.dns).toBe("1.1.1.1");
    expect(ctx.amnezia).toEqual({ Jc: 5, Jmin: 50, Jmax: 1000, S1: 0, S2: 0, S3: 0, S4: 0, H1: 0, H2: 0, H3: 0, H4: 0 });
    expect(ctx.amneziaEnabled).toBe(false);
  });
  it("uses preset endpoints and dns, dedupes entries", async () => {
    const a = mkAccount();
    a.config.addresses.ipv4 = "10.2.0.2";
    const ctx = await expandAccount(env, a, makeTestSettings({ warpPresets: ["default"] }));
    expect(ctx.rows.length).toBe(5);
    expect(ctx.rows[0]!.tag).toContain("Home ISP");
    expect(ctx.rows[0]!.addressCidr).toContain("10.2.0.2/32");
  });
  it("ignores per-account amnezia overrides and resolves global values", async () => {
    const a = mkAccount();
    a.amnezia_overrides = { Jc: 4, Jmin: 40, Jmax: 70 };
    const ctx = await expandAccount(env, a, G(STD));
    expect(ctx.amnezia).toEqual({ Jc: 5, Jmin: 50, Jmax: 1000, S1: 0, S2: 0, S3: 0, S4: 0, H1: 0, H2: 0, H3: 0, H4: 0 });
  });
});
describe("warp emitters", () => {
  it("covers exactly the 4 registered families", () => {
    expect(WARP_FORMATS.length).toBe(4);
    for (const f of WARP_FORMATS) expect(typeof WARP_EMITTERS[f]).toBe("function");
    expect(isWarpFormat("throne")).toBe(true);
    expect(isWarpFormat("wireguard-conf-amnezia")).toBe(false);
    expect(isWarpFormat("nope")).toBe(false);
  });
  it("emits throne wg:// URIs with unencoded keys and dash-joined addresses", async () => {
    const out = WARP_EMITTERS.throne(await expandAccount(env, mkAccount(), G(STD))) as string;
    const lines = out.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(/^wg:\/\/162\.159\.192\.1:2408\?private_key=[A-Za-z0-9%+/=]+&public_key=/);
    expect(lines[0]).toContain("local_address=10.2.0.2-2606:4700:110:8d4a::");
    expect(lines[0]).toContain("reserved=5-6-7");
    expect(lines[0]).toContain("mtu=1280");
    expect(decodeURIComponent(lines[0]!.split("#")[1]!)).toBe("Home ISP 162.159.192.1:2408");
  });
  it("throne always carries amnezia values regardless of the toggle", async () => {
    const out = WARP_EMITTERS.throne(await expandAccount(env, mkAccount(), G(STD))) as string;
    expect(out).toContain("enable_amnezia=true&jc=5&jmin=50&jmax=1000");
  });
  it("v2rayn is base64 wireguard:// links that never carry amnezia values", async () => {
    const ctx = await expandAccount(env, mkAccount(), G(STD));
    const decoded = Buffer.from(WARP_EMITTERS.v2rayn(ctx) as string, "base64").toString("utf8");
    expect(decoded.split("\n")[0]).toMatch(/^wireguard:\/\/[A-Za-z0-9%+\/=]+@162\.159\.192\.1:2408\?publickey=/);
    expect(decoded).not.toContain("enable_amnezia");
  });
  it("emits singbox endpoint schema with peers and route.final", async () => {
    const doc = JSON.parse(WARP_EMITTERS.singbox(await expandAccount(env, mkAccount(), G(STD))) as string) as {
      endpoints: Array<Record<string, unknown>>;
      route: { final: string };
    };
    expect(doc.endpoints.length).toBe(2);
    expect(doc.endpoints[0]!.type).toBe("wireguard");
    expect(doc.endpoints[0]!.address).toEqual(["10.2.0.2/32", "2606:4700:110:8d4a::/128"]);
    const peer = (doc.endpoints[0]!.peers as Array<Record<string, unknown>>)[0]!;
    expect(peer.address).toBe("162.159.192.1");
    expect(peer.reserved).toEqual([5, 6, 7]);
    expect(doc.route.final).toBe(doc.endpoints[0]!.tag);
    expect(doc.endpoints[0]).not.toHaveProperty("amnezia_wg");
  });
  it("zip formats return valid zip bytes with one entry per endpoint", async () => {
    const ctx = await expandAccount(env, mkAccount(), G(STD));
    const zip = WARP_EMITTERS["wireguard-conf"](ctx) as Uint8Array;
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const text = Buffer.from(zip).toString("latin1");
    expect(text).toContain("Home-ISP-162.159.192.1-2408-162.159.192.1-2408.conf");
  });
});
