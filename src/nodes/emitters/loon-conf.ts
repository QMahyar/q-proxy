import type { ProxyNode } from "../../types/node";
import { TEST_URL, visibleNodes as baseVisibleNodes } from "./registry";
import type { EmitOptions } from "./registry";

type LoonNode = Extract<ProxyNode, { kind: "vmess" | "trojan" | "vless" }>;

function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): LoonNode[] {
  return baseVisibleNodes(nodes, isFragment).filter(
    (n): n is LoonNode =>
      n.kind === "vmess" ||
      (n.kind === "vless" && n.security === "tls") ||
      (n.kind === "trojan" && n.security === "tls"),
  );
}

function vmessLine(node: Extract<ProxyNode, { kind: "vmess" }>): string {
  const parts = [
    `${node.name} = vmess`,
    node.address,
    String(node.port),
    node.cipher,
    `"${node.uuid}"`,
    `alterId=${node.alterId}`,
    "udp=true",
    node.security === "tls" ? "over-tls=true" : "over-tls=false",
  ];
  if (node.security === "tls" && node.sni !== null) parts.push(`sni=${node.sni}`);
  parts.push("transport=ws", `path=${node.path}`, `host=${node.host}`);
  return parts.join(", ");
}

function trojanLine(node: Extract<ProxyNode, { kind: "trojan" }>): string {
  const parts = [
    `${node.name} = trojan`,
    node.address,
    String(node.port),
    `"${node.password}"`,
    "udp=true",
  ];
  if (node.sni !== null) parts.push(`sni=${node.sni}`);
  if (node.security === "tls") parts.push("over-tls=true");
  parts.push("transport=ws", `path=${node.path}`, `host=${node.host}`);
  return parts.join(", ");
}

function vlessLine(node: Extract<ProxyNode, { kind: "vless" }>): string {
  const parts = [
    `${node.name} = vless`,
    node.address,
    String(node.port),
    `"${node.uuid}"`,
    "udp=true",
  ];
  if (node.security === "tls") {
    parts.push("over-tls=true");
    if (node.sni !== null) parts.push(`sni=${node.sni}`);
  }
  parts.push("transport=ws", `path=${node.path}`, `host=${node.host}`);
  return parts.join(", ");
}

export function emitLoonConf(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = visibleNodes(nodes, opts.isFragment);
  const lines = visible.map((n) => (n.kind === "vmess" ? vmessLine(n) : n.kind === "vless" ? vlessLine(n) : trojanLine(n)));
  const names = lines.map((l) => l.slice(0, l.indexOf(" =")));
  const group =
    names.length > 1
      ? `PROXY = url-test, ${names.join(", ")}, url=${TEST_URL}, interval=${opts.urlTestIntervalSec}, tolerance=50, timeout=5`
      : names.length === 1
        ? `PROXY = select, ${names[0]}`
        : `PROXY = select, DIRECT`;
  const sections = [
    "[General]\nloglevel = notify",
    `[Proxy]\n${lines.join("\n")}`.trimEnd(),
    `[Proxy Group]\n${group}`,
    "[Rule]\nFINAL,PROXY",
  ];
  return `${sections.join("\n\n")}\n`;
}
