import type { ProxyNode } from "../../types/node";
import { TEST_URL, bareServer, visibleNodes as baseVisibleNodes } from "./registry";
import type { EmitOptions } from "./registry";

type LoonNode = Extract<ProxyNode, { kind: "vmess" | "trojan" | "vless" | "ss" }>;
type TlsLoonNode = Extract<ProxyNode, { kind: "vmess" | "trojan" | "vless" }>;

const q = (v: string): string =>
  v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
const nameEsc = (v: string): string => v.replace(/[\r\n]+/g, " ");

function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): LoonNode[] {
  return baseVisibleNodes(nodes, isFragment).filter(
    (n): n is LoonNode =>
      n.kind === "vmess" ||
      n.kind === "ss" ||
      (n.kind === "vless" && n.security === "tls") ||
      (n.kind === "trojan" && n.security === "tls"),
  );
}

function tlsProfile(node: TlsLoonNode): string | null {
  if (node.security !== "tls" || node.fingerprint === null) return null;
  if (node.fingerprint === "chrome") return "chrome";
  if (node.fingerprint === "safari") return "safari";
  if (node.fingerprint === "ios") return "ios26";
  return null;
}

function tlsExtras(node: TlsLoonNode): string[] {
  const out: string[] = [];
  const profile = tlsProfile(node);
  if (profile !== null) out.push(`tls-profile=${profile}`);
  if (node.security === "tls" && node.ech !== null && node.ech.length > 0) out.push(`ech=${node.ech}`);
  return out;
}

function ssPluginOpts(node: Extract<ProxyNode, { kind: "ss" }>): string {
  const parts = ["mode=websocket"];
  if (node.security === "tls") parts.push("tls");
  parts.push(`host=${node.host}`, `path=${node.path}`);
  return parts.join(";");
}

function ssLine(node: Extract<ProxyNode, { kind: "ss" }>): string {
  const parts = [
    `${nameEsc(node.name)} = Shadowsocks`,
    bareServer(node.address),
    String(node.port),
    node.method,
    `"${q(node.password)}"`,
    "plugin=v2ray-plugin",
    `plugin-opts="${q(ssPluginOpts(node))}"`,
    "udp=true",
  ];
  return parts.join(", ");
}

function vmessLine(node: Extract<ProxyNode, { kind: "vmess" }>): string {
  const parts = [
    `${nameEsc(node.name)} = vmess`,
    bareServer(node.address),
    String(node.port),
    node.cipher,
    `"${q(node.uuid)}"`,
    `alterId=${node.alterId}`,
    "udp=true",
    node.security === "tls" ? "over-tls=true" : "over-tls=false",
  ];
  if (node.security === "tls" && node.sni !== null) parts.push(`tls-name=${node.sni}`);
  parts.push(...tlsExtras(node));
  parts.push("transport=ws", `path=${node.path}`, `host=${node.host}`);
  return parts.join(", ");
}

function trojanLine(node: Extract<ProxyNode, { kind: "trojan" }>): string {
  const parts = [
    `${nameEsc(node.name)} = trojan`,
    bareServer(node.address),
    String(node.port),
    `"${q(node.password)}"`,
    "udp=true",
  ];
  if (node.sni !== null) parts.push(`tls-name=${node.sni}`);
  if (node.security === "tls") parts.push("over-tls=true");
  parts.push(...tlsExtras(node));
  parts.push("transport=ws", `path=${node.path}`, `host=${node.host}`);
  return parts.join(", ");
}

function vlessLine(node: Extract<ProxyNode, { kind: "vless" }>): string {
  const parts = [
    `${nameEsc(node.name)} = vless`,
    bareServer(node.address),
    String(node.port),
    `"${q(node.uuid)}"`,
    "udp=true",
  ];
  if (node.security === "tls") {
    parts.push("over-tls=true");
    if (node.sni !== null) parts.push(`tls-name=${node.sni}`);
    parts.push(...tlsExtras(node));
  }
  parts.push("transport=ws", `path=${node.path}`, `host=${node.host}`);
  return parts.join(", ");
}

export function emitLoonConf(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = visibleNodes(nodes, opts.isFragment);
  const lines = visible.map((n) =>
    n.kind === "vmess" ? vmessLine(n) : n.kind === "vless" ? vlessLine(n) : n.kind === "ss" ? ssLine(n) : trojanLine(n),
  );
  const names = visible.map((n) => nameEsc(n.name));
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
