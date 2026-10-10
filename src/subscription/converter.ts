import type { SubFormat } from "../core/ua";
import type { Settings } from "../types/settings";

// Narrow converter view of Settings: the builder never receives secrets,
// so a built converter URL cannot leak them by construction.
export interface SubConverterOptions {
  api: string;
  config: string;
  emoji: boolean;
  list: boolean;
  udp: boolean;
  xudp: boolean;
  tls13: boolean;
  appendType: boolean;
  sort: boolean;
  expand: boolean;
  skipCertVerify: boolean;
}

export type ConverterTarget = "surge" | "quanx" | "loon";

export function isConverterTarget(format: SubFormat): format is ConverterTarget {
  return format === "surge" || format === "quanx" || format === "loon";
}

export function converterOptionsOf(s: Settings): SubConverterOptions {
  return {
    api: s.subConverter.api,
    config: s.subConverter.config,
    emoji: s.subConverter.emoji,
    list: s.subConverter.list,
    udp: s.subConverter.udp,
    xudp: s.subConverter.xudp,
    tls13: s.subConverter.tls13,
    appendType: s.subConverter.appendType,
    sort: s.subConverter.sort,
    expand: s.subConverter.expand,
    skipCertVerify: s.skipCertVerify,
  };
}

export const CONVERTER_TIMEOUT_MS = 8000;
export const CONVERTER_MAX_BYTES = 2 * 1024 * 1024;

function boolParam(value: boolean): string {
  return value ? "true" : "false";
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// subconverter request shape mirrors edgetunnel: /sub?target=…&url=<mixed sub>&config=…&emoji=…&…
// Surge pins the ver=4 flavor (`target=surge&ver=4`). Never throws.
export function buildConverterUrl(
  opts: SubConverterOptions,
  mixedUrl: string,
  target: ConverterTarget,
): { ok: true; value: string } | { ok: false; reason: string } {
  const api = opts.api.trim().replace(/\/+$/, "");
  if (api.length === 0) return { ok: false, reason: "subscription converter is not configured" };
  if (!isHttpUrl(api)) return { ok: false, reason: "subscription converter api must be an http(s) URL" };
  const targetParam = target === "surge" ? "surge&ver=4" : target;
  const params = new URLSearchParams({
    target: targetParam,
    url: mixedUrl,
    config: opts.config,
    emoji: boolParam(opts.emoji),
    list: boolParam(opts.list),
    scv: boolParam(opts.skipCertVerify),
    udp: boolParam(opts.udp),
    xudp: boolParam(opts.xudp),
    tls13: boolParam(opts.tls13),
    append_type: boolParam(opts.appendType),
    sort: boolParam(opts.sort),
    expand: boolParam(opts.expand),
  });
  // URLSearchParams encodes `surge&ver=4` as `surge%26ver%3D4`; edgetunnel sends
  // ver=4 as a sibling param, so restore the literal flavor marker.
  const query = params.toString().replace("target=surge%26ver%3D4", "target=surge&ver=4");
  return { ok: true, value: `${api}/sub?${query}` };
}

// Surge hot-patch mirrors edgetunnel's Surge订阅配置文件热补丁: replace the
// first line with a #!MANAGED-CONFIG pointer carrying the update interval.
export function patchSurgeConfig(content: string, managedUrl: string, updateIntervalHours: number): string {
  const hours = Number.isFinite(updateIntervalHours) ? Math.min(168, Math.max(1, Math.floor(updateIntervalHours))) : 12;
  const rest = content.includes("\n") ? content.slice(content.indexOf("\n") + 1) : "";
  const head = `#!MANAGED-CONFIG ${managedUrl} interval=${hours * 3600} strict=false`;
  return rest.length > 0 ? `${head}\n${rest}` : `${head}\n`;
}

export interface FetchConvertedOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

// Bounded subconverter fetch: timeout + byte cap, never throws.
export async function fetchConvertedText(
  converterUrl: string,
  fetchFn: typeof fetch = fetch,
  opts: FetchConvertedOptions = {},
): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  const maxBytes = opts.maxBytes ?? CONVERTER_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? CONVERTER_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetchFn(converterUrl, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, reason: "subscription converter request failed" };
  }
  if (!res.ok) return { ok: false, reason: `subscription converter upstream ${res.status}` };
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared.trim());
    if (Number.isInteger(n) && n > maxBytes) return { ok: false, reason: "subscription converter response too large" };
  }
  try {
    const reader = res.body?.getReader() ?? null;
    if (reader === null) {
      const text = await res.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        return { ok: false, reason: "subscription converter response too large" };
      }
      return { ok: true, value: text };
    }
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, reason: "subscription converter response too large" };
      }
      out += decoder.decode(value, { stream: true });
    }
    return { ok: true, value: out + decoder.decode() };
  } catch {
    return { ok: false, reason: "subscription converter response unreadable" };
  }
}
