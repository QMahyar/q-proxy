import type { ProxyNode } from "../../types/node";
import type { EmitOptions } from "./registry";
import type { YamlObject } from "./yaml-writer";
import { writeYaml } from "./yaml-writer";

const TEST_URL = "https://www.gstatic.com/generate_204";

function wsOpts(node: ProxyNode): YamlObject {
  const o: YamlObject = { path: node.path, headers: { Host: node.host } };
  if (node.earlyData > 0) {
    o["max-early-data"] = node.earlyData;
    o["early-data-header-name"] = "Sec-WebSocket-Protocol";
  }
  return o;
}

function ssPluginOpts(node: Extract<ProxyNode, { kind: "ss" }>): YamlObject {
  const o: YamlObject = { mode: "websocket" };
  if (node.security === "tls") o.tls = true;
  o.host = node.host;
  o.path = node.path;
  return o;
}

function proxyEntry(node: ProxyNode): YamlObject {
  const isTls = node.security === "tls";
  const p: YamlObject = {
    name: node.name,
    type: node.kind,
    server: node.address,
    port: node.port,
    udp: true,
  };
  if (node.kind === "vless") {
    p.uuid = node.uuid;
    p.tls = isTls;
    if (isTls) p.servername = node.sni ?? node.host;
  } else if (node.kind === "vmess") {
    p.uuid = node.uuid;
    p.alterId = node.alterId;
    p.cipher = node.cipher;
    p.tls = isTls;
    if (isTls) p.servername = node.sni ?? node.host;
  } else if (node.kind === "trojan") {
    p.password = node.password;
    if (isTls) p.sni = node.sni ?? node.host;
  } else {
    p.cipher = node.method;
    p.password = node.password;
    p.plugin = "v2ray-plugin";
    p["plugin-opts"] = ssPluginOpts(node);
    return p;
  }
  if (isTls) {
    if (node.fingerprint !== null) p["client-fingerprint"] = node.fingerprint;
    if (node.alpn.length > 0) p.alpn = [...node.alpn];
  }
  p.network = "ws";
  p["ws-opts"] = wsOpts(node);
  return p;
}

export function emitClashYaml(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = nodes.filter((n) => opts.isFragment || n.variant !== "fragment");
  const proxies = visible.map(proxyEntry);
  const names = proxies.map((p) => String(p.name));
  const groups: YamlObject[] =
    names.length > 1
      ? [
          {
            name: "PROXY",
            type: "url-test",
            url: TEST_URL,
            interval: opts.urlTestIntervalSec,
            tolerance: 50,
            proxies: names,
          },
        ]
      : names.length === 1
        ? [{ name: "PROXY", type: "select", proxies: names }]
        : [];
  const doc: YamlObject = {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    proxies,
    "proxy-groups": groups,
    rules: [names.length > 0 ? "MATCH,PROXY" : "MATCH,DIRECT"],
  };
  return writeYaml(doc);
}
