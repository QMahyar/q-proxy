import { describe, expect, it } from "vitest";
import { emitClashYaml } from "../../../src/nodes/emitters/clash-yaml";
import type { EmitOptions } from "../../../src/nodes/emitters/registry";
import type { ProxyNode, SSNode, TrojanNode, VlessNode, VMessNode } from "../../../src/types/node";

const OPTS: EmitOptions = {
  remoteDns: "https://8.8.8.8/dns-query",
  urlTestIntervalSec: 300,
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

function ss(): SSNode {
  return {
    kind: "ss",
    name: "SS example.com 443",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: null,
    host: "example.com",
    path: "/ss/abcd1234",
    earlyData: 0,
    fingerprint: null,
    alpn: [],
    ech: null,
    variant: "normal",
    tags: [],
    method: "aes-128-gcm",
    password: "sspass12345",
  };
}

describe("emitClashYaml golden", () => {
  it("emits exact mihomo YAML for a fixed three-node set", () => {
    const nodes: ProxyNode[] = [vless(), trojan(), ss()];
    const expected = [
      "mixed-port: 7890",
      "allow-lan: false",
      "mode: rule",
      "log-level: info",
      "proxies:",
      '  - name: "VLESS example.com 443"',
      "    type: vless",
      "    server: example.com",
      "    port: 443",
      "    udp: true",
      "    uuid: d342d11e-d424-4583-b36e-524ab1f0afa4",
      "    tls: true",
      "    servername: example.com",
      "    client-fingerprint: chrome",
      "    alpn: [http/1.1]",
      "    network: ws",
      "    ws-opts:",
      '      path: "/vl/abcd1234?ed=2048"',
      "      headers:",
      "        Host: example.com",
      "      max-early-data: 2048",
      "      early-data-header-name: Sec-WebSocket-Protocol",
      '  - name: "TROJAN example.com 443"',
      "    type: trojan",
      "    server: example.com",
      "    port: 443",
      "    udp: true",
      "    password: secretpass123",
      "    sni: example.com",
      "    client-fingerprint: chrome",
      "    network: ws",
      "    ws-opts:",
      '      path: "/tr/abcd1234?ed=2048"',
      "      headers:",
      "        Host: example.com",
      "      max-early-data: 2048",
      "      early-data-header-name: Sec-WebSocket-Protocol",
      '  - name: "SS example.com 443"',
      "    type: ss",
      "    server: example.com",
      "    port: 443",
      "    udp: false",
      "    cipher: aes-128-gcm",
      "    password: sspass12345",
      "    plugin: v2ray-plugin",
      "    plugin-opts:",
      "      mode: websocket",
      "      tls: true",
      "      host: example.com",
      '      path: "/ss/abcd1234"',
      "proxy-groups:",
      "  - name: PROXY",
      "    type: url-test",
      '    url: "https://www.gstatic.com/generate_204"',
      "    interval: 300",
      "    tolerance: 50",
      '    proxies: ["VLESS example.com 443", "TROJAN example.com 443", "SS example.com 443"]',
      'rules: ["MATCH,PROXY"]',
      "",
    ].join("\n");
    expect(emitClashYaml(nodes, OPTS)).toBe(expected);
  });

  it("uses vmess servername and alterId 0 plus plain-port tls:false", () => {
    const vmessTls: VMessNode = {
      kind: "vmess",
      name: "VM1",
      address: "example.com",
      port: 443,
      security: "tls",
      sni: "sni.example.com",
      host: "example.com",
      path: "/vm",
      earlyData: 0,
      fingerprint: "firefox",
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      uuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
      cipher: "auto",
      alterId: 0,
    };
    const out = emitClashYaml([vmessTls], OPTS);
    expect(out).toContain("    alterId: 0\n    cipher: auto");
    expect(out).toContain("    servername: sni.example.com");
    const plain: VMessNode = {
      ...vmessTls,
      port: 80,
      security: "none",
      sni: null,
      fingerprint: null,
      name: "VM0",
    };
    const outPlain = emitClashYaml([plain], OPTS);
    expect(outPlain).toContain("    tls: false\n");
    expect(outPlain).not.toContain("servername:");
    expect(outPlain).not.toContain("client-fingerprint:");
    expect(outPlain).not.toContain("max-early-data");
  });

  it("select group for a single node and DIRECT rule when empty", () => {
    const one = emitClashYaml([vless()], OPTS);
    expect(one).toContain("proxy-groups:\n  - name: PROXY\n    type: select");
    expect(one).toContain('proxies: ["VLESS example.com 443"]');
    const none = emitClashYaml([], OPTS);
    expect(none).toContain('proxies: []\nproxy-groups: []\nrules: ["MATCH,DIRECT"]');
  });

  it("excludes fragment nodes unless opts.isFragment", () => {
    const frag: VlessNode = { ...vless(), name: "F", variant: "fragment", tags: ["fragment"] };
    expect(emitClashYaml([frag], OPTS)).not.toContain("- F\n");
    expect(emitClashYaml([frag], { ...OPTS, isFragment: true })).toContain("- name: F");
  });

  it("excludes plain-security trojan nodes because mihomo trojan is always-TLS", () => {
    const plainTrojan: TrojanNode = {
      ...trojan(),
      name: "TROJAN example.com 80 Plain Workers-Dev",
      port: 80,
      security: "none",
      sni: null,
      fingerprint: null,
    };
    const out = emitClashYaml([vless(), plainTrojan], OPTS);
    expect(out).toContain("type: vless");
    expect(out).not.toContain("type: trojan");
    expect(out).toContain('proxies: ["VLESS example.com 443"]');
    expect(out).toContain('rules: ["MATCH,PROXY"]');
  });

  it("adds ech-opts to the trojan branch and keeps udp false on ss plugin entries", () => {
    const echTrojan: TrojanNode = { ...trojan(), name: "TROJAN ECH", ech: "crypto.example.com" };
    const out = emitClashYaml([echTrojan, ss()], OPTS);
    expect(out).toContain("    password: secretpass123\n    sni: example.com\n    ech-opts:\n      enable: true");
    expect(out).toContain("    type: ss\n    server: example.com\n    port: 443\n    udp: false");
  });
});

describe("emitClashYaml routing rules", () => {
  it("emits reject/bypass/LAN/QUIC rules before MATCH when rules provided", () => {
    const nodes = [vless()];
    const out = emitClashYaml(nodes, {
      remoteDns: "https://1.1.1.1/dns-query",
      urlTestIntervalSec: 300,
      isFragment: false,
      rules: {
        bypassLan: true,
        bypassDomains: ["example.ir"],
        blockDomains: ["ads.example.com"],
        blockQuic: true,
      },
    });
    expect(out).toContain("DOMAIN-SUFFIX,ads.example.com,REJECT");
    expect(out).toContain("AND,((NETWORK,udp),(DST-PORT,443)),REJECT");
    expect(out).toContain("IP-CIDR,192.168.0.0/16,DIRECT,no-resolve");
    expect(out).toContain("DOMAIN-SUFFIX,example.ir,DIRECT");
    const rulesIdx = out.indexOf("rules:");
    const matchIdx = out.indexOf("MATCH,PROXY");
    expect(matchIdx).toBeGreaterThan(rulesIdx);
    expect(out.indexOf("MATCH,PROXY")).toBeGreaterThan(out.indexOf("DOMAIN-SUFFIX,example.ir,DIRECT"));
  });

  it("keeps output unchanged when rules are omitted", () => {
    const nodes = [vless()];
    const out = emitClashYaml(nodes, { remoteDns: "https://1.1.1.1/dns-query", urlTestIntervalSec: 300, isFragment: false });
    expect(out).toContain(`rules: ["MATCH,PROXY"]`);
    expect(out).not.toContain("REJECT");
  });
});