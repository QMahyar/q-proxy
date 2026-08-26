import type { SubFormat } from "../core/ua";
import type { ProxyNode } from "../types/node";
import type { UsageSnapshot } from "../types/context";
import { encodeUtf8Base64 } from "../utils/base64";

export interface SubscriptionMeta {
  updateIntervalHours: number;
  webPageUrl: string;
}

const BYTES_PER_REQUEST = 1024 * 1024;

const EXTENSIONS: Record<SubFormat, string> = {
  base64: "txt",
  clash: "yaml",
  singbox: "json",
  surge: "conf",
  loon: "conf",
};

function filenameFor(format: SubFormat, title: string): string {
  const ext = EXTENSIONS[format];
  return `${encodeURIComponent(title)}.${ext}`;
}

export function subscriptionHeaders(
  format: SubFormat,
  title: string,
  nodes: readonly ProxyNode[],
  usage: UsageSnapshot,
  meta: SubscriptionMeta,
): Record<string, string> {
  void nodes;
  const h: Record<string, string> = {
    "Profile-Title": `base64:${encodeUtf8Base64(title)}`,
    "Subscription-Userinfo": `upload=0; download=${usage.requestsTotal * BYTES_PER_REQUEST}`,
    "Profile-Update-Interval": String(Math.max(1, Math.floor(meta.updateIntervalHours))),
    "Content-Disposition": `attachment; filename*=UTF-8''${filenameFor(format, title)}`,
    "Cache-Control": "public, max-age=60",
  };
  if (meta.webPageUrl.length > 0) h["profile-web-page-url"] = meta.webPageUrl;
  return h;
}
