import type { SubFormat } from "../core/ua";
import type { EmitOptions } from "../nodes/emitters/registry";
import { tlsRequiredNodes } from "../nodes/emitters/registry";
import type { NodeVariant, ProxyNode } from "../types/node";
import type { Settings } from "../types/settings";
import { encodeUtf8Base64 } from "../utils/base64";
import { buildShareUris } from "../nodes/share-uri";
import { EMITTERS } from "../nodes/emitters/registry";
import { fetchRemoteSubLines } from "./merge";

export const SUB_CONTENT_TYPES: Record<SubFormat, string> = {
  base64: "text/plain; charset=utf-8",
  clash: "text/yaml; charset=utf-8",
  singbox: "application/json; charset=utf-8",
  surge: "text/plain; charset=utf-8",
  loon: "text/plain; charset=utf-8",
};

export interface RenderSubInput {
  settings: Settings;
  nodes: readonly ProxyNode[];
  format: SubFormat;
  isFragmentMode: boolean;
  subscriptionUrl: string;
}

export function selectVariantNodes(
  allNodes: readonly ProxyNode[],
  variant: NodeVariant,
): ProxyNode[] {
  const filtered = allNodes.filter((n) => n.variant === variant);
  return variant === "fragment" && filtered.length === 0 ? [...allNodes] : filtered;
}

export function emitterOptions(input: RenderSubInput): EmitOptions {
  const s = input.settings;
  return {
    remoteDns: s.remoteDns,
    urlTestIntervalSec: s.urlTestIntervalSec,
    isFragment: input.isFragmentMode,
    subscriptionUrl: input.subscriptionUrl,
    updateIntervalHours: s.subUpdateIntervalHours,
    rules: {
      bypassLan: s.routingRules.bypassLan,
      bypassDomains: [...s.routingRules.customBypass],
      blockDomains: [...s.routingRules.customBlock],
      blockQuic: s.routingRules.blockQuic,
    },
  };
}

export async function renderSubscriptionBody(input: RenderSubInput): Promise<string> {
  const opts = emitterOptions(input);
  if (input.format === "base64") {
    const visible = base64VisibleNodes(input.nodes, input.isFragmentMode);
    const [ownLines, remoteLines] = await Promise.all([
      Promise.resolve(buildShareUris(visible)),
      fetchRemoteSubLines(input.settings.remoteSubUrls, input.settings.subUpdateIntervalHours * 3600),
    ]);
    return encodeUtf8Base64([...ownLines, ...remoteLines].join("\n"));
  }
  return EMITTERS[input.format](input.nodes, opts);
}

function base64VisibleNodes(nodes: readonly ProxyNode[], isFragmentMode: boolean): ProxyNode[] {
  const visible = tlsRequiredNodes(nodes, isFragmentMode);
  const nonSs = visible.filter((n) => n.kind !== "ss");
  return nonSs.length > 0 || visible.length === 0 ? nonSs : visible;
}

export function makeEdgeCacheKey(req: Request, format: SubFormat, isFragmentMode: boolean, token?: string): Request {
  const keyUrl = new URL(req.url);
  keyUrl.searchParams.set("_k", `${format}:${isFragmentMode ? "f" : "n"}${token === undefined ? "" : `:${token}`}`);
  return new Request(keyUrl.toString(), { method: "GET" });
}

export async function matchEdgeCache(cacheKey: Request): Promise<Response | undefined> {
  if (typeof caches === "undefined") return undefined;
  return caches.default.match(cacheKey);
}
