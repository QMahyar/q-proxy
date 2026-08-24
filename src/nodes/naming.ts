import type { NodeTag, ProxyNode } from "../types/node";
import { bracketIpv6 } from "../utils/net";

const PROTO_LABEL: Record<ProxyNode["kind"], string> = {
  vless: "VLESS",
  vmess: "VMESS",
  trojan: "TROJAN",
  ss: "SS",
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

export function renderName(node: ProxyNode, country?: string | null): string {
  const parts = [
    countryFlag(country),
    PROTO_LABEL[node.kind],
    bracketIpv6(node.address),
    String(node.port),
    variantToken(node),
    tagToken(node.tags),
  ];
  return parts.filter((p) => p.length > 0).join(" ");
}
