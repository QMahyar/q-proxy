import type { Settings } from "../../types/settings";
import { normalizeToken, parseHostPort, isLocalOrPrivateTarget } from "../../utils/net";
import { ALLOWLIST_MAX_ITEMS, fail, isAllowlistEntry } from "./shared";

// Access-control domain: admin IP allowlist + proxy-IP SSRF guard.
export function applyAccessCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  if (path !== "allowedIps") return false;
  const allowV = patch["allowedIps"];
  if (allowV === undefined) return true;
  if (!Array.isArray(allowV)) {
    fail(fields, "allowedIps", "must be an array of strings");
    return true;
  }
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of allowV) {
    if (typeof raw !== "string") {
      fail(fields, "allowedIps", "entries must be strings");
      return true;
    }
    const item = raw.trim();
    if (item.length === 0) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    if (!isAllowlistEntry(item)) {
      fail(fields, "allowedIps", `"${item}" is not a valid IP or CIDR`);
      return true;
    }
    seen.add(key);
    cleaned.push(item);
    if (cleaned.length > ALLOWLIST_MAX_ITEMS) {
      fail(fields, "allowedIps", `too many entries (max ${ALLOWLIST_MAX_ITEMS})`);
      return true;
    }
  }
  out.allowedIps = cleaned;
  return true;
}

export function validateProxyIps(out: Settings, fields: Record<string, string>): void {
  for (const entry of out.proxyIps) {
    const token = normalizeToken(entry);
    if (token.length === 0) continue;
    const bareToken = token.replace(/\.tp\d{1,5}$/, "");
    const hp = parseHostPort(bareToken, 443);
    if (hp !== null && isLocalOrPrivateTarget(hp.host)) {
      fail(fields, "proxyIps", "must not target a local or private address");
      return;
    }
  }
}
