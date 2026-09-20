import { describe, expect, it } from "vitest";
import { emitClashYaml } from "../../../src/nodes/emitters/clash-yaml";
import type { EmitOptions } from "../../../src/nodes/emitters/registry";
import type { ProxyNode, VlessNode } from "../../../src/types/node";

const OPTS: EmitOptions = {
  isFragment: false,
};

function vless(): VlessNode {
  return {
    kind: "vless",
    name: "VLESS example.com 443",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/vl/abcd1234?ed=2048",
    earlyData: 2048,
    fingerprint: "chrome",
    alpn: ["http/1.1"],
    ech: null,
    variant: "normal",
    tags: [],
    uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
  };
}

describe("emitClashYaml golden", () => {
  it("emits the exact Mihomo-compatible profile for a fixed single vless node", () => {
    const expected = `port: 7890
socks-port: 7891
allow-lan: false
mode: rule
log-level: info
dns:
  enable: true
  ipv6: false
  nameserver:
    - https://8.8.8.8/dns-query
proxies:
  - name: VLESS example.com 443
    type: vless
    server: example.com
    port: 443
    uuid: d342d11e-d424-4583-b36e-524ab1f0afa4
    udp: true
    tls: true
    servername: example.com
    skip-cert-verify: true
    alpn: [http/1.1]
    fingerprint: chrome
    network: ws
    ws-opts: {path: "/vl/abcd1234?ed=2048", headers: {Host: example.com}, max-early-data: 2048}
proxy-groups:
  - {name: PROXY, type: select, proxies: [VLESS example.com 443]}
rules:
  - IP-CIDR,127.0.0.0/8,DIRECT
  - IP-CIDR,10.0.0.0/8,DIRECT
  - IP-CIDR,172.16.0.0/12,DIRECT
  - IP-CIDR,192.168.0.0/16,DIRECT
  - MATCH,PROXY
`;
    expect(emitClashYaml([vless()], OPTS)).toBe(expected);
  });

  it("renders block/allow domain rules ahead of the private DIRECT rails", () => {
    const out = emitClashYaml([vless()], {
      isFragment: false,
      rules: { bypassLan: true, bypassDomains: ["local.corp"], blockDomains: ["ads.example"], blockQuic: true },
    });
    const lines = out.split("\n");
    expect(lines).toContain("  - DOMAIN-SUFFIX,ads.example,REJECT");
    expect(lines).toContain("  - DOMAIN-SUFFIX,local.corp,DIRECT");
    expect(lines.indexOf("  - DOMAIN-SUFFIX,ads.example,REJECT")).toBeLessThan(lines.indexOf("  - IP-CIDR,127.0.0.0/8,DIRECT"));
    expect(lines[lines.length - 2]).toBe("  - MATCH,PROXY");
  });

  it("uses a url-test group for several nodes and quotes yaml-hostile names", () => {
    const tricky: ProxyNode = { ...vless(), name: 'weird: "name" #1' };
    const out = emitClashYaml([vless(), tricky], OPTS);
    expect(out).toContain("  - {name: PROXY, type: url-test,");
    expect(out).toContain("proxies: [VLESS example.com 443, \"weird: \\\"name\\\" #1\"]");
    expect(out).toContain('- name: "weird: \\"name\\" #1"');
  });

  it("drops plain-security nodes like the sing-box emitter", () => {
    const plain: ProxyNode = { ...vless(), name: "PV", port: 80, security: "none", sni: null };
    const out = emitClashYaml([vless(), plain], OPTS);
    expect(out).not.toContain("PV");
    expect(out).toContain("VLESS example.com 443");
  });

  it("emits a valid empty profile with DIRECT fallback", () => {
    const out = emitClashYaml([], OPTS);
    expect(out).toContain("proxies:\n  []");
    expect(out).toContain("  - {name: PROXY, type: select, proxies: [DIRECT]}");
  });
});
