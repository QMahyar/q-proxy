import type { ProxyNode } from "../../types/node";
import { DEFAULT_PROXY_DNS, TEST_URL, bareServer, nodeHasAlpn, nodeHasEarlyData, nodeHasFingerprint, nodeHasTls, tlsRequiredNodes } from "./registry";
import type { EmitOptions } from "./registry";

const PRIVATE_DIRECT_RULES = [
  "IP-CIDR,127.0.0.0/8,DIRECT",
  "IP-CIDR,10.0.0.0/8,DIRECT",
  "IP-CIDR,172.16.0.0/12,DIRECT",
  "IP-CIDR,192.168.0.0/16,DIRECT",
];

function yamlString(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function yamlList(values: string[]): string {
  return `[${values.map(yamlString).join(", ")}]`;
}

function proxyOf(node: ProxyNode): string {
  const server = bareServer(node.address);
  const lines = [
    `  - name: ${yamlString(node.name)}`,
    "    type: vless",
    `    server: ${yamlString(server)}`,
    `    port: ${node.port}`,
    `    uuid: ${node.uuid}`,
    "    udp: true",
  ];
  if (nodeHasTls(node)) {
    lines.push("    tls: true", `    servername: ${yamlString(node.sni ?? node.host)}`, "    skip-cert-verify: true");
    if (nodeHasAlpn(node)) lines.push(`    alpn: ${yamlList(node.alpn)}`);
    if (nodeHasFingerprint(node) && node.fingerprint !== null) lines.push(`    fingerprint: ${yamlString(node.fingerprint)}`);
  } else {
    lines.push("    tls: false");
  }
  lines.push("    network: ws");
  const early = nodeHasEarlyData(node) ? `, max-early-data: ${node.earlyData}` : "";
  lines.push(`    ws-opts: {path: ${yamlString(node.path)}, headers: {Host: ${yamlString(node.host)}}${early}}`);
  return lines.join("\n");
}

export function emitClashYaml(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = tlsRequiredNodes(nodes, opts.isFragment);
  const names = visible.map((n) => n.name);
  const out: string[] = [
    "port: 7890",
    "socks-port: 7891",
    "allow-lan: false",
    "mode: rule",
    "log-level: info",
    "dns:",
    "  enable: true",
    "  ipv6: false",
    "  nameserver:",
    `    - ${DEFAULT_PROXY_DNS}`,
    "proxies:",
  ];
  if (names.length === 0) out.push("  []");
  else for (const node of visible) out.push(proxyOf(node));
  out.push("proxy-groups:");
  if (names.length === 0) {
    out.push("  - {name: PROXY, type: select, proxies: [DIRECT]}");
  } else if (names.length === 1) {
    out.push(`  - {name: PROXY, type: select, proxies: ${yamlList(names)}}`);
  } else {
    out.push(`  - {name: PROXY, type: url-test, proxies: ${yamlList(names)}, url: ${TEST_URL}, interval: 300, tolerance: 50}`);
  }
  out.push("rules:");
  if (opts.rules) {
    for (const d of opts.rules.blockDomains) out.push(`  - DOMAIN-SUFFIX,${yamlString(d)},REJECT`);
    for (const d of opts.rules.bypassDomains) out.push(`  - DOMAIN-SUFFIX,${yamlString(d)},DIRECT`);
  }
  for (const rule of PRIVATE_DIRECT_RULES) out.push(`  - ${rule}`);
  out.push("  - MATCH,PROXY");
  return `${out.join("\n")}\n`;
}
