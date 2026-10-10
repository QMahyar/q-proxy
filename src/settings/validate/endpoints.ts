import type { Settings } from "../../types/settings";
import { HOSTNAME_RE } from "../../utils/net";
import { CF_TLS_PORT_SET, endpointLinesField, fail, intField, presetIdListField, strField } from "./shared";

// Endpoint domain: CDN/WARP presets, custom endpoint lines, CDN hostnames, default port.
export function applyEndpointsCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  switch (path) {
    case "cdnPresets":
      presetIdListField(patch, out, "cdnPresets", fields, 64);
      return true;
    case "customEndpoints":
      endpointLinesField(patch, out, "customEndpoints", fields, 64, true);
      return true;
    case "cdnHost":
    case "cdnSni": {
      const v = strField(patch, path, fields, { maxLen: 253 });
      if (v !== undefined) {
        const trimmed = v.trim().toLowerCase();
        if (trimmed.length > 0 && !HOSTNAME_RE.test(trimmed)) fail(fields, path, "must be a domain name");
        else (out as unknown as Record<string, unknown>)[path] = trimmed;
      }
      return true;
    }
    case "warpPresets":
      presetIdListField(patch, out, "warpPresets", fields, 64);
      return true;
    case "warpCustomEndpoints":
      endpointLinesField(patch, out, "warpCustomEndpoints", fields, 64, false);
      return true;
    case "defaultPort": {
      const v = intField(patch, "defaultPort", fields, 1, 65535);
      if (v !== undefined) {
        if (!CF_TLS_PORT_SET.has(v)) fail(fields, "defaultPort", "must be a Cloudflare-proxied TLS port");
        else out.defaultPort = v;
      }
      return true;
    }
    default:
      return false;
  }
}
