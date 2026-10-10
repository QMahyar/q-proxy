import type { SubFormat } from "../core/ua";
import { ServiceUnavailableError, UpstreamError } from "../core/errors";
import { log } from "../core/log";
import type { EmitOptions } from "../nodes/emitters/registry";
import { tlsRequiredNodes } from "../nodes/emitters/registry";
import type { NodeVariant, ProxyNode } from "../types/node";
import type { Settings } from "../types/settings";
import { encodeUtf8Base64 } from "../utils/base64";
import { buildShareUris } from "../nodes/share-uri";
import { EMITTERS } from "../nodes/emitters/registry";
import {
  buildConverterUrl,
  converterOptionsOf,
  fetchConvertedText,
  isConverterTarget,
  patchSurgeConfig,
} from "./converter";

export const SUB_CONTENT_TYPES: Record<SubFormat, string> = {
  base64: "text/plain; charset=utf-8",
  singbox: "application/json; charset=utf-8",
  clash: "text/yaml; charset=utf-8",
  xray: "application/json; charset=utf-8",
  surge: "text/plain; charset=utf-8",
  quanx: "text/plain; charset=utf-8",
  loon: "text/plain; charset=utf-8",
};

export interface RenderSubInput {
  settings: Settings;
  nodes: readonly ProxyNode[];
  format: SubFormat;
  isFragmentMode: boolean;
  subscriptionUrl: string;
  mixedUrl?: string;
  fetchFn?: typeof fetch;
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
    return encodeUtf8Base64(buildShareUris(visible).join("\n"));
  }
  if (isConverterTarget(input.format)) {
    return renderConverterBody(input);
  }
  return EMITTERS[input.format](input.nodes, opts);
}

async function renderConverterBody(input: RenderSubInput): Promise<string> {
  if (!isConverterTarget(input.format)) throw new ServiceUnavailableError("unknown subscription target");
  const built = buildConverterUrl(
    converterOptionsOf(input.settings),
    input.mixedUrl ?? input.subscriptionUrl,
    input.format,
  );
  if (!built.ok) throw new ServiceUnavailableError(built.reason);
  const fetched = await fetchConvertedText(built.value, input.fetchFn);
  if (!fetched.ok) {
    // Never log the converter URL: the wrapped mixed URL carries securePath.
    log.error("subscription/converter", `converter fetch failed (${fetched.reason})`);
    throw new UpstreamError("subscription converter unreachable");
  }
  if (input.format === "surge") {
    return patchSurgeConfig(fetched.value, input.subscriptionUrl, input.settings.subUpdateIntervalHours);
  }
  return fetched.value;
}

function base64VisibleNodes(nodes: readonly ProxyNode[], isFragmentMode: boolean): ProxyNode[] {
  return tlsRequiredNodes(nodes, isFragmentMode);
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
