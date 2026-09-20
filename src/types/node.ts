import type { Fingerprint } from "./settings";

export type NodeVariant = "normal" | "fragment";

export type NodeTag =
  | "workers-dev"
  | "custom-domain"
  | "clean-ip"
  | "cdn"
  | "fragment"
  | "no-tls";

export interface NodeBase {
  name: string;
  address: string;
  port: number;
  security: "tls" | "none";
  sni: string | null;
  host: string;
  path: string;
  earlyData: number;
  fingerprint: Fingerprint | null;
  alpn: string[];
  ech: string | null;
  variant: NodeVariant;
  tags: NodeTag[];
}

export interface VlessNode extends NodeBase {
  kind: "vless";
  uuid: string;
  flow?: string | null;
}

export type ProxyNode = VlessNode;
