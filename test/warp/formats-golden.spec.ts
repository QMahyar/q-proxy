import { beforeEach, describe, expect, it } from "vitest";
import { expandAccount, type WarpEmitContext } from "../../src/warp/expand";
import { WARP_EMITTERS } from "../../src/warp/formats/registry";
import type { WarpAccount } from "../../src/types/warp";
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
    endpoint_list: { type: "custom", custom_endpoints: [{ ip: "162.159.192.1", port: 2408 }] },
    amnezia_overrides: null,
    dns: null,
  };
}

const CONF_BODY = [
  "[Interface]",
  "PrivateKey = eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=",
  "Address = 10.2.0.2/32, 2606:4700:110:8d4a::/128",
  "DNS = 1.1.1.1",
  "MTU = 1280",
  "[Peer]",
  "PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
  "AllowedIPs = 0.0.0.0/0, ::/0",
  "Endpoint = 162.159.192.1:2408",
  "PersistentKeepalive = 25",
  "# Reserved = 5,6,7",
  "",
].join("\n");

const CONF_BODY_AMNEZIA = [
  "[Interface]",
  "PrivateKey = eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=",
  "Address = 10.2.0.2/32, 2606:4700:110:8d4a::/128",
  "DNS = 1.1.1.1",
  "MTU = 1280",
  "Jc = 5",
  "Jmin = 50",
  "Jmax = 1000",
  "[Peer]",
  "PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
  "AllowedIPs = 0.0.0.0/0, ::/0",
  "Endpoint = 162.159.192.1:2408",
  "PersistentKeepalive = 25",
  "# Reserved = 5,6,7",
  "",
].join("\n");

async function singleRow(): Promise<WarpEmitContext> {
  const ctx = await expandAccount(
    env,
    mkAccount(),
    makeTestSettings({ warpPresets: [], warpCustomEndpoints: ["162.159.192.1:2408"] }),
  );
  return { ...ctx, rows: [ctx.rows[0]!] };
}

function zipLatin1(zip: Uint8Array): string {
  return Buffer.from(zip).toString("latin1");
}

beforeEach(async () => {
  const { ensureWarpDefaults } = await import("../../src/warp/store");
  await ensureWarpDefaults(env);
});

describe("warp conf golden", () => {
  it("embeds the exact wireguard .conf bytes in the zip", async () => {
    const zip = WARP_EMITTERS["wireguard-conf"](await singleRow()) as Uint8Array;
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    const text = zipLatin1(zip);
    expect(text).toContain("Home-ISP-162.159.192.1-2408.conf");
    expect(text).toContain(CONF_BODY);
    expect(text).not.toContain("Jc = ");
  });

});

describe("warp singbox golden", () => {
  it("emits the endpoint schema with the exact peer and route.final", async () => {
    const out = WARP_EMITTERS.singbox(await singleRow()) as string;
    const doc = JSON.parse(out) as {
      endpoints: Array<{
        type: string;
        tag: string;
        address: string[];
        private_key: string;
        mtu: number;
        peers: Array<{ address: string; port: number; allowed_ips: string[]; reserved: number[] }>;
      }>;
      route: { final: string };
    };
    expect(doc.endpoints).toHaveLength(1);
    expect(doc.endpoints[0]!.type).toBe("wireguard");
    expect(doc.endpoints[0]!.tag).toBe("Home ISP");
    expect(doc.endpoints[0]!.address).toEqual(["10.2.0.2/32", "2606:4700:110:8d4a::/128"]);
    expect(doc.endpoints[0]!.private_key).toBe("eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=");
    expect(doc.endpoints[0]!.peers[0]!.address).toBe("162.159.192.1");
    expect(doc.endpoints[0]!.peers[0]!.port).toBe(2408);
    expect(doc.endpoints[0]!.peers[0]!.reserved).toEqual([5, 6, 7]);
    expect(doc.route.final).toBe("Home ISP");
    expect(out).toContain('"persistent_keepalive_interval": 25');
    expect(out).not.toContain("amnezia_wg");
  });
});

describe("warp amnezia toggle goldens", () => {
  async function toggleRow(on: boolean): Promise<WarpEmitContext> {
    const { getGlobalSettings, setGlobalSettings } = await import("../../src/warp/store");
    const cur = await getGlobalSettings(env);
    await setGlobalSettings(env, { amnezia: cur.amnezia, amneziaEnabled: on });
    try {
      return await singleRow();
    } finally {
      await setGlobalSettings(env, { amnezia: cur.amnezia, amneziaEnabled: false });
    }
  }

  it("renders the retired wireguard-conf-amnezia bytes when the toggle is on", async () => {
    const zip = WARP_EMITTERS["wireguard-conf"](await toggleRow(true)) as Uint8Array;
    expect(zipLatin1(zip)).toContain(CONF_BODY_AMNEZIA);
  });

  it("renders the retired singbox-amnezia bytes when the toggle is on", async () => {
    const out = WARP_EMITTERS.singbox(await toggleRow(true)) as string;
    const doc = JSON.parse(out) as { endpoints: Array<{ amnezia_wg: Record<string, unknown> }> };
    expect(doc.endpoints[0]!.amnezia_wg).toEqual({ jc: 5, jmin: 50, jmax: 1000 });
    expect(out).toContain('"amnezia_wg": {\n        "jc": 5,\n        "jmin": 50,\n        "jmax": 1000\n      }');
  });
});
