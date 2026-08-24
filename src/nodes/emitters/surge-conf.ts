import type { ProxyNode } from "../../types/node";
import type { EmitOptions } from "./registry";

const TEST_URL = "https://www.gstatic.com/generate_204";

type SurgeNode = Extract<ProxyNode, { kind: "vmess" | "trojan" | "vless" }>;

function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): SurgeNode[] {
  return nodes.filter(
    (n): n is SurgeNode =>
      (isFragment || n.variant !== "fragment") &&
      (n.kind === "vmess" ||
        (n.kind === "vless" && n.security === "tls") ||
        (n.kind === "trojan" && n.security === "tls")),
  );
}

function vmessLine(node: Extract<ProxyNode, { kind: "vmess" }>): string {
  const parts = [
    `${node.name} = vmess`,
    node.address,
    String(node.port),
    `username=${node.uuid}`,
    node.security === "tls" ? "tls=true" : "tls=false",
    "vmess-aead=true",
    "ws=true",
    `ws-path=${node.path}`,
    `ws-headers=Host:${node.host}`,
  ];
  if (node.security === "tls" && node.sni !== null) parts.push(`sni=${node.sni}`);
  return parts.join(", ");
}

function trojanLine(node: Extract<ProxyNode, { kind: "trojan" }>): string {
  const parts = [
    `${node.name} = trojan`,
    node.address,
    String(node.port),
    `password=${node.password}`,
    "tls=true",
    "ws=true",
    `ws-path=${node.path}`,
    `ws-headers=Host:${node.host}`,
  ];
  if (node.sni !== null) parts.push(`sni=${node.sni}`);
  return parts.join(", ");
}

function vlessLine(node: Extract<ProxyNode, { kind: "vless" }>): string {
  const parts = [
    `${node.name} = vless`,
    node.address,
    String(node.port),
    `username=${node.uuid}`,
    node.security === "tls" ? "tls=true" : "tls=false",
    "ws=true",
    `ws-path=${node.path}`,
    `ws-headers=Host:${node.host}`,
  ];
  if (node.security === "tls" && node.sni !== null) parts.push(`sni=${node.sni}`);
  return parts.join(", ");
}

export function emitSurgeConf(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = visibleNodes(nodes, opts.isFragment);
  const lines = visible.map((n) => (n.kind === "vmess" ? vmessLine(n) : n.kind === "vless" ? vlessLine(n) : trojanLine(n)));
  const names = lines.map((l) => l.slice(0, l.indexOf(" =")));
  const group =
    names.length > 1
      ? `PROXY = url-test, ${names.join(", ")}, url=${TEST_URL}, interval=${opts.urlTestIntervalSec}, tolerance=50`
      : names.length === 1
        ? `PROXY = select, ${names[0]}`
        : "PROXY = select, DIRECT";
  const sections = [
    "[General]\nloglevel = notify",
    `[Proxy]\n${lines.join("\n")}`.trimEnd(),
    `[Proxy Group]\n${group}`,
    "[Rule]\nFINAL,PROXY",
  ];
  return `${sections.join("\n\n")}\n`;
}
