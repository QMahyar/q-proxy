import type { Settings } from "../../types/settings";
import { isLocalOrPrivateTarget } from "../../utils/net";
import { ECH_SERVER_NAME_RE } from "../../nodes/ech";
import { isPlainObject } from "../migrate";
import { KNOWN_ALPN, fail, isHttpUrl, sanitizeStrArray, strField } from "./shared";

// Transport-security domain: ECH, ALPN, upstream URLs, fragment ordering.
export function applyTransportCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  switch (path) {
    case "echServerName": {
      const v = strField(patch, "echServerName", fields, { maxLen: 253 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length > 0 && !ECH_SERVER_NAME_RE.test(trimmed)) fail(fields, "echServerName", "must be a domain name");
        else out.echServerName = trimmed;
      }
      return true;
    }
    case "alpn": {
      const alpnV = patch["alpn"];
      if (alpnV !== undefined) {
        if (!Array.isArray(alpnV)) fail(fields, "alpn", "must be an array of strings");
        else {
          const { values: cleaned, truncated } = sanitizeStrArray(alpnV, { maxItems: 8, itemMaxLen: 32, lowerCase: true });
          if (truncated) fail(fields, "alpn", "too many entries (max 8)");
          else {
            const bad = cleaned.find((t) => !KNOWN_ALPN.includes(t));
            if (bad !== undefined) fail(fields, "alpn", `"${bad}" is not a supported ALPN token`);
            else out.alpn = cleaned;
          }
        }
      }
      return true;
    }
    case "proxyIpPoolUrl": {
      const v = strField(patch, "proxyIpPoolUrl", fields, { maxLen: 2048 });
      if (v !== undefined) {
        const trimmed = v.trim();
        if (trimmed.length === 0) out.proxyIpPoolUrl = "";
        else if (!isHttpUrl(trimmed)) fail(fields, "proxyIpPoolUrl", "must be a valid http(s) URL");
        else if (isLocalOrPrivateTarget(new URL(trimmed).hostname)) fail(fields, "proxyIpPoolUrl", "must not target a local or private address");
        else out.proxyIpPoolUrl = trimmed;
      }
      return true;
    }
    case "dohUpstream": {
      const v = strField(patch, "dohUpstream", fields, { maxLen: 253 });
      if (v !== undefined) {
        if (!isHttpUrl(v)) fail(fields, "dohUpstream", "must be a valid http(s) URL");
        else if (isLocalOrPrivateTarget(new URL(v).hostname)) fail(fields, "dohUpstream", "must not target a local or private address");
        else out.dohUpstream = v;
      }
      return true;
    }
    default:
      return false;
  }
}

export function validateFragmentOrdering(
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): void {
  if (!isPlainObject(patch.fragment)) return;
  const f: Record<string, string> = {};
  if (out.fragment.lengthMin > out.fragment.lengthMax)
    fail(f, "lengthMin", "lengthMin must be <= lengthMax");
  if (out.fragment.delayMin > out.fragment.delayMax)
    fail(f, "delayMin", "delayMin must be <= delayMax");
  if (out.fragment.maxSplitMin > out.fragment.maxSplitMax)
    fail(f, "maxSplitMin", "maxSplitMin must be <= maxSplitMax");
  for (const [subKey, msg] of Object.entries(f)) {
    fail(fields, `fragment.${subKey}`, msg);
  }
}
