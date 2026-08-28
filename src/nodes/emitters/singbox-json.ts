import type { ProxyNode } from "../../types/node";
import { TEST_URL, visibleNodes } from "./registry";
import type { EmitOptions } from "./registry";

interface SingBoxTls {
  enabled: boolean;
  server_name: string;
  alpn?: string[];
  utls?: { enabled: boolean; fingerprint: string };
  ech?: { enabled: boolean };
}

interface SingBoxTransport {
  type: "ws";
  path: string;
  headers: { Host: string };
  max_early_data?: number;
  early_data_header_name?: string;
}

function tlsObject(serverName: string, fingerprint: string | null, alpn: string[], ech: string | null): SingBoxTls {
  const t: SingBoxTls = { enabled: true, server_name: serverName };
  if (alpn.length > 0) t.alpn = [...alpn];
  if (fingerprint !== null) t.utls = { enabled: true, fingerprint };
  if (ech !== null && ech.length > 0) t.ech = { enabled: true };
  return t;
}

function transportObject(node: ProxyNode): SingBoxTransport {
  const t: SingBoxTransport = {
    type: "ws",
    path: node.path,
    headers: { Host: node.host },
  };
  if (node.earlyData > 0) {
    t.max_early_data = node.earlyData;
    t.early_data_header_name = "Sec-WebSocket-Protocol";
  }
  return t;
}

function outboundOf(node: ProxyNode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: node.kind === "ss" ? "shadowsocks" : node.kind,
    tag: node.name,
    server: node.address,
    server_port: node.port,
  };
  if (node.kind === "vless") {
    base.uuid = node.uuid;
    base.packet_encoding = "xudp";
    if (node.security === "tls") base.tls = tlsObject(node.sni ?? node.host, node.fingerprint, node.alpn, node.ech);
    base.transport = transportObject(node);
    return base;
  }
  if (node.kind === "vmess") {
    base.uuid = node.uuid;
    base.security = node.cipher;
    base.alter_id = node.alterId;
    base.packet_encoding = "xudp";
    if (node.security === "tls") base.tls = tlsObject(node.sni ?? node.host, node.fingerprint, node.alpn, node.ech);
    base.transport = transportObject(node);
    return base;
  }
  if (node.kind === "trojan") {
    base.password = node.password;
    if (node.security === "tls") base.tls = tlsObject(node.sni ?? node.host, node.fingerprint, node.alpn, node.ech);
    base.transport = transportObject(node);
    return base;
  }
  base.method = node.method;
  base.password = node.password;
  base.plugin = "v2ray-plugin";
  base.plugin_opts = [
    "mode=websocket",
    ...(node.security === "tls" ? ["tls"] : []),
    `host=${node.host}`,
    `path=${node.path}`,
  ].join(";");
  return base;
}

export function emitSingBoxJson(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = visibleNodes(nodes, opts.isFragment);
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

  const doc = {
    log: { level: "info", timestamp: true },
    dns: {
      servers: dnsServers,
      rules: [{ outbound: "any", server: "local-dns" }],
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
      rules: [
        { protocol: "dns", action: "hijack-dns" },
        ...(opts.rules && opts.rules.blockDomains.length > 0
          ? [{ domain_suffix: [...opts.rules.blockDomains], action: "reject" }]
          : []),
        ...(opts.rules && opts.rules.blockQuic ? [{ network: "udp", port: 443, action: "reject" }] : []),
        { ip_is_private: true, outbound: "DIRECT" },
        ...(opts.rules && opts.rules.bypassDomains.length > 0
          ? [{ domain_suffix: [...opts.rules.bypassDomains], outbound: "DIRECT" }]
          : []),
      ],
      final: hasNodes ? "PROXY" : "DIRECT",
      auto_detect_interface: true,
    },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
