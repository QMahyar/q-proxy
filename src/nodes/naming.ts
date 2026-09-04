import type { NodeTag, ProxyNode } from "../types/node";
import { bracketIpv6 } from "../utils/net";

const PROTO_LABEL: Record<ProxyNode["kind"], string> = {
  vless: "VLESS",
  vmess: "VMESS",
  trojan: "TROJAN",
  ss: "SS",
  reality: "REALITY",
  hy2: "HY2",
};

const PROTO_TAG: Record<ProxyNode["kind"], string> = {
  vless: "vless",
  vmess: "vmess",
  trojan: "trojan",
  ss: "ss",
  reality: "reality",
  hy2: "hy2",
};

const TAG_LABEL: Partial<Record<NodeTag, string>> = {
  "workers-dev": "Workers-Dev",
  "custom-domain": "Custom-Domain",
  "clean-ip": "Clean-IP",
  cdn: "CDN",
};

export function countryFlag(country: string | null | undefined): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return "";
  const upper = country.toUpperCase();
  let flag = "";
  for (const ch of upper) flag += String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65);
  return flag;
}

function variantToken(node: ProxyNode): string {
  if (node.variant === "fragment") return "Frag";
  if (node.security === "none") return "Plain";
  return "";
}

function tagToken(tags: readonly NodeTag[]): string {
  return tags
    .filter((t) => t !== "fragment" && t !== "no-tls")
    .map((t) => TAG_LABEL[t] ?? "")
    .filter((t) => t.length > 0)
    .join("-");
}

function joinHost(input: string): string {
  return bracketIpv6(input);
}

interface NameCtx {
  node: ProxyNode;
  label?: string;
  template?: string;
  country?: string | null;
  host?: string;
}

function expandTemplate(tmpl: string, ctx: NameCtx): string {
  const node = ctx.node;
  const flag = countryFlag(ctx.country);
  const country = typeof ctx.country === "string" ? ctx.country.toUpperCase() : "";
  const map: Record<string, string> = {
    IP: joinHost(node.address),
    PORT: String(node.port),
    PROTOCOL: PROTO_TAG[node.kind],
    PROTOCOL_LABEL: PROTO_LABEL[node.kind],
    IP_NAME: String(ctx.label ?? ""),
    LABEL: String(ctx.label ?? ""),
    HOST: String(ctx.host ?? ""),
    FLAG: flag,
    COUNTRY: country,
    WORKER: String(ctx.host ?? ""),
  };
  return tmpl.replace(/\{([A-Z_]+)\}/g, (m, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : m));
}

export function renderName(node: ProxyNode, country?: string | null, label?: string, template?: string, host?: string): string {
  const baseName = String(label ?? "").trim();
  if (baseName.length > 0) return baseName;
  if (template && template.trim().length > 0) {
    const expanded = expandTemplate(template.trim(), { node, label, template, country, host });
    const cleaned = expanded.trim();
    if (cleaned.length > 0) return cleaned;
  }
  const parts = [
    countryFlag(country),
    PROTO_LABEL[node.kind],
    joinHost(node.address),
    String(node.port),
    variantToken(node),
    tagToken(node.tags),
  ];
  return parts.filter((p) => p.length > 0).join(" ");
}
