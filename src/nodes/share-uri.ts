import type { ProxyNode, ShadowsocksNode, TrojanNode, VlessNode } from "../types/node";
import { bracketIpv6 } from "../utils/net";
import { encodeUtf8Base64 } from "../utils/base64";

function enc(v: string): string {
  return encodeURIComponent(v);
}

function authority(host: string, port: number): string {
  return `${bracketIpv6(host)}:${port}`;
}

function tlsParams(node: VlessNode | TrojanNode): string[] {
  const p: string[] = [];
  if (node.sni !== null && node.sni.length > 0) p.push(`sni=${enc(node.sni)}`);
  if (node.fingerprint !== null) p.push(`fp=${enc(node.fingerprint)}`);
  if (node.alpn.length > 0) p.push(`alpn=${enc(node.alpn.join(","))}`);
  if (node.ech !== null && node.ech.length > 0) p.push(`ech=${enc(node.ech)}`);
  return p;
}

function transportParams(node: VlessNode): string[] {
  return [`type=ws`, `host=${enc(node.host)}`, `path=${enc(node.path)}`];
}

export function buildVlessShareUri(node: VlessNode): string {
  const params = [
    `encryption=none`,
    `security=${node.security}`,
    ...(node.security === "tls" ? tlsParams(node) : []),
    ...transportParams(node),
    ...(node.flow ? [`flow=${enc(node.flow)}`] : []),
  ];
  return `vless://${enc(node.uuid)}@${authority(node.address, node.port)}?${params.join("&")}#${enc(node.name)}`;
}

export function buildShareUri(node: ProxyNode): string {
  switch (node.kind) {
    case "trojan":
      return buildTrojanShareUri(node);
    case "shadowsocks":
      return buildShadowsocksShareUri(node);
    case "vless":
      return buildVlessShareUri(node);
  }
}

export function buildTrojanShareUri(node: TrojanNode): string {
  const params = node.security === "tls" ? [`security=tls`, ...tlsParams(node)] : [`security=none`];
  params.push(`type=ws`, `host=${enc(node.host)}`, `path=${enc(node.path)}`);
  return `trojan://${enc(node.password)}@${authority(node.address, node.port)}?${params.join("&")}#${enc(node.name)}`;
}

export function buildShadowsocksShareUri(node: ShadowsocksNode): string {
  // SIP002-style userinfo; `tls=1&sni=` marks TLS-wrapped nodes (no
  // standard slot exists — clients ignore unknown query keys).
  const userinfo = encodeUtf8Base64(`${node.method}:${node.password}`);
  const tls = node.security === "tls" || node.tls;
  const suffix = tls && node.sni !== null && node.sni.length > 0 ? `?tls=1&sni=${enc(node.sni)}` : "";
  return `ss://${userinfo}@${authority(node.address, node.port)}${suffix}#${enc(node.name)}`;
}

export function buildShareUris(nodes: readonly ProxyNode[]): string[] {
  return nodes.map((n) => buildShareUri(n));
}
