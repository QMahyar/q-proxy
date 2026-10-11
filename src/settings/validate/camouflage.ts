import type { Settings } from "../../types/settings";
import { isLocalOrPrivateTarget } from "../../utils/net";
import { fail, isHttpUrl, strField } from "./shared";

// Camouflage domain: reverse mode requires an https:// origin (forced https
// like edgetunnel; plain http is rejected rather than silently upgraded at
// rest). Local/private targets are rejected (SSRF guard, mirrors
// subConverter.api).
export function applyCamouflageCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  if (path !== "camouflage.reverseUrl") return false;
  const nested = patch as Record<string, unknown>;
  const v = strField(nested, "reverseUrl", fields, { maxLen: 2048 });
  if (v !== undefined) {
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      out.camouflage.reverseUrl = "";
    } else {
      let ok = false;
      try {
        const url = new URL(trimmed);
        ok = url.protocol === "https:" && url.hostname.length > 0 && !isLocalOrPrivateTarget(url.hostname);
      } catch {
        ok = false;
      }
      if (!isHttpUrl(trimmed) || !ok) {
        fail(fields, "reverseUrl", "must be an https:// URL (http is not accepted)");
      } else out.camouflage.reverseUrl = trimmed;
    }
  }
  const mode = typeof nested.mode === "string" ? nested.mode : out.camouflage.mode;
  if (mode === "reverse" && out.camouflage.reverseUrl.trim().length === 0 && fields.reverseUrl === undefined) {
    fail(fields, "reverseUrl", "reverse mode requires an https:// URL");
  }
  return true;
}
