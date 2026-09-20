import { describe, expect, it } from "vitest";
import { emitXrayJson } from "../../../src/nodes/emitters/xray-json";
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

describe("emitXrayJson golden", () => {
  it("emits the exact full Xray-core profile for a fixed single vless node", () => {
    const expected = `{
  "log": {
    "loglevel": "warning"
  },
  "dns": {
    "servers": [
      "https://8.8.8.8/dns-query"
    ]
  },
  "inbounds": [
    {
      "tag": "socks-in",
      "protocol": "socks",
      "listen": "127.0.0.1",
      "port": 10808,
      "sniffing": {
        "enabled": true,
        "destOverride": [
          "http",
          "tls"
        ]
      },
      "settings": {
        "udp": true
      }
    }
  ],
  "outbounds": [
    {
      "tag": "VLESS example.com 443",
      "protocol": "vless",
      "settings": {
        "vnext": [
          {
            "address": "example.com",
            "port": 443,
            "users": [
              {
                "id": "d342d11e-d424-4583-b36e-524ab1f0afa4",
                "encryption": "none"
              }
            ]
          }
        ]
      },
      "streamSettings": {
        "network": "ws",
        "wsSettings": {
          "path": "/vl/abcd1234?ed=2048",
          "headers": {
            "Host": "example.com"
          }
        },
        "security": "tls",
        "tlsSettings": {
          "serverName": "example.com",
          "alpn": [
            "http/1.1"
          ],
          "fingerprint": "chrome"
        }
      }
    },
    {
      "tag": "direct",
      "protocol": "freedom"
    },
    {
      "tag": "block",
      "protocol": "blackhole"
    }
  ],
  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "rules": [
      {
        "type": "field",
        "protocol": [
          "bittorrent"
        ],
        "outboundTag": "block"
      },
      {
        "type": "field",
        "ip": [
          "geoip:private"
        ],
        "outboundTag": "direct"
      },
      {
        "type": "field",
        "network": "tcp",
        "balancerTag": "all"
      }
    ],
    "balancers": [
      {
        "tag": "all",
        "selector": [
          "VLESS example.com 443"
        ],
        "strategy": {
          "type": "leastPing"
        }
      }
    ]
  }
}
`;
    expect(emitXrayJson([vless()], OPTS)).toBe(expected);
  });

  it("balances exactly the served nodes so guided clients land on live ones", () => {
    const second: ProxyNode = { ...vless(), name: "second", address: "203.0.113.9", port: 8443 };
    const doc = JSON.parse(emitXrayJson([vless(), second], OPTS)) as {
      outbounds: Array<{ tag: string }>;
      routing: { balancers: Array<{ selector: string[] }> };
    };
    expect(doc.routing.balancers).toHaveLength(1);
    expect(doc.routing.balancers[0]!.selector).toEqual(["VLESS example.com 443", "second"]);
    expect(doc.outbounds.filter((o) => o.tag === "second")).toHaveLength(1);
  });

  it("renders block/allow domain rules ahead of the private DIRECT rail", () => {
    const doc = JSON.parse(
      emitXrayJson([vless()], {
        isFragment: false,
        rules: { bypassLan: true, bypassDomains: ["local.corp"], blockDomains: ["ads.example"], blockQuic: true },
      }),
    ) as { routing: { rules: Array<Record<string, unknown>> } };
    const tags = doc.routing.rules.map((r) => r.outboundTag ?? r.balancerTag);
    expect(tags).toEqual(["block", "block", "block", "direct", "direct", "all"]);
  });

  it("drops plain-security nodes like the other emitters", () => {
    const plain: ProxyNode = { ...vless(), name: "PV", port: 80, security: "none", sni: null };
    const out = emitXrayJson([vless(), plain], OPTS);
    expect(out).not.toContain("PV");
    expect(out).toContain("VLESS example.com 443");
  });

  it("routes everything direct with no balancer when no nodes serve", () => {
    const doc = JSON.parse(emitXrayJson([], OPTS)) as {
      routing: { rules: Array<Record<string, unknown>>; balancers: unknown[] };
    };
    expect(doc.routing.balancers).toEqual([]);
    expect(doc.routing.rules[doc.routing.rules.length - 1]).toEqual({
      type: "field",
      network: "tcp",
      outboundTag: "direct",
    });
  });
});
