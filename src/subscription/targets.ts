import type { SubFormat } from "../core/ua";
import { isConverterTarget } from "./converter";
import { pickSubFormat } from "./negotiate";

export interface ResolvedTarget {
  target: SubFormat | null;
  isConverter: boolean;
}

// Shared /sub target resolution: explicit ?target= > ?b64/flags > UA tokens.
// `target` is null for browser info pages.
export function resolveTarget(url: URL, userAgent: string): ResolvedTarget {
  const headers = new Headers();
  if (userAgent.length > 0) headers.set("user-agent", userAgent);
  const target = pickSubFormat(new Request(url.toString(), { headers }));
  return { target, isConverter: target !== null && isConverterTarget(target) };
}

const CN_ISP_CODE_RE = /^[A-Za-z0-9_-]{1,16}$/;

// `cnIspCode` is an opaque passthrough: accepted on /sub, forwarded into the
// wrapped mixed URL for the converter. Never throws; null means absent.
export function readCnIspCode(url: URL): string | null {
  let raw: string | null = null;
  try {
    raw = url.searchParams.get("cnIspCode");
  } catch {
    return null;
  }
  if (raw === null || !CN_ISP_CODE_RE.test(raw)) return null;
  return raw;
}
