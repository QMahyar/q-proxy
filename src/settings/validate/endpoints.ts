import type { Settings } from "../../types/settings";
import { HOSTNAME_RE, isIpLiteral } from "../../utils/net";
import { parsePreferredLine } from "../../nodes/preferred";
import { CF_PORT_SET, CF_TLS_PORT_SET, endpointLinesField, fail, intField, presetIdListField, strField } from "./shared";

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
      preferredLinesField(patch, out, fields);
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
    case "preferredPort": {
      // -1 = random Cloudflare TLS port, else an explicit 1–65535 (0 is meaningless).
      const v = intField(patch, "preferredPort", fields, -1, 65535);
      if (v !== undefined) {
        if (v === 0) fail(fields, "preferredPort", "must be -1 or between 1 and 65535");
        else out.preferredPort = v;
      }
      return true;
    }
    case "preferredRemoteUrl": {
      const v = strField(patch, "preferredRemoteUrl", fields, { maxLen: 253 });
      if (v !== undefined) {
        const trimmed = v.trim().toLowerCase();
        if (trimmed.length === 0) out.preferredRemoteUrl = "";
        else if (!isIpLiteral(trimmed) && !HOSTNAME_RE.test(trimmed)) {
          fail(fields, "preferredRemoteUrl", "must be a hostname or IP address");
        } else out.preferredRemoteUrl = trimmed;
      }
      return true;
    }
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

// B2 preferred-list lines: additive over `host[:port]` — remarks,
// sub://, https:// remote lists, `*` wildcards, `$proto://` chains, and
// ?proxyip=true. Explicit ports still must be Cloudflare-proxied.
function preferredLinesField(
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): void {
  const key = "customEndpoints";
  const v = patch[key];
  if (v === undefined) return;
  if (!Array.isArray(v)) {
    fail(fields, key, "must be an array of endpoint lines");
    return;
  }
  const result: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const raw = v[i];
    if (typeof raw !== "string") {
      fail(fields, key, `line ${i + 1} must be a string`);
      return;
    }
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.length > 253) {
      fail(fields, key, `line ${i + 1} "${line.slice(0, 64)}" is too long`);
      return;
    }
    const parsed = parsePreferredLine(line);
    if (!parsed.ok) {
      fail(fields, key, `line ${i + 1} "${line.slice(0, 64)}" ${parsed.reason}`);
      return;
    }
    const entry = parsed.value;
    if (entry.port !== null && entry.port > 0 && !CF_PORT_SET.has(entry.port)) {
      fail(fields, key, `line ${i + 1} "${line.slice(0, 64)}" port ${entry.port} is not a Cloudflare-proxied port`);
      return;
    }
    result.push(line);
    if (result.length > 64) {
      fail(fields, key, "too many entries (max 64)");
      return;
    }
  }
  out.customEndpoints = result;
}
