import type { SubFormat } from "../core/ua";
import { classifyUA } from "../core/ua";

const FORMATS: readonly SubFormat[] = ["base64", "clash", "singbox", "surge", "loon"];

export function pickSubFormat(req: Request): SubFormat | null {
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "html") return null;
  const target = url.searchParams.get("target");
  if (target !== null && (FORMATS as readonly string[]).includes(target)) {
    return target as SubFormat;
  }
  const detected = classifyUA(req.headers.get("user-agent") ?? "");
  return detected === "browser" ? null : detected;
}
