import type { Settings } from "../../types/settings";
import { isLocalOrPrivateTarget } from "../../utils/net";
import { fail, isHttpUrl, strField } from "./shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cloudflare domain: account email, usage API override. Keys are opaque
// strings handled by generic specs; the URL is server-fetched, so local
// targets are rejected (SSRF guard, mirrors subConverter.api).
export function applyCfCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  switch (path) {
    case "cf.email": {
      const v = strField(patch, "email", fields, { maxLen: 254 });
      if (v !== undefined) {
        const trimmed = v.trim().toLowerCase();
        if (trimmed.length === 0) out.cf.email = "";
        else if (!EMAIL_RE.test(trimmed)) fail(fields, "email", "must be a valid email address");
        else out.cf.email = trimmed;
      }
      return true;
    }
    case "cf.usageApiUrl": {
      const v = strField(patch, "usageApiUrl", fields, { maxLen: 2048 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length === 0) out.cf.usageApiUrl = "";
        else if (!isHttpUrl(trimmed)) fail(fields, "usageApiUrl", "must be a valid http(s) URL");
        else if (isLocalOrPrivateTarget(new URL(trimmed).hostname)) {
          fail(fields, "usageApiUrl", "must not target a local or private address");
        } else out.cf.usageApiUrl = trimmed;
      }
      return true;
    }
    default:
      return false;
  }
}
