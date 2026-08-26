import { describe, expect, it } from "vitest";
import { emitSurgeConf } from "../../../src/nodes/emitters/surge-conf";
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

describe("emitSurgeConf golden", () => {
  it("emits exact INI for vmess+trojan and omits vless/ss (vless unsupported by Surge)", () => {
    const nodes: ProxyNode[] = [vless(), vmess(), trojan()];
    const expected = [
      "[General]",
      "loglevel = notify",
      "",
      "[Proxy]",
      "VMESS example.com 443 = vmess, example.com, 443, username=1386f85e-657b-4d6e-9d56-78badb75e1fd, tls=true, vmess-aead=true, ws=true, ws-path=/vm/abcd1234?ed=2048, ws-headers=Host:example.com, sni=example.com",
      "TROJAN example.com 443 = trojan, example.com, 443, password=secretpass123, tls=true, ws=true, ws-path=/tr/abcd1234?ed=2048, ws-headers=Host:example.com, sni=example.com",
      "",
      "[Proxy Group]",
      "PROXY = url-test, VMESS example.com 443, TROJAN example.com 443, url=https://www.gstatic.com/generate_204, interval=300, tolerance=50",
      "",
      "[Rule]",
      "FINAL,PROXY",
      "",
    ].join("\n");
    expect(emitSurgeConf(nodes, OPTS)).toBe(expected);
  });

  it("prepends a managed-config header when subscriptionUrl is provided", () => {
    const out = emitSurgeConf([vmess()], {
      ...OPTS,
      subscriptionUrl: "https://w.test/sp/sub?target=surge",
      updateIntervalHours: 12,
    });
    expect(out.startsWith(
      "#!MANAGED-CONFIG https://w.test/sp/sub?target=surge interval=43200 strict=true\n",
    )).toBe(true);
  });

  it("selects single node and falls back to DIRECT group when nothing is emittable", () => {
    const one = emitSurgeConf([vmess()], OPTS);
    expect(one).toContain("[Proxy Group]\nPROXY = select, VMESS example.com 443");
    const empty = emitSurgeConf([], OPTS);
    expect(empty).toContain("[Proxy]\n\n[Proxy Group]");
    expect(empty).toContain("PROXY = select, DIRECT");
  });

  it("skips plain-security trojan but keeps plain vmess", () => {
    const plainVm: VMessNode = { ...vmess(), port: 80, security: "none", sni: null, name: "PLAINVM" };
    const plainTr: TrojanNode = { ...trojan(), port: 80, security: "none", name: "PLAINTR" };
    const out = emitSurgeConf([plainVm, plainTr], OPTS);
    expect(out).toContain("PLAINVM = vmess");
    expect(out).toContain("tls=false");
    expect(out).not.toContain("PLAINTR");
  });
});
