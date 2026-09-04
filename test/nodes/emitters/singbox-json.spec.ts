import { describe, expect, it } from "vitest";
import { emitSingBoxJson } from "../../../src/nodes/emitters/singbox-json";
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

describe("emitSingBoxJson golden", () => {
  it("emits the exact full tun profile for a fixed three-node set", () => {
    const nodes: ProxyNode[] = [vless(), trojan(), ss()];
    const expected = `{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "tag": "proxy-dns",
        "address": "https://8.8.8.8/dns-query",
        "detour": "PROXY"
      },
      {
        "tag": "local-dns",
        "address": "local"
      }
    ],
    "rules": [],
    "final": "proxy-dns"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "address": [
        "172.18.0.1/30",
        "fdfe:dcba:9876::1/126"
      ],
      "auto_route": true,
      "strict_route": true
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "127.0.0.1",
      "listen_port": 2080
    }
  ],
  "outbounds": [
    {
      "type": "vless",
      "tag": "VLESS example.com 443",
      "server": "example.com",
      "server_port": 443,
      "uuid": "d342d11e-d424-4583-b36e-524ab1f0afa4",
      "packet_encoding": "xudp",
      "tls": {
        "enabled": true,
        "server_name": "example.com",
        "alpn": [
          "http/1.1"
        ],
        "utls": {
          "enabled": true,
          "fingerprint": "chrome"
        }
      },
      "transport": {
        "type": "ws",
        "path": "/vl/abcd1234?ed=2048",
        "headers": {
          "Host": "example.com"
        },
        "max_early_data": 2048,
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    },
    {
      "type": "trojan",
      "tag": "TROJAN example.com 443",
      "server": "example.com",
      "server_port": 443,
      "password": "secretpass123",
      "tls": {
        "enabled": true,
        "server_name": "example.com",
        "utls": {
          "enabled": true,
          "fingerprint": "chrome"
        }
      },
      "transport": {
        "type": "ws",
        "path": "/tr/abcd1234?ed=2048",
        "headers": {
          "Host": "example.com"
        },
        "max_early_data": 2048,
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    },
    {
      "type": "shadowsocks",
      "tag": "SS example.com 443",
      "server": "example.com",
      "server_port": 443,
      "method": "aes-128-gcm",
      "password": "sspass12345",
      "plugin": "v2ray-plugin",
      "plugin_opts": "mode=websocket;tls;host=example.com;path=/ss/abcd1234"
    },
    {
      "type": "urltest",
      "tag": "PROXY",
      "outbounds": [
        "VLESS example.com 443",
        "TROJAN example.com 443",
        "SS example.com 443"
      ],
      "url": "https://www.gstatic.com/generate_204",
      "interval": "300s",
      "tolerance": 50
    },
    {
      "type": "direct",
      "tag": "DIRECT"
    }
  ],
  "route": {
    "rules": [
      {
        "protocol": "dns",
        "action": "hijack-dns"
      },
      {
        "ip_is_private": true,
        "action": "route",
        "outbound": "DIRECT"
      }
    ],
    "final": "PROXY",
    "auto_detect_interface": true
  }
}
`;
    expect(emitSingBoxJson(nodes, OPTS)).toBe(expected);
  });

  it("uses a selector group for a single node and DIRECT final when empty", () => {
    const one = emitSingBoxJson([vless()], OPTS);
    expect(one).toContain(`{
      "type": "selector",
      "tag": "PROXY",
      "outbounds": [
        "VLESS example.com 443"
      ]
    }`);
    expect(one).toContain('"final": "PROXY"');
    const none = emitSingBoxJson([], OPTS);
    expect(none.includes('"detour"')).toBe(false);
    expect(none).toContain('"final": "DIRECT"');
    expect(JSON.parse(none)).toMatchObject({ route: { final: "DIRECT" } });
  });

  it("keeps ss outbound free of tls and transport objects", () => {
    const out = emitSingBoxJson([ss()], OPTS);
    const parsed = JSON.parse(out) as { outbounds: Array<Record<string, unknown>> };
    const s = parsed.outbounds[0]!;
    expect(s.type).toBe("shadowsocks");
    expect("tls" in s).toBe(false);
    expect("transport" in s).toBe(false);
    expect(s.plugin).toBe("v2ray-plugin");
  });

  it("excludes plain-security vless and trojan nodes because those cores require TLS", () => {
    const plainVless: VlessNode = {
      ...vless(),
      port: 80,
      security: "none",
      sni: null,
      fingerprint: null,
      alpn: [],
      ech: null,
    };
    const plainTrojan: TrojanNode = {
      ...trojan(),
      port: 80,
      security: "none",
      sni: null,
      fingerprint: null,
    };
    const out = emitSingBoxJson([plainVless, plainTrojan, vless()], OPTS);
    const parsed = JSON.parse(out) as { outbounds: Array<Record<string, unknown>> };
    const kinds = parsed.outbounds.map((o) => o.type);
    expect(kinds.filter((k) => k === "vless").length).toBe(1);
    expect(kinds.filter((k) => k === "trojan").length).toBe(0);
    expect(out.includes("server_port: 80")).toBe(false);
  });

  it("omits tls objects on plain-security nodes and drops early data when zero", () => {
    const plain: VMessNode = {
      kind: "vmess",
      name: "VMP",
      address: "example.com",
      port: 80,
      security: "none",
      sni: null,
      host: "example.com",
      path: "/vm/abcd1234",
      earlyData: 0,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      uuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
      cipher: "auto",
      alterId: 0,
    };
    const parsed = JSON.parse(emitSingBoxJson([plain], OPTS)) as { outbounds: Array<Record<string, unknown>> };
    const o = parsed.outbounds[0]!;
    expect(o.type).toBe("vmess");
    expect("tls" in o).toBe(false);
    const t = o.transport as Record<string, unknown>;
    expect("max_early_data" in t).toBe(false);
    expect(t.path).toBe("/vm/abcd1234");
  });

  it("emits typed ech, alpn, and utls tls blocks for tls nodes", () => {
    const echNode: VlessNode = { ...vless(), ech: "crypto.example.com" };
    const parsed = JSON.parse(emitSingBoxJson([echNode], OPTS)) as {
      outbounds: Array<{ tls?: { ech?: { query_server_name: string }; alpn?: string[]; utls?: { fingerprint: string } } }>;
    };
    const tls = parsed.outbounds[0]!.tls!;
    expect(tls.ech?.query_server_name).toBe("crypto.example.com");
    expect(tls.alpn).toEqual(["http/1.1"]);
    expect(tls.utls?.fingerprint).toBe("chrome");
  });
});
