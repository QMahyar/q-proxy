import type { ProxyNode } from "../../types/node";
import { TEST_URL, bareServer, visibleNodes as baseVisibleNodes } from "./registry";
import type { EmitOptions } from "./registry";

type SurgeNode = Extract<ProxyNode, { kind: "vmess" | "trojan" | "vless" | "ss" }>;

const enc = (v: string): string => v.replace(/[,=\r\n]/g, (c) => encodeURIComponent(c));

function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): SurgeNode[] {
  return baseVisibleNodes(nodes, isFragment).filter(
    (n): n is SurgeNode =>
      n.kind === "vmess" ||
      n.kind === "ss" ||
      ((n.kind === "vless" || n.kind === "trojan") && n.security === "tls"),
  );
}

function vmessLine(node: Extract<ProxyNode, { kind: "vmess" }>): string {
  const parts = [
    `${enc(node.name)} = vmess`,
    bareServer(node.address),
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

function vlessLine(node: Extract<ProxyNode, { kind: "vless" }>): string {
  const parts = [
    `${enc(node.name)} = vless`,
    bareServer(node.address),
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

function ssLine(node: Extract<ProxyNode, { kind: "ss" }>): string {
  const parts = [
    `${enc(node.name)} = ss`,
    bareServer(node.address),
    String(node.port),
    `encrypt-method=${node.method}`,
    `password=${enc(node.password)}`,
    node.security === "tls" ? "tls=true" : "tls=false",
    "ws=true",
    `ws-path=${node.path}`,
    `ws-headers=Host:${node.host}`,
  ];
  if (node.security === "tls" && node.sni !== null) parts.push(`sni=${node.sni}`);
  return parts.join(", ");
}

function trojanLine(node: Extract<ProxyNode, { kind: "trojan" }>): string {
  const parts = [
    `${enc(node.name)} = trojan`,
    bareServer(node.address),
    String(node.port),
    `password=${enc(node.password)}`,
    "tls=true",
    "ws=true",
    `ws-path=${node.path}`,
    `ws-headers=Host:${node.host}`,
  ];
  if (node.sni !== null) parts.push(`sni=${node.sni}`);
  return parts.join(", ");
}

export function emitSurgeConf(
  nodes: readonly ProxyNode[],
  opts: EmitOptions,
): string {
  const visible = visibleNodes(nodes, opts.isFragment);
  const lines = visible.map((n) =>
    n.kind === "vmess" ? vmessLine(n) : n.kind === "vless" ? vlessLine(n) : n.kind === "ss" ? ssLine(n) : trojanLine(n),
  );
  const names = visible.map((n) => enc(n.name));
  const group =
    names.length > 1
      ? `PROXY = url-test, ${names.join(", ")}, url=${TEST_URL}, interval=${opts.urlTestIntervalSec}, tolerance=50`
      : names.length === 1
        ? `PROXY = select, ${names[0]}`
        : "PROXY = select, DIRECT";
  const managed =
    opts.subscriptionUrl !== undefined && opts.updateIntervalHours !== undefined
      ? `#!MANAGED-CONFIG ${opts.subscriptionUrl} interval=${opts.updateIntervalHours * 3600} strict=true\n`
      : "";
  const sections = [
    "[General]\nloglevel = notify",
    `[Proxy]\n${lines.join("\n")}`.trimEnd(),
    `[Proxy Group]\n${group}`,
    "[Rule]\nFINAL,PROXY",
  ];
  return `${managed}${sections.join("\n\n")}\n`;
}
