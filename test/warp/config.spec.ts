import { describe, expect, it } from "vitest";
import { parseWarpConfig, parseWireGuardConf, parseWgUri } from "../../src/warp/config";

const PRIV = "eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=";
const PUB = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";

function conf(iface: Record<string, string> = {}, peer: Record<string, string> = {}, drop: string[] = []): string {
  const i: Record<string, string> = {
    PrivateKey: PRIV,
    Address: "10.2.0.2/32, 2606:4700:110:8d4a::/128",
    DNS: "1.1.1.1",
    MTU: "1280",
    ...iface,
  };
  const p: Record<string, string> = {
    PublicKey: PUB,
    AllowedIPs: "0.0.0.0/0",
    Endpoint: "engage.cloudflareclient.com:2408",
    ...peer,
  };
  for (const k of drop) {
    delete i[k];
    delete p[k];
  }
  const out: string[] = ["[Interface]"];
  for (const [k, v] of Object.entries(i)) out.push(`${k} = ${v}`);
  out.push("[Peer]");
  for (const [k, v] of Object.entries(p)) out.push(`${k} = ${v}`);
  return out.join("\n");
}

describe("parseWireGuardConf", () => {
  it("parses a vanilla WARP conf", () => {
    const r = parseWireGuardConf(conf());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.private_key).toBe(PRIV);
    expect(r.config.public_key.length).toBe(44);
    expect(r.config.addresses.ipv4).toBe("10.2.0.2/32");
    expect(r.config.addresses.ipv6).toBe("2606:4700:110:8d4a::/128");
    expect(r.config.peer_public_key).toBe(PUB);
    expect(r.config.mtu).toBe(1280);
    expect(r.config.reserved).toEqual([0, 0, 0]);
    expect(r.amnezia_overrides).toBeNull();
  });

  it("derives the public key from the private key", () => {
    const r = parseWireGuardConf(conf());
    if (!r.ok) throw new Error("unreachable");
    expect(r.config.public_key).not.toBe(PUB);
  });

  it("parses Reserved as comma decimals and ClientId as base64", () => {
    const a = parseWireGuardConf(conf({}, { Reserved: "1, 2, 3" }));
    expect(a.ok && a.config.reserved).toEqual([1, 2, 3]);
    const cid = btoa(String.fromCharCode(9, 8, 7));
    const b = parseWireGuardConf(conf({}, { ClientId: cid }));
    expect(b.ok && b.config.reserved).toEqual([9, 8, 7]);
  });

  it("parses Amnezia params into overrides", () => {
    const r = parseWireGuardConf(conf({ Jc: "4", Jmin: "40", Jmax: "70", H1: "1237", H2: "3456" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amnezia_overrides).toEqual({ Jc: 4, Jmin: 40, Jmax: 70, H1: 1237, H2: 3456 });
  });

  it("rejects duplicate Interface, missing keys, unknown keys, bad values", () => {
    const dup = "[Interface]\nPrivateKey = " + PRIV + "\n[Interface]\nPrivateKey = " + PRIV + "\n[Peer]\nPublicKey = " + PUB;
    expect(parseWireGuardConf(dup).ok).toBe(false);
    expect(parseWireGuardConf(conf({}, {}, ["PrivateKey"])).ok).toBe(false);
    expect(parseWireGuardConf(conf({}, {}, ["Address"])).ok).toBe(false);
    expect(parseWireGuardConf(conf({}, {}, ["PublicKey"])).ok).toBe(false);
    expect(parseWireGuardConf(conf({ Bogus: "x" })).ok).toBe(false);
    expect(parseWireGuardConf(conf({ MTU: "10" })).ok).toBe(false);
    expect(parseWireGuardConf(conf({ Jc: "999" })).ok).toBe(false);
    expect(parseWireGuardConf(conf({}, { Reserved: "1,2" })).ok).toBe(false);
    expect(parseWireGuardConf("short").ok).toBe(false);
  });

  it("rejects PresharedKey and PersistentKeepalive", () => {
    const psk = parseWarpConfig(conf({}, { PresharedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }));
    expect(psk.ok).toBe(false);
    if (!psk.ok) expect(psk.reason).toContain("PresharedKey");
    const keepalive = parseWarpConfig(conf({}, { PersistentKeepalive: "25" }));
    expect(keepalive.ok).toBe(false);
    if (!keepalive.ok) expect(keepalive.reason).toContain("PersistentKeepalive");
  });

  it("rejects multiple [Peer] sections", () => {
    const multi =
      conf() +
      "\n[Peer]\nPublicKey = " +
      PUB +
      "\nAllowedIPs = 0.0.0.0/0\nEndpoint = engage.cloudflareclient.com:2408";
    const r = parseWarpConfig(multi);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("multiple [Peer] sections");
  });
});

describe("parseWgUri", () => {
  it("parses a throne-style wg:// URI", () => {
    const uri =
      "wg://engage.cloudflareclient.com:2408?private_key=" +
      encodeURIComponent(PRIV) +
      "&public_key=" +
      encodeURIComponent(PUB) +
      "&local_address=10.2.0.2-2606:4700:110:8d4a::&mtu=1280&reserved=1-2-3#Test";
    const r = parseWgUri(uri);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.private_key).toBe(PRIV);
    expect(r.config.addresses.ipv4).toBe("10.2.0.2");
    expect(r.config.addresses.ipv6).toBe("2606:4700:110:8d4a::");
    expect(r.config.reserved).toEqual([1, 2, 3]);
  });

  it("parses wireguard:// with userinfo private key and comma addresses", () => {
    const uri =
      "wireguard://" +
      encodeURIComponent(PRIV) +
      "@162.159.192.1:500?publickey=" +
      encodeURIComponent(PUB) +
      "&address=" +
      encodeURIComponent("172.16.0.2/32, fd00::2/128") +
      "&mtu=1420";
    const r = parseWgUri(uri);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.addresses.ipv4).toBe("172.16.0.2/32");
    expect(r.config.mtu).toBe(1420);
  });

  it("falls back to the well-known WARP peer key", () => {
    const uri = "wg://162.159.192.1:2408?private_key=" + encodeURIComponent(PRIV) + "&local_address=10.2.0.2";
    const r = parseWgUri(uri);
    expect(r.ok && r.config.peer_public_key).toBe(PUB);
  });

  it("gates amnezia params behind enable_amnezia", () => {
    const base = "wg://h:2408?private_key=" + encodeURIComponent(PRIV) + "&local_address=10.2.0.2";
    const ungated = parseWgUri(base + "&jc=4");
    expect(ungated.ok && ungated.amnezia_overrides).toBeNull();
    const gated = parseWgUri(base + "&enable_amnezia=true&jc=4&jmin=40&jmax=70");
    expect(gated.ok && gated.amnezia_overrides).toEqual({ Jc: 4, Jmin: 40, Jmax: 70 });
  });

  it("rejects bad uris", () => {
    expect(parseWgUri("https://example.com").ok).toBe(false);
    expect(parseWgUri("wg://h:2408?local_address=10.2.0.2").ok).toBe(false);
    expect(parseWgUri("wg://h:2408?private_key=" + encodeURIComponent(PRIV)).ok).toBe(false);
    expect(parseWgUri("wg://h:2408?private_key=zzzz&local_address=10.2.0.2").ok).toBe(false);
    expect(
      parseWgUri("wg://h:2408?private_key=" + encodeURIComponent(PRIV) + "&local_address=10.2.0.999").ok,
    ).toBe(false);
  });
});

describe("parseWarpConfig dispatch", () => {
  it("routes by scheme", () => {
    expect(parseWarpConfig("wg://x").ok).toBe(false);
    expect(parseWarpConfig(conf()).ok).toBe(true);
  });
});
