import type { ProxyNode } from "../../types/node";
import { TEST_URL, bareServer, nodeHasAlpn, nodeHasEarlyData, nodeHasEch, nodeHasFingerprint, nodeHasTls, tlsRequiredNodes } from "./registry";
import type { EmitOptions } from "./registry";
import type { YamlObject } from "./yaml-writer";
import { writeYaml } from "./yaml-writer";

const echOpts = (node: ProxyNode): YamlObject => ({ enable: true, "query-server-name": node.ech });

function wsOpts(node: ProxyNode): YamlObject {
  const o: YamlObject = { path: node.path, headers: { Host: node.host } };
  if (nodeHasEarlyData(node)) {
    o["max-early-data"] = node.earlyData;
    o["early-data-header-name"] = "Sec-WebSocket-Protocol";
  }
  return o;
}

function ssPluginOpts(node: Extract<ProxyNode, { kind: "ss" }>): YamlObject {
  const o: YamlObject = { mode: "websocket" };
  if (nodeHasTls(node)) o.tls = true;
  o.host = node.host;
  o.path = node.path;
  return o;
}

function proxyEntry(node: ProxyNode): YamlObject {
  const isTls = nodeHasTls(node);
  const p: YamlObject = {
    name: node.name,
    type: node.kind,
    server: bareServer(node.address),
    port: node.port,
    udp: true,
  };
  if (node.kind === "vless") {
    p.uuid = node.uuid;
    if (node.flow) p.flow = node.flow;
    p.tls = isTls;
    if (isTls) p.servername = node.sni ?? node.host;
    if (nodeHasEch(node)) p["ech-opts"] = echOpts(node);
  } else if (node.kind === "vmess") {
    p.uuid = node.uuid;
    p.alterId = node.alterId;
    p.cipher = node.cipher;
    p.tls = isTls;
    if (isTls) p.servername = node.sni ?? node.host;
    if (nodeHasEch(node)) p["ech-opts"] = echOpts(node);
  } else if (node.kind === "trojan") {
    p.password = node.password;
    if (isTls) {
      p.sni = node.sni ?? node.host;
      if (nodeHasEch(node)) p["ech-opts"] = echOpts(node);
    }
  } else {
    p.udp = true;
    p.cipher = node.method;
    p.password = node.password;
    if (node.direct !== true) {
      p.plugin = "v2ray-plugin";
      p["plugin-opts"] = ssPluginOpts(node);
      if (isTls) p["skip-cert-verify"] = true;
    }
    return p;
  }
  if (isTls) {
    p["skip-cert-verify"] = true;
    if (nodeHasFingerprint(node) && node.fingerprint !== null) p["client-fingerprint"] = node.fingerprint;
    if (nodeHasAlpn(node)) p.alpn = [...node.alpn];
  }
  p.network = "ws";
  p["ws-opts"] = wsOpts(node);
  return p;
}

export function emitClashYaml(nodes: readonly ProxyNode[], opts: EmitOptions): string {
  const visible = tlsRequiredNodes(nodes, opts.isFragment);
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
    rules: buildRules(opts, names.length > 0),
  };
  return writeYaml(doc);
}

function buildRules(opts: EmitOptions, hasNodes: boolean): string[] {
  const r = opts.rules;
  if (!r) return [hasNodes ? "MATCH,PROXY" : "MATCH,DIRECT"];
  const out: string[] = [];
  if (r.blockDomains.length > 0) out.push(...r.blockDomains.map((d) => `DOMAIN-SUFFIX,${d},REJECT`));
  if (r.blockQuic) out.push("AND,((NETWORK,udp),(DST-PORT,443)),REJECT");
  if (r.bypassLan) {
    out.push("IP-CIDR,127.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve", "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve", "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve", "IP-CIDR,::1/128,DIRECT,no-resolve");
  }
  if (r.bypassDomains.length > 0) out.push(...r.bypassDomains.map((d) => `DOMAIN-SUFFIX,${d},DIRECT`));
  out.push(hasNodes ? "MATCH,PROXY" : "MATCH,DIRECT");
  return out;
}
