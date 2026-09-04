import { describe, expect, it } from "vitest";
import { emitSingBoxJson } from "../../../src/nodes/emitters/singbox-json";
import type { EmitOptions } from "../../../src/nodes/emitters/registry";
import type { Hy2Node, ProxyNode, RealityNode, SSNode, TrojanNode, VlessNode, VMessNode } from "../../../src/types/node";

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

describe("emitSingBoxJson vision flow and direct-ss", () => {
  it("emits flow on vless outbounds when set", () => {
    const parsed = JSON.parse(emitSingBoxJson([{ ...vless(), flow: "xtls-rprx-vision" }], OPTS)) as {
      outbounds: Array<{ type: string; flow?: string }>;
    };
    expect(parsed.outbounds[0]!.type).toBe("vless");
    expect(parsed.outbounds[0]!.flow).toBe("xtls-rprx-vision");
  });

  it("emits byte-identical legacy output when flow is null", () => {
    expect(emitSingBoxJson([{ ...vless(), flow: null }], OPTS)).toBe(emitSingBoxJson([vless()], OPTS));
  });

  it("emits a direct ss outbound without plugin keys", () => {
    const parsed = JSON.parse(emitSingBoxJson([{ ...ss(), direct: true }], OPTS)) as {
      outbounds: Array<Record<string, unknown>>;
    };
    const s = parsed.outbounds[0]!;
    expect(s).toEqual({
      type: "shadowsocks",
      tag: "SS example.com 443",
      server: "example.com",
      server_port: 443,
      method: "aes-128-gcm",
      password: "sspass12345",
    });
  });

  it("emits byte-identical legacy output when direct is false", () => {
    expect(emitSingBoxJson([{ ...ss(), direct: false }], OPTS)).toBe(emitSingBoxJson([ss()], OPTS));
  });
});

describe("emitSingBoxJson remote nodes", () => {
  const PBK = "jNXHt1yRo0vDuchQlIP6Z0ZvjT3KtzVI-T4E7RoLJS0";

  function reality(): RealityNode {
    return {
      kind: "reality",
      name: "VPS Reality",
      address: "203.0.113.10",
      port: 443,
      security: "tls",
      sni: "www.microsoft.com",
      host: "www.microsoft.com",
      path: "",
      earlyData: 0,
      fingerprint: "chrome",
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
      pbk: PBK,
      sid: "6ba85179",
      flow: "xtls-rprx-vision",
      spx: "/",
    };
  }

  function hy2(): Hy2Node {
    return {
      kind: "hy2",
      name: "VPS Hy2",
      address: "203.0.113.11",
      port: 4443,
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "",
      earlyData: 0,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      password: "hy2secret",
      obfs: "",
      obfsPassword: "",
    };
  }

  function outbounds(nodes: ProxyNode[]): Array<Record<string, unknown>> {
    return (JSON.parse(emitSingBoxJson(nodes, OPTS)) as { outbounds: Array<Record<string, unknown>> }).outbounds;
  }

  it("emits a vless outbound with a reality tls block and tcp transport", () => {
    const o = outbounds([reality()])[0]!;
    expect(o).toMatchObject({
      type: "vless",
      tag: "VPS Reality",
      server: "203.0.113.10",
      server_port: 443,
      uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
      flow: "xtls-rprx-vision",
      packet_encoding: "xudp",
      transport: { type: "tcp" },
    });
    expect(o.tls).toMatchObject({
      enabled: true,
      server_name: "www.microsoft.com",
      utls: { enabled: true, fingerprint: "chrome" },
      reality: { enabled: true, public_key: PBK, short_id: "6ba85179" },
    });
  });

  it("omits flow when empty but keeps the reality block", () => {
    const o = outbounds([{ ...reality(), flow: "" }])[0]!;
    expect("flow" in o).toBe(false);
    expect((o.tls as Record<string, unknown>).reality).toBeTruthy();
  });

  it("emits a hysteria2 outbound with tls server_name", () => {
    const o = outbounds([hy2()])[0]!;
    expect(o).toMatchObject({
      type: "hysteria2",
      tag: "VPS Hy2",
      server: "203.0.113.11",
      server_port: 4443,
      password: "hy2secret",
    });
    expect(o.tls).toMatchObject({ enabled: true, server_name: "example.com" });
    expect("obfs" in o).toBe(false);
  });

  it("emits the salamander obfs object only when obfs is set", () => {
    const o = outbounds([{ ...hy2(), obfs: "salamander", obfsPassword: "obf" }])[0]!;
    expect(o.obfs).toEqual({ type: "salamander", password: "obf" });
  });
});
