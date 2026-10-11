import type { Fingerprint, ShadowsocksMethod } from "./settings";

export type NodeVariant = "normal" | "fragment";

export type NodeTag =
  | "workers-dev"
  | "custom-domain"
  | "clean-ip"
  | "cdn"
  | "fragment"
  | "proxy-ip"
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

export interface TrojanNode extends NodeBase {
  kind: "trojan";
  password: string;
}

export interface ShadowsocksNode extends NodeBase {
  kind: "shadowsocks";
  method: ShadowsocksMethod;
  password: string;
  tls: boolean;
}

export type ProxyNode = VlessNode | TrojanNode | ShadowsocksNode;
