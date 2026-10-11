import type { ProxyNode } from "../../types/node";
import { stripBrackets } from "../../utils/net";
import { emitClashYaml } from "./clash-yaml";
import { emitSingBoxJson } from "./singbox-json";
import { emitXrayJson } from "./xray-json";

import type { TlsFragmentPreset } from "../../types/settings";

export interface EmitRules {
  bypassLan: boolean;
  bypassDomains: string[];
  blockDomains: string[];
  blockQuic: boolean;
}

export interface EmitOptions {
  isFragment: boolean;
  subscriptionUrl?: string;
  updateIntervalHours?: number;
  rules?: EmitRules;
  tlsFragment?: TlsFragmentPreset;
}

export const TEST_URL = "https://www.gstatic.com/generate_204";

export const DEFAULT_PROXY_DNS = "https://8.8.8.8/dns-query";

export function bareServer(address: string): string {
  return stripBrackets(address);
}

export function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): ProxyNode[] {
  return nodes.filter((n) => isFragment || n.variant !== "fragment");
}

export function tlsRequiredNodes(nodes: readonly ProxyNode[], isFragment: boolean): ProxyNode[] {
  return visibleNodes(nodes, isFragment).filter((n) => !(n.kind === "vless" && n.security === "none"));
}

export function nodeHasTls(node: ProxyNode): boolean {
  return node.security === "tls";
}

export function nodeHasEch(node: ProxyNode): boolean {
  return node.ech !== null && node.ech.length > 0;
}

export function nodeHasEarlyData(node: ProxyNode): boolean {
  return node.earlyData > 0;
}

export function nodeHasFingerprint(node: ProxyNode): boolean {
  return node.fingerprint !== null;
}

export function nodeHasAlpn(node: ProxyNode): boolean {
  return node.alpn.length > 0;
}

export type NodeEmitter = (nodes: readonly ProxyNode[], opts: EmitOptions) => string;

export type SyncSubFormat = "singbox" | "clash" | "xray";

export const EMITTERS: Record<SyncSubFormat, NodeEmitter> = {
  singbox: emitSingBoxJson,
  clash: emitClashYaml,
  xray: emitXrayJson,
};
