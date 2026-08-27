import type { SubFormat } from "../core/ua";
import { classifyUA } from "../core/ua";

export const SUB_FORMATS: readonly SubFormat[] = ["base64", "clash", "singbox", "surge", "loon"];

export function pickSubFormat(req: Request, pathTarget?: string): SubFormat | null {
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "html") return null;
  const target = url.searchParams.get("target");
  if (target !== null && (SUB_FORMATS as readonly string[]).includes(target)) {
    return target as SubFormat;
  }
  if (pathTarget !== undefined && (SUB_FORMATS as readonly string[]).includes(pathTarget)) {
    return pathTarget as SubFormat;
  }
  const detected = classifyUA(req.headers.get("user-agent") ?? "");
  return detected === "browser" ? null : detected;
}
