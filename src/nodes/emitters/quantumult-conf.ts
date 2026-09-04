import type { ProxyNode } from "../../types/node";
import { TEST_URL, bareServer, visibleNodes as baseVisibleNodes } from "./registry";
import type { EmitOptions } from "./registry";

type QuantumultNode = Extract<ProxyNode, { kind: "vmess" | "trojan" | "vless" | "ss" }>;

const enc = (v: string): string => v.replace(/[,=\r\n]/g, (c) => encodeURIComponent(c));

function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): QuantumultNode[] {
  return baseVisibleNodes(nodes, isFragment).filter(
    (n): n is QuantumultNode =>
      n.kind === "vmess" ||
      n.kind === "ss" ||
      ((n.kind === "vless" || n.kind === "trojan") && n.security === "tls"),
  );
}

function serverPart(address: string, port: number): string {
  const host = bareServer(address);
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function vmessLine(node: Extract<ProxyNode, { kind: "vmess" }>): string {
  const parts = [
    `vmess = ${serverPart(node.address, node.port)}`,
    `method=${node.cipher === "auto" ? "none" : node.cipher}`,
    `password=${node.uuid}`,
    node.security === "tls" ? "obfs=wss" : "obfs=ws",
    `obfs-uri=${node.path}`,
    `obfs-host=${node.host}`,
  ];
  if (node.security === "tls") parts.push("tls-verification=true");
  if (node.security === "tls" && node.sni !== null) parts.push(`tls-host=${node.sni}`);
  parts.push("aead=true", `tag=${enc(node.name)}`);
  return parts.join(", ");
}

function vlessLine(node: Extract<ProxyNode, { kind: "vless" }>): string {
  const parts = [
    `vless = ${serverPart(node.address, node.port)}`,
    `password=${node.uuid}`,
    "obfs=wss",
    `obfs-uri=${node.path}`,
    `obfs-host=${node.host}`,
    "tls-verification=true",
  ];
  if (node.sni !== null) parts.push(`tls-host=${node.sni}`);
  parts.push(`tag=${enc(node.name)}`);
  return parts.join(", ");
}

function ssLine(node: Extract<ProxyNode, { kind: "ss" }>): string {
  const parts = [
    `shadowsocks = ${serverPart(node.address, node.port)}`,
    `method=${node.method}`,
    `password=${enc(node.password)}`,
    node.security === "tls" ? "obfs=wss" : "obfs=ws",
    `obfs-host=${node.host}`,
    `obfs-uri=${node.path}`,
    `tag=${enc(node.name)}`,
  ];
  return parts.join(", ");
}

function trojanLine(node: Extract<ProxyNode, { kind: "trojan" }>): string {
  const parts = [
    `trojan = ${serverPart(node.address, node.port)}`,
    `password=${enc(node.password)}`,
    "over-tls=true",
    "tls-verification=true",
  ];
  if (node.sni !== null) parts.push(`tls-host=${node.sni}`);
  parts.push(`tag=${enc(node.name)}`);
  return parts.join(", ");
}

export function emitQuantumultConf(
  nodes: readonly ProxyNode[],
  opts: EmitOptions,
): string {
  const visible = visibleNodes(nodes, opts.isFragment);
  const lines = visible.map((n) =>
    n.kind === "vmess" ? vmessLine(n) : n.kind === "vless" ? vlessLine(n) : n.kind === "ss" ? ssLine(n) : trojanLine(n),
  );
  const names = visible.map((n) => enc(n.name));
  const group =
    names.length > 0 ? `static = PROXY, ${names.join(", ")}` : "static = PROXY, direct";
  const sections = [
    `[general]\nserver_check_url = ${TEST_URL}`,
    `[server_local]\n${lines.join("\n")}`.trimEnd(),
    `[policy]\n${group}`,
    "[filter_local]\nfinal, PROXY",
  ];
  return `${sections.join("\n\n")}\n`;
}
