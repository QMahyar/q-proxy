import type { SubFormat } from "../core/ua";
import { classifyUA } from "../core/ua";
import { BadRequestError } from "../core/errors";

export const SUB_FORMATS: readonly SubFormat[] = ["base64", "clash", "singbox", "surge", "loon", "quantumult"];

export function pickSubFormat(req: Request, pathTarget?: string): SubFormat | null {
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "html") return null;
  if (url.searchParams.has("target")) {
    const target = url.searchParams.get("target")!;
    if ((SUB_FORMATS as readonly string[]).includes(target)) return target as SubFormat;
    throw new BadRequestError("invalid target");
  }
  if (pathTarget !== undefined && (SUB_FORMATS as readonly string[]).includes(pathTarget)) {
    return pathTarget as SubFormat;
  }
  const detected = classifyUA(req.headers.get("user-agent") ?? "");
  return detected === "browser" ? null : detected;
}
