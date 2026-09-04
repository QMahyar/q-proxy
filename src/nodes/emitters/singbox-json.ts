import type { ProxyNode, SSNode, VMessNode } from "../../types/node";
import { TEST_URL, bareServer, nodeHasAlpn, nodeHasEarlyData, nodeHasEch, nodeHasFingerprint, nodeHasTls, tlsRequiredNodes } from "./registry";
import type { EmitOptions } from "./registry";

interface SingBoxTls {
  enabled: boolean;
  server_name: string;
  alpn?: string[];
  utls?: { enabled: boolean; fingerprint: string };
  ech?: { enabled: boolean; query_server_name: string };
}

interface SingBoxTransport {
  type: "ws";
  path: string;
  headers: { Host: string };
  max_early_data?: number;
  early_data_header_name?: string;
}

export interface SingBoxVlessOutbound {
  type: "vless";
  tag: string;
  server: string;
  server_port: number;
  uuid: string;
  packet_encoding: "xudp";
  tls?: SingBoxTls;
  transport: SingBoxTransport;
}

export interface SingBoxVmessOutbound {
  type: "vmess";
  tag: string;
  server: string;
  server_port: number;
  uuid: string;
  security: VMessNode["cipher"];
  alter_id: VMessNode["alterId"];
  packet_encoding: "xudp";
  tls?: SingBoxTls;
  transport: SingBoxTransport;
}

export interface SingBoxTrojanOutbound {
  type: "trojan";
  tag: string;
  server: string;
  server_port: number;
  password: string;
  tls?: SingBoxTls;
  transport: SingBoxTransport;
}

export interface SingBoxShadowsocksOutbound {
  type: "shadowsocks";
  tag: string;
  server: string;
  server_port: number;
  method: SSNode["method"];
  password: string;
  plugin: "v2ray-plugin";
  plugin_opts: string;
}

export type SingBoxOutbound =
  | SingBoxVlessOutbound
  | SingBoxVmessOutbound
  | SingBoxTrojanOutbound
  | SingBoxShadowsocksOutbound;

function tlsObject(node: ProxyNode, serverName: string): SingBoxTls {
  const t: SingBoxTls = { enabled: true, server_name: serverName };
  if (nodeHasAlpn(node)) t.alpn = [...node.alpn];
  if (nodeHasFingerprint(node) && node.fingerprint !== null) t.utls = { enabled: true, fingerprint: node.fingerprint };
  if (nodeHasEch(node) && node.ech !== null && node.ech.length > 0) t.ech = { enabled: true, query_server_name: node.ech };
  return t;
}

function transportObject(node: ProxyNode): SingBoxTransport {
  const t: SingBoxTransport = {
    type: "ws",
    path: node.path,
    headers: { Host: node.host },
  };
  if (nodeHasEarlyData(node)) {
    t.max_early_data = node.earlyData;
    t.early_data_header_name = "Sec-WebSocket-Protocol";
  }
  return t;
}

function outboundOf(node: ProxyNode): SingBoxOutbound {
  const server = bareServer(node.address);
  if (node.kind === "vless") {
    return {
      type: "vless",
      tag: node.name,
      server,
      server_port: node.port,
      uuid: node.uuid,
      packet_encoding: "xudp",
      ...(nodeHasTls(node) ? { tls: tlsObject(node, node.sni ?? node.host) } : {}),
      transport: transportObject(node),
    };
  }
  if (node.kind === "vmess") {
    return {
      type: "vmess",
      tag: node.name,
      server,
      server_port: node.port,
      uuid: node.uuid,
      security: node.cipher,
      alter_id: node.alterId,
      packet_encoding: "xudp",
      ...(nodeHasTls(node) ? { tls: tlsObject(node, node.sni ?? node.host) } : {}),
      transport: transportObject(node),
    };
  }
  if (node.kind === "trojan") {
    return {
      type: "trojan",
      tag: node.name,
      server,
      server_port: node.port,
      password: node.password,
      ...(nodeHasTls(node) ? { tls: tlsObject(node, node.sni ?? node.host) } : {}),
      transport: transportObject(node),
    };
  }
  return {
    type: "shadowsocks",
    tag: node.name,
    server,
    server_port: node.port,
    method: node.method,
    password: node.password,
    plugin: "v2ray-plugin",
    plugin_opts: [
      "mode=websocket",
      ...(nodeHasTls(node) ? ["tls"] : []),
      `host=${node.host}`,
      `path=${node.path}`,
    ].join(";"),
  };
}

export function emitSingBoxJson(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = tlsRequiredNodes(nodes, opts.isFragment);
  const names = visible.map((n) => n.name);
  const hasNodes = names.length > 0;
  const group: Record<string, unknown> | null = hasNodes
    ? names.length > 1
      ? {
          type: "urltest",
          tag: "PROXY",
          outbounds: names,
          url: TEST_URL,
          interval: `${opts.urlTestIntervalSec}s`,
          tolerance: 50,
        }
      : { type: "selector", tag: "PROXY", outbounds: names }
    : null;

  const dnsServers: Record<string, unknown>[] = hasNodes
    ? [
        { tag: "proxy-dns", address: opts.remoteDns, detour: "PROXY" },
        { tag: "local-dns", address: "local" },
      ]
    : [{ tag: "local-dns", address: opts.remoteDns }];

  const routeRules: Record<string, unknown>[] = [{ protocol: "dns", action: "hijack-dns" }];
  if (opts.rules && opts.rules.blockDomains.length > 0) {
    routeRules.push({ domain_suffix: [...opts.rules.blockDomains], action: "reject", method: "drop" });
  }
  if (opts.rules && opts.rules.blockQuic) {
    routeRules.push({ network: "udp", port: 443, action: "reject", method: "drop" });
  }
  routeRules.push({ ip_is_private: true, action: "route", outbound: "DIRECT" });
  if (opts.rules && opts.rules.bypassDomains.length > 0) {
    routeRules.push({ domain_suffix: [...opts.rules.bypassDomains], action: "route", outbound: "DIRECT" });
  }

  const doc = {
    log: { level: "info", timestamp: true },
    dns: {
      servers: dnsServers,
      rules: [],
      final: hasNodes ? "proxy-dns" : "local-dns",
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        address: ["172.18.0.1/30", "fdfe:dcba:9876::1/126"],
        auto_route: true,
        strict_route: true,
      },
      {
        type: "mixed",
        tag: "mixed-in",
        listen: "127.0.0.1",
        listen_port: 2080,
      },
    ],
    outbounds: [
      ...visible.map(outboundOf),
      ...(group ? [group] : []),
      { type: "direct", tag: "DIRECT" },
    ],
    route: {
      rules: routeRules,
      final: hasNodes ? "PROXY" : "DIRECT",
      auto_detect_interface: true,
    },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
