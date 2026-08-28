import type { SubFormat } from "../../core/ua";
import type { ProxyNode } from "../../types/node";
import { emitBase64List } from "./base64-list";
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

export function visibleNodes(nodes: readonly ProxyNode[], isFragment: boolean): ProxyNode[] {
  return nodes.filter((n) => isFragment || n.variant !== "fragment");
}

export type NodeEmitter = (nodes: readonly ProxyNode[], opts: EmitOptions) => string;

export const EMITTERS: Record<SubFormat, NodeEmitter> = {
  base64: emitBase64List,
  clash: emitClashYaml,
  singbox: emitSingBoxJson,
  surge: emitSurgeConf,
  loon: emitLoonConf,
};
