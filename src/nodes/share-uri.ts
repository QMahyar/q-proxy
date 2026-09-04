import type { ProxyNode, RealityNode, Hy2Node, SSNode, TrojanNode, VMessNode, VlessNode } from "../types/node";
import { encodeBase64Url, encodeUtf8Base64 } from "../utils/base64";
import { bracketIpv6 } from "../utils/net";

function enc(v: string): string {
  return encodeURIComponent(v);
}

function bareServer(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
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

function transportParams(node: VlessNode | TrojanNode): string[] {
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

export function buildTrojanShareUri(node: TrojanNode): string {
  const params = [
    `security=${node.security}`,
    ...(node.security === "tls" ? tlsParams(node) : []),
    ...transportParams(node),
  ];
  return `trojan://${enc(node.password)}@${authority(node.address, node.port)}?${params.join("&")}#${enc(node.name)}`;
}

export function buildVMessShareUri(node: VMessNode): string {
  const json = {
    v: "2",
    ps: node.name,
    add: bareServer(node.address),
    port: String(node.port),
    id: node.uuid,
    aid: "0",
    scy: node.cipher,
    net: "ws",
    type: "none",
    host: node.host,
    path: node.path,
    tls: node.security === "tls" ? "tls" : "",
    sni: node.sni ?? "",
    alpn: node.alpn.join(","),
    fp: node.fingerprint ?? "",
  };
  return `vmess://${encodeUtf8Base64(JSON.stringify(json))}`;
}

function sip002Escape(v: string): string {
  return v.replace(/([:;=\\])/g, "\\$1");
}

export function buildSSShareUri(node: SSNode): string {
  const userinfo = encodeBase64Url(`${node.method}:${node.password}`);
  if (node.direct === true) {
    return `ss://${userinfo}@${authority(node.address, node.port)}#${enc(node.name)}`;
  }
  const pluginArgs = [
    "v2ray-plugin",
    "mode=websocket",
    ...(node.security === "tls" ? ["tls"] : []),
    `host=${node.host}`,
    `path=${node.path}`,
  ].join(";");
  const plugin = encodeURIComponent(sip002Escape(pluginArgs));
  return `ss://${userinfo}@${authority(node.address, node.port)}/?plugin=${plugin}#${enc(node.name)}`;
}

export function buildVlessRealityUri(node: RealityNode): string {
  const params = [
    `encryption=none`,
    `security=reality`,
    `sni=${enc(node.sni ?? node.host)}`,
    `fp=${enc(node.fingerprint ?? "chrome")}`,
    `pbk=${enc(node.pbk)}`,
    ...(node.sid.length > 0 ? [`sid=${enc(node.sid)}`] : []),
    `type=tcp`,
    ...(node.flow.length > 0 ? [`flow=${enc(node.flow)}`] : []),
    ...(node.spx.length > 0 ? [`spx=${enc(node.spx)}`] : []),
  ];
  return `vless://${enc(node.uuid)}@${authority(node.address, node.port)}?${params.join("&")}#${enc(node.name)}`;
}

export function buildHy2Uri(node: Hy2Node): string {
  const params = [
    `sni=${enc(node.sni ?? node.host)}`,
    ...(node.obfs.length > 0 ? [`obfs=${enc(node.obfs)}`] : []),
    ...(node.obfsPassword.length > 0 ? [`obfs-password=${enc(node.obfsPassword)}`] : []),
  ];
  return `hysteria2://${enc(node.password)}@${authority(node.address, node.port)}?${params.join("&")}#${enc(node.name)}`;
}

export function buildShareUri(node: ProxyNode): string {
  switch (node.kind) {
    case "vless":
      return buildVlessShareUri(node);
    case "vmess":
      return buildVMessShareUri(node);
    case "trojan":
      return buildTrojanShareUri(node);
    case "ss":
      return buildSSShareUri(node);
    case "reality":
      return buildVlessRealityUri(node);
    case "hy2":
      return buildHy2Uri(node);
  }
}

export function buildShareUris(nodes: readonly ProxyNode[]): string[] {
  return nodes.map((n) => buildShareUri(n));
}
