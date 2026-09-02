import type { SubFormat } from "../../core/ua";
import type { ProxyNode } from "../../types/node";
import { emitClashYaml } from "./clash-yaml";
import { emitLoonConf } from "./loon-conf";
import { emitSingBoxJson } from "./singbox-json";
import { emitSurgeConf } from "./surge-conf";

export interface EmitRules {
  bypassLan: boolean;
  bypassDomains: string[];
  blockDomains: string[];
  blockQuic: boolean;
}

export interface EmitOptions {
  remoteDns: string;
  urlTestIntervalSec: number;
  isFragment: boolean;
  subscriptionUrl?: string;
  updateIntervalHours?: number;
  rules?: EmitRules;
}

export const TEST_URL = "https://www.gstatic.com/generate_204";

export function bareServer(address: string): string {
  return address.replace(/^\[/, "").replace(/\]$/, "");
}

export function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): ProxyNode[] {
  return nodes.filter((n) => isFragment || n.variant !== "fragment");
}

export function tlsRequiredNodes(nodes: readonly ProxyNode[], isFragment: boolean): ProxyNode[] {
  return visibleNodes(nodes, isFragment).filter(
    (n) => !((n.kind === "vless" || n.kind === "trojan") && n.security === "none"),
  );
}

export type NodeEmitter = (nodes: readonly ProxyNode[], opts: EmitOptions) => string;

export type SyncSubFormat = Exclude<SubFormat, "base64">;

export const EMITTERS: Record<SyncSubFormat, NodeEmitter> = {
  clash: emitClashYaml,
  singbox: emitSingBoxJson,
  surge: emitSurgeConf,
  loon: emitLoonConf,
};
