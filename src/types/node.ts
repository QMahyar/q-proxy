import type { Fingerprint, SsMethod } from "./settings";

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
}

export interface VMessNode extends NodeBase {
  kind: "vmess";
  uuid: string;
  cipher: "auto" | "none" | "zero" | "aes-128-gcm" | "chacha20-poly1305";
  alterId: 0;
}

export interface TrojanNode extends NodeBase {
  kind: "trojan";
  password: string;
}

export interface SSNode extends NodeBase {
  kind: "ss";
  method: SsMethod;
  password: string;
}

export type ProxyNode = VlessNode | VMessNode | TrojanNode | SSNode;
