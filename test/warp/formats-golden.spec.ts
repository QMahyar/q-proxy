import { beforeEach, describe, expect, it } from "vitest";
import { expandAccount, type WarpEmitContext } from "../../src/warp/expand";
import { WARP_EMITTERS } from "../../src/warp/formats/registry";
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

const WG_URI =
  "wireguard://eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I%3D@162.159.192.1:2408" +
  "?publickey=bmXOC%2BF1FxEMF9dyiK2H5%2F1SUtzH0JuVo51h2wPfgyo%3D" +
  "&address=10.2.0.2%2F32%2C%202606%3A4700%3A110%3A8d4a%3A%3A%2F128" +
  "&mtu=1280&reserved=5,6,7#Home%20ISP\n";

const CLASH_BASE = [
  "proxies:",
  "  - name: 'Home ISP'",
  "    type: wireguard",
  "    server: 162.159.192.1",
  "    port: 2408",
  "    ip: 10.2.0.2",
  "    ipv6: 2606:4700:110:8d4a::",
  "    private-key: 'eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I='",
  "    public-key: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo='",
  "    allowed-ips: ['0.0.0.0/0','::/0']",
  "    udp: true",
  "    reserved: [5,6,7]",
  "    mtu: 1280",
  "    persistent-keepalive: 25",
];

const CLASH = [...CLASH_BASE, ""].join("\n");

const CLASH_AMNEZIA = [...CLASH_BASE, "    amnezia-wg-option:", "      jc: 5", "      jmin: 50", "      jmax: 1000", ""].join("\n");

const SURGE = [
  "[Proxy]",
  "Home ISP = wireguard, section-name=Home ISP",
  "",
  "[WireGuard Home ISP]",
  "private-key = eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=",
  "self-ip = 10.2.0.2",
  "self-ip-v6 = 2606:4700:110:8d4a::",
  "dns-server = 1.1.1.1",
  "mtu = 1280",
  'peer = (public-key = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=, allowed-ips = "0.0.0.0/0, ::/0", endpoint = 162.159.192.1:2408, keepalive = 25, client-id = 5/6/7)',
  "",
].join("\n");

const LOON =
  "Home ISP = wireguard,interface-ip=10.2.0.2,interface-ipv6=2606:4700:110:8d4a::" +
  ',private-key="eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=",mtu=1280,dns=1.1.1.1,dnsv6=1.1.1.1,keepalive=25' +
  ',peers=[{public-key="bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",allowed-ips="0.0.0.0/0, ::/0"' +
  ",endpoint=162.159.192.1:2408,reserved=[5,6,7]}]\n";

async function singleRow(): Promise<WarpEmitContext> {
  const ctx = await expandAccount(env, mkAccount());
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

  it("amnezia zip variant inserts the junk params after MTU", async () => {
    const zip = WARP_EMITTERS["wireguard-conf-amnezia"](await singleRow()) as Uint8Array;
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    const text = zipLatin1(zip);
    expect(text).toContain(CONF_BODY_AMNEZIA);
  });
});

describe("warp uri golden", () => {
  it("emits the exact wireguard:// uri line", async () => {
    expect(WARP_EMITTERS["wireguard-uri"](await singleRow())).toBe(WG_URI);
  });
});

describe("warp clash golden", () => {
  it("emits the exact clash wireguard proxy", async () => {
    expect(WARP_EMITTERS.clash(await singleRow())).toBe(CLASH);
  });

  it("amnezia variant appends the exact amnezia-wg-option block", async () => {
    expect(WARP_EMITTERS["clash-amnezia"](await singleRow())).toBe(CLASH_AMNEZIA);
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

  it("amnezia variant adds the exact amnezia_wg block", async () => {
    const out = WARP_EMITTERS["singbox-amnezia"](await singleRow()) as string;
    const doc = JSON.parse(out) as { endpoints: Array<{ amnezia_wg: Record<string, unknown> }> };
    expect(doc.endpoints[0]!.amnezia_wg).toEqual({ jc: 5, jmin: 50, jmax: 1000 });
    expect(out).toContain('"amnezia_wg": {\n        "jc": 5,\n        "jmin": 50,\n        "jmax": 1000\n      }');
  });
});

describe("warp surge golden", () => {
  it("emits the exact surge sections with client-id", async () => {
    expect(WARP_EMITTERS.surge(await singleRow())).toBe(SURGE);
  });
});

describe("warp loon golden", () => {
  it("emits the exact single-line loon entry", async () => {
    expect(WARP_EMITTERS.loon(await singleRow())).toBe(LOON);
  });
});
