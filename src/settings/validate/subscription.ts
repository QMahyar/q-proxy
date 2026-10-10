import type { Settings } from "../../types/settings";
import { isLocalOrPrivateTarget } from "../../utils/net";
import { fail, isHttpUrl, strField } from "./shared";

export const SUB_NAME_RE = /^[A-Za-z0-9 _.\-]{1,64}$/;

// Subscription domain: download filename base, converter backend wiring.
export function applySubscriptionCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  switch (path) {
    case "subName": {
      const v = strField(patch, "subName", fields, { maxLen: 64 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length > 0 && !SUB_NAME_RE.test(trimmed)) {
          fail(fields, "subName", "may only contain letters, digits, spaces and _.- (max 64)");
        } else out.subName = trimmed;
      }
      return true;
    }
    case "subConverter.api": {
      const v = strField(patch, "api", fields, { maxLen: 2048 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length === 0) out.subConverter.api = "";
        else if (!isHttpUrl(trimmed)) fail(fields, "api", "must be a valid http(s) URL");
        else if (isLocalOrPrivateTarget(new URL(trimmed).hostname)) {
          fail(fields, "api", "must not target a local or private address");
        } else out.subConverter.api = trimmed;
      }
      return true;
    }
    case "subConverter.config": {
      const v = strField(patch, "config", fields, { maxLen: 2048 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length === 0) out.subConverter.config = "";
        else if (!isHttpUrl(trimmed)) fail(fields, "config", "must be a valid http(s) URL");
        else out.subConverter.config = trimmed;
      }
      return true;
    }
    default:
      return false;
  }
}
