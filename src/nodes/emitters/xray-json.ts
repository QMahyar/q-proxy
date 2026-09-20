import type { ProxyNode } from "../../types/node";
import { DEFAULT_PROXY_DNS, bareServer, nodeHasAlpn, nodeHasFingerprint, nodeHasTls, tlsRequiredNodes } from "./registry";
import type { EmitOptions, EmitRules } from "./registry";

interface XrayVnextUser {
  id: string;
  encryption: "none";
  flow?: string;
}

interface XrayOutbound {
  tag: string;
  protocol: "vless" | "freedom" | "blackhole";
  settings?: unknown;
  streamSettings?: unknown;
}

function wsStream(node: ProxyNode): Record<string, unknown> {
  const ws: Record<string, unknown> = {
    network: "ws",
    wsSettings: { path: node.path, headers: { Host: node.host } },
  };
  if (!nodeHasTls(node)) {
    return { ...ws, security: "none" };
  }
  const tls: Record<string, unknown> = { serverName: node.sni ?? node.host };
  if (nodeHasAlpn(node)) tls.alpn = [...node.alpn];
  if (nodeHasFingerprint(node) && node.fingerprint !== null) tls.fingerprint = node.fingerprint;
  return { ...ws, security: "tls", tlsSettings: tls };
}

function vlessOutbound(node: ProxyNode): XrayOutbound {
  const user: XrayVnextUser = { id: node.uuid, encryption: "none" };
  if (node.flow !== null && node.flow !== undefined && node.flow.length > 0) user.flow = node.flow;
  return {
    tag: node.name,
    protocol: "vless",
    settings: { vnext: [{ address: bareServer(node.address), port: node.port, users: [user] }] },
    streamSettings: wsStream(node),
  };
}

function routingRules(names: string[], rules: EmitRules | undefined): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ type: "field", protocol: ["bittorrent"], outboundTag: "block" }];
  if (rules && rules.blockDomains.length > 0) {
    out.push({ type: "field", domain: [...rules.blockDomains], outboundTag: "block" });
  }
  if (rules && rules.blockQuic) {
    out.push({ type: "field", network: "udp", port: 443, outboundTag: "block" });
  }
  out.push({ type: "field", ip: ["geoip:private"], outboundTag: "direct" });
  if (rules && rules.bypassDomains.length > 0) {
    out.push({ type: "field", domain: [...rules.bypassDomains], outboundTag: "direct" });
  }
  out.push(
    names.length > 0
      ? { type: "field", network: "tcp", balancerTag: "all" }
      : { type: "field", network: "tcp", outboundTag: "direct" },
  );
  return out;
}

export function emitXrayJson(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = tlsRequiredNodes(nodes, opts.isFragment);
  const names = visible.map((n) => n.name);
  const doc: Record<string, unknown> = {
    log: { loglevel: "warning" },
    dns: { servers: [DEFAULT_PROXY_DNS] },
    inbounds: [
      {
        tag: "socks-in",
        protocol: "socks",
        listen: "127.0.0.1",
        port: 10808,
        sniffing: { enabled: true, destOverride: ["http", "tls"] },
        settings: { udp: true },
      },
    ],
    outbounds: [
      ...visible.map(vlessOutbound),
      { tag: "direct", protocol: "freedom" },
      { tag: "block", protocol: "blackhole" },
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: routingRules(names, opts.rules),
      balancers: names.length > 0 ? [{ tag: "all", selector: names, strategy: { type: "leastPing" } }] : [],
    },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
