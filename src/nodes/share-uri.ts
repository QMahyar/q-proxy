import type { ProxyNode, VlessNode } from "../types/node";
import { bracketIpv6 } from "../utils/net";

function enc(v: string): string {
  return encodeURIComponent(v);
}

function authority(host: string, port: number): string {
  return `${bracketIpv6(host)}:${port}`;
}

function tlsParams(node: VlessNode): string[] {
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
  return buildVlessShareUri(node);
}

export function buildShareUris(nodes: readonly ProxyNode[]): string[] {
  return nodes.map((n) => buildShareUri(n));
}
