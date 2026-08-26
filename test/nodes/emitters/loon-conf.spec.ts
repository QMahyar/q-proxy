import { describe, expect, it } from "vitest";
import { emitLoonConf } from "../../../src/nodes/emitters/loon-conf";
import type { EmitOptions } from "../../../src/nodes/emitters/registry";
import type { ProxyNode, TrojanNode, VlessNode, VMessNode } from "../../../src/types/node";

const OPTS: EmitOptions = {
  remoteDns: "https://8.8.8.8/dns-query",
  urlTestIntervalSec: 300,
  isFragment: false,
};

function vmess(): VMessNode {
  return {
    kind: "vmess",
    name: "VMESS example.com 443",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/vm/abcd1234?ed=2048",
    earlyData: 2048,
    fingerprint: "chrome",
    alpn: ["http/1.1"],
    ech: null,
    variant: "normal",
    tags: [],
    uuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
    cipher: "auto",
    alterId: 0,
  };
}

function trojan(): TrojanNode {
  return {
    kind: "trojan",
    name: "TROJAN example.com 443",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/tr/abcd1234?ed=2048",
    earlyData: 2048,
    fingerprint: "chrome",
    alpn: [],
    ech: null,
    variant: "normal",
    tags: [],
    password: "secretpass123",
  };
}

function vless(): VlessNode {
  return { ...vmess(), kind: "vless", name: "VLESS example.com 443", uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4" };
}

describe("emitLoonConf golden", () => {
  it("emits exact INI for vless+vmess+trojan with loon parameter style", () => {
    const nodes: ProxyNode[] = [vless(), vmess(), trojan()];
    const expected = [
      "[General]",
      "loglevel = notify",
      "",
      "[Proxy]",
      'VLESS example.com 443 = vless, example.com, 443, "d342d11e-d424-4583-b36e-524ab1f0afa4", udp=true, over-tls=true, sni=example.com, transport=ws, path=/vm/abcd1234?ed=2048, host=example.com',
      'VMESS example.com 443 = vmess, example.com, 443, auto, "1386f85e-657b-4d6e-9d56-78badb75e1fd", alterId=0, udp=true, over-tls=true, sni=example.com, transport=ws, path=/vm/abcd1234?ed=2048, host=example.com',
      'TROJAN example.com 443 = trojan, example.com, 443, "secretpass123", udp=true, sni=example.com, over-tls=true, transport=ws, path=/tr/abcd1234?ed=2048, host=example.com',
      "",
      "[Proxy Group]",
      "PROXY = url-test, VLESS example.com 443, VMESS example.com 443, TROJAN example.com 443, url=https://www.gstatic.com/generate_204, interval=300, tolerance=50, timeout=5",
      "",
      "[Rule]",
      "FINAL,PROXY",
      "",
    ].join("\n");
    expect(emitLoonConf(nodes, OPTS)).toBe(expected);
  });

  it("emits vless and falls back to DIRECT group when empty", () => {
    const out = emitLoonConf([vless()], OPTS);
    expect(out).toContain("VLESS example.com 443 = vless");
    expect(out).not.toContain("PROXY = select, DIRECT");
    const empty = emitLoonConf([], OPTS);
    expect(empty).toContain("PROXY = select, DIRECT");
  });

  it("skips plain-security trojan but keeps plain vmess without sni", () => {
    const plainVm: VMessNode = { ...vmess(), port: 80, security: "none", sni: null, name: "PLAINVM" };
    const plainTr: TrojanNode = { ...trojan(), port: 80, security: "none", name: "PLAINTR" };
    const out = emitLoonConf([plainVm, plainTr], OPTS);
    expect(out).toContain(
      'PLAINVM = vmess, example.com, 80, auto, "1386f85e-657b-4d6e-9d56-78badb75e1fd", alterId=0, udp=true, over-tls=false, transport=ws, path=/vm/abcd1234?ed=2048, host=example.com',
    );
    expect(out).not.toContain("PLAINTR");
  });
});
