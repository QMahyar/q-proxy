import type { SubFormat } from "../core/ua";
import type { ProxyNode } from "../types/node";
import type { UsageSnapshot } from "../types/context";
import { encodeUtf8Base64 } from "../utils/base64";

export interface SubscriptionMeta {
  updateIntervalHours: number;
  webPageUrl: string;
  expireAt?: number | null;
}

export const BYTES_PER_REQUEST = 1024 * 1024;

export interface UserinfoBytes {
  bytesUpTotal?: number;
  bytesDownTotal?: number;
}

export function subscriptionUserinfo(
  usage: Pick<UsageSnapshot, "requestsTotal"> & UserinfoBytes,
  expireAt?: number | null,
): string {
  const up = usage.bytesUpTotal ?? 0;
  const down = usage.bytesDownTotal ?? 0;
  let userinfo = `upload=${up > 0 ? up : 0}; download=${down > 0 ? down : usage.requestsTotal * BYTES_PER_REQUEST}`;
  if (expireAt !== null && expireAt !== undefined && expireAt > 0) {
    userinfo += `; expire=${Math.floor(expireAt / 1000)}`;
  }
  return userinfo;
}

const EXTENSIONS: Record<SubFormat, string> = {
  base64: "txt",
  clash: "yaml",
  singbox: "json",
  surge: "conf",
  loon: "conf",
};

export const SUB_THROTTLE_SECONDS = 60;

function filenameFor(format: SubFormat, title: string): string {
  const ext = EXTENSIONS[format];
  const enc = encodeURIComponent(title).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${enc}.${ext}`;
}

export function throttleHeaders(now: number = Date.now()): Record<string, string> {
  return {
    "Cache-Control": `public, max-age=${SUB_THROTTLE_SECONDS}, s-maxage=${SUB_THROTTLE_SECONDS}`,
    Expires: new Date(now + SUB_THROTTLE_SECONDS * 1000).toUTCString(),
    "Profile-Update-Interval": "60",
  };
}

export function subscriptionHeaders(
  format: SubFormat,
  title: string,
  nodes: readonly ProxyNode[],
  usage: UsageSnapshot & UserinfoBytes,
  meta: SubscriptionMeta,
): Record<string, string> {
  void nodes;
  const userinfo = subscriptionUserinfo(usage, meta.expireAt);
  const h: Record<string, string> = {
    "Profile-Title": `base64:${encodeUtf8Base64(title)}`,
    "Subscription-Userinfo": userinfo,
    "Content-Disposition": `attachment; filename*=UTF-8''${filenameFor(format, title)}`,
    ...throttleHeaders(),
  };
  if (meta.webPageUrl.length > 0) h["profile-web-page-url"] = meta.webPageUrl;
  return h;
}
