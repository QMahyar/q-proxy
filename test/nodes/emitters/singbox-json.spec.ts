import { describe, expect, it } from "vitest";
import { emitSingBoxJson } from "../../../src/nodes/emitters/singbox-json";
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

describe("emitSingBoxJson golden", () => {
  it("emits the exact full tun profile for a fixed single vless node", () => {
    const expected = `{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "type": "https",
        "tag": "proxy-dns",
        "server": "8.8.8.8",
        "detour": "PROXY"
      },
      {
        "type": "local",
        "tag": "local-dns"
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
      "type": "selector",
      "tag": "PROXY",
      "outbounds": [
        "VLESS example.com 443"
      ]
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
    expect(emitSingBoxJson([vless()], OPTS)).toBe(expected);
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

  it("excludes plain-security vless nodes because the core requires TLS", () => {
    const plainVless: VlessNode = {
      ...vless(),
      port: 80,
      security: "none",
      sni: null,
      fingerprint: null,
      alpn: [],
      ech: null,
    };
    const out = emitSingBoxJson([plainVless, vless()], OPTS);
    const parsed = JSON.parse(out) as { outbounds: Array<Record<string, unknown>> };
    const kinds = parsed.outbounds.map((o) => o.type);
    expect(kinds.filter((k) => k === "vless").length).toBe(1);
    expect(out.includes("server_port: 80")).toBe(false);
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

describe("emitSingBoxJson vision flow", () => {
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
});

describe("emitSingBoxJson typed dns servers", () => {
  interface DnsBlock {
    servers: Array<Record<string, unknown>>;
    rules: unknown[];
    final: string;
  }
  interface RouteBlock {
    rules: Array<Record<string, unknown>>;
    final: string;
  }
  interface Doc {
    dns: DnsBlock;
    route: RouteBlock;
  }

  function doc(nodes: ProxyNode[]): Doc {
    return JSON.parse(emitSingBoxJson(nodes, OPTS)) as Doc;
  }

  it("uses the baked-in proxy DNS (custom remote-DNS knob removed)", () => {
    const { dns } = doc([vless()]);
    expect(dns.servers).toEqual([
      { type: "https", tag: "proxy-dns", server: "8.8.8.8", detour: "PROXY" },
      { type: "local", tag: "local-dns" },
    ]);
  });

  it("drops every legacy address marker from dns servers", () => {
    const { dns } = doc([vless()]);
    expect(JSON.stringify(dns)).not.toContain('"address"');
    expect(dns.servers).toEqual([
      { type: "https", tag: "proxy-dns", server: "8.8.8.8", detour: "PROXY" },
      { type: "local", tag: "local-dns" },
    ]);
  });

  it("keeps dns final plus route hijack-dns, private-direct and final semantics", () => {
    const { dns, route } = doc([vless()]);
    expect(dns.rules).toEqual([]);
    expect(dns.final).toBe("proxy-dns");
    expect(dns.servers.map((s) => s.tag)).toContain(dns.final);
    for (const s of dns.servers) {
      expect(typeof s.type).toBe("string");
      expect(typeof s.tag).toBe("string");
      if (s.type === "https") expect(typeof s.server).toBe("string");
    }
    expect(route.rules[0]).toEqual({ protocol: "dns", action: "hijack-dns" });
    expect(route.rules).toContainEqual({ ip_is_private: true, action: "route", outbound: "DIRECT" });
    expect(route.final).toBe("PROXY");
  });

  it("emits a typed lone server with no detour when no nodes are visible", () => {
    const { dns, route } = doc([]);
    expect(dns.servers).toEqual([{ type: "https", tag: "local-dns", server: "8.8.8.8" }]);
    expect(JSON.stringify(dns)).not.toContain('"detour"');
    expect(dns.final).toBe("local-dns");
    expect(route.final).toBe("DIRECT");
  });
});
