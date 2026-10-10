import type { WarpAddresses, WarpEndpoint } from "../../types/warp";
import { isIPv6, stripBrackets } from "../../utils/net";
import { parseBoundedInt, parseDecimalInt } from "../../utils/numbers";

/**
 * Comma-separated address list (WG .conf Address lines, JSON values).
 * Comma is the only separator here: IP literals never contain one.
 */
export function splitCommaList(value: string): string[] {
  return value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * wg:// local_address list: commas plus the throne-style "-" join between the
 * v4 and v6 halves (e.g. "10.2.0.2-2606:4700:110:8d4a::", which our own wg
 * formatter also emits, so parse stays round-trip safe). A "-" is only
 * treated as a separator inside a colon-bearing piece — IP literals never
 * contain "-", so a dash there cannot be part of the address, while a dash
 * in a colon-free piece is left intact and fails validation whole instead of
 * being shredded into fragments by a blind split(/[,\-]/).
 */
export function splitWgAddressList(value: string): string[] {
  const out: string[] = [];
  for (const piece of splitCommaList(value)) {
    if (piece.includes(":") && piece.includes("-")) {
      for (const sub of piece.split("-")) {
        const trimmed = sub.trim();
        if (trimmed.length > 0) out.push(trimmed);
      }
    } else {
      out.push(piece);
    }
  }
  return out;
}

export function isValidIpv4Part(part: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(part.trim());
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const octet = parseDecimalInt(m[i] ?? "");
    if (octet === null || octet > 255) return false;
  }
  if (m[5] !== undefined && parseBoundedInt(m[5], 0, 32) === null) return false;
  return true;
}

export function isValidIpv6Part(part: string): boolean {
  let p = part.trim();
  const slash = p.indexOf("/");
  if (slash >= 0) {
    if (parseBoundedInt(p.slice(slash + 1), 0, 128) === null) return false;
    p = p.slice(0, slash);
  }
  if (p === "") return false;
  const double = p.split("::");
  if (double.length > 2) return false;
  const left = double[0] ?? "";
  const right = double[1] ?? "";
  const groups = (double.length === 2 ? left.split(":").concat(right.split(":")) : p.split(":")).filter(
    (g) => g.length > 0,
  );
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  if (double.length === 1 && groups.length !== 8) return false;
  if (double.length === 2 && groups.length > 7) return false;
  return true;
}

export function isValidAddressValue(value: string): boolean {
  const parts = splitCommaList(value);
  if (parts.length === 0) return false;
  for (const part of parts) {
    if (part.includes(":")) {
      if (!isValidIpv6Part(part)) return false;
    } else if (!isValidIpv4Part(part)) {
      return false;
    }
  }
  return true;
}

export function splitAddresses(value: string): WarpAddresses | null {
  const parts = splitCommaList(value);
  let ipv4: string | null = null;
  let ipv6: string | null = null;
  for (const part of parts) {
    if (part.includes(":")) {
      if (ipv6 === null) ipv6 = part;
    } else if (ipv4 === null) {
      ipv4 = part;
    }
  }
  if (ipv4 === null && ipv6 === null) return null;
  return { ipv4: ipv4 ?? "", ipv6: ipv6 ?? "" };
}

export function parseEndpointHostPort(value: string): WarpEndpoint | null {
  let host = value.trim();
  let portStr = "";
  const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(host);
  if (bracket) {
    const hostPart = bracket[1];
    const portPart = bracket[2];
    if (hostPart === undefined || portPart === undefined) return null;
    host = hostPart;
    portStr = portPart;
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0 && host.indexOf(":") === colon) {
      portStr = host.slice(colon + 1);
      host = host.slice(0, colon);
    }
  }
  const port = parseBoundedInt(portStr, 1, 65535);
  if (port === null) return null;
  host = stripBrackets(host);
  if (host.includes(":")) {
    if (!isIPv6(host) || host.startsWith("-") || host.endsWith("-")) return null;
    return { ip: host, port };
  }
  if (!/^[A-Za-z0-9.-]+$/.test(host) || host.length === 0 || host.startsWith("-") || host.endsWith("-")) return null;
  if (host.includes(".")) {
    const labels = host.split(".");
    if (labels.some((l) => l.length === 0 || l.length > 63)) return null;
  }
  return { ip: host, port };
}

export function dedupeEndpoints(list: WarpEndpoint[]): WarpEndpoint[] {
  const seen = new Set<string>();
  const out: WarpEndpoint[] = [];
  for (const e of list) {
    const key = `${e.ip.toLowerCase()}:${e.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
