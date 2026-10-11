import type { SubFormat } from "../core/ua";
import { classifyUA } from "../core/ua";
import { BadRequestError } from "../core/errors";

export const SUB_FORMATS: readonly SubFormat[] = ["base64", "singbox", "clash", "xray", "surge", "quanx", "loon"];

// Bare `?flag` shorthands, checked after `?b64`/`?base64` and before UA sniffing.
// Order mirrors edgetunnel: clash > sing-box > surge > quanx > loon (xray last, qproxy addition).
const FLAG_TARGETS: ReadonlyArray<readonly [string, SubFormat]> = [
  ["clash", "clash"],
  ["sb", "singbox"],
  ["singbox", "singbox"],
  ["surge", "surge"],
  ["quanx", "quanx"],
  ["loon", "loon"],
  ["xray", "xray"],
];

export function pickSubFormat(req: Request, pathTarget?: string): SubFormat | null {
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "html") return null;
  if (url.searchParams.has("target")) {
    const target = url.searchParams.get("target")!;
    // `mixed` is the historical base64 list response under a converter-era name.
    if (target === "mixed") return "base64";
    if ((SUB_FORMATS as readonly string[]).includes(target)) return target as SubFormat;
    throw new BadRequestError("invalid target");
  }
  if (url.searchParams.has("b64") || url.searchParams.has("base64")) return "base64";
  for (const [flag, format] of FLAG_TARGETS) {
    if (url.searchParams.has(flag)) return format;
  }
  if (pathTarget !== undefined && (SUB_FORMATS as readonly string[]).includes(pathTarget)) {
    return pathTarget as SubFormat;
  }
  const detected = classifyUA(req.headers.get("user-agent") ?? "");
  return detected === "browser" ? null : detected;
}
