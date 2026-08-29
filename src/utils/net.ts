const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIPv4(s: string): boolean {
  return IPV4_RE.test(s);
}

function expandIpv6Groups(s: string): number[] | null {
  const bare = s.includes("%") ? s.slice(0, s.indexOf("%")) : s;
  const doubleColonCount = bare.split("::").length - 1;
  if (doubleColonCount > 1) return null;
  if ((bare.startsWith(":") && !bare.startsWith("::")) || (bare.endsWith(":") && !bare.endsWith("::"))) {
    return null;
  }
  let head = bare;
  let tail = "";
  const idx = bare.indexOf("::");
  if (idx !== -1) {
    head = bare.slice(0, idx);
    tail = bare.slice(idx + 2);
  }
  const parts = [...(head === "" ? [] : head.split(":")), ...(tail === "" ? [] : tail.split(":"))];
  if (parts.some((p) => p === "")) return null;
  const groups: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.includes(".")) {
      if (!isIPv4(part)) return null;
      const octets = part.split(".").map(Number);
      groups.push((octets[0]! << 8) | octets[1]!);
      groups.push((octets[2]! << 8) | octets[3]!);
      continue;
    }
    if (/^[0-9a-fA-F]{1,4}$/.test(part)) {
      groups.push(parseInt(part, 16));
    } else {
      return null;
    }
  }
  if (groups.length > 8) return null;
  if (doubleColonCount === 0 && groups.length !== 8) return null;
  if (doubleColonCount === 1) {
    const missing = 8 - groups.length;
    if (missing <= 0) return null;
    const headLen =
      head.split(":").filter((p) => p !== "").length -
      (head.split(":").some((p) => p.includes(".")) ? 1 : 0);
    const expanded = new Array<number>(8).fill(0);
    let gi = 0;
    for (let i = 0; i < headLen; i++) expanded[gi++] = groups[i]!;
    gi += missing;
    for (let i = headLen; i < groups.length; i++) expanded[gi++] = groups[i]!;
    return expanded;
  }
  return groups;
}

export function isIPv6(s: string): boolean {
  if (!s.includes(":")) return false;
  return expandIpv6Groups(s) !== null;
}

export function isIpLiteral(s: string): boolean {
  const unbracketed = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
  return isIPv4(unbracketed) || isIPv6(unbracketed);
}

export function bracketIpv6(host: string): string {
  if (host.startsWith("[")) return host;
  return isIPv6(host) ? `[${host}]` : host;
}

export interface HostPort {
  host: string;
  port: number;
}

export function parseHostPort(input: string, defaultPort = 80): HostPort | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    if (closeIdx === -1) return null;
    const host = trimmed.slice(1, closeIdx);
    if (!isIPv6(host)) return null;
    const rest = trimmed.slice(closeIdx + 1);
    if (rest === "") return { host, port: defaultPort };
    if (!rest.startsWith(":")) return null;
    const port = Number(rest.slice(1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }
  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 0) {
    if (trimmed.length === 0) return null;
    return { host: trimmed, port: defaultPort };
  }
  if (colonCount === 1) {
    const idx = trimmed.indexOf(":");
    const host = trimmed.slice(0, idx);
    const portStr = trimmed.slice(idx + 1);
    if (host.length === 0) return null;
    if (portStr === "") return { host, port: defaultPort };
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (isIPv4(host)) return { host, port };
    if (/^[0-9a-fA-F:]+$/.test(trimmed)) return { host: trimmed, port: defaultPort };
    return { host, port };
  }
  if (isIPv6(trimmed)) return { host: trimmed, port: defaultPort };
  return null;
}

function ipv4ToBigInt(ip: string): bigint | null {
  if (!isIPv4(ip)) return null;
  const octets = ip.split(".").map(Number);
  return (
    ((BigInt(octets[0]!) << 24n) |
      (BigInt(octets[1]!) << 16n) |
      (BigInt(octets[2]!) << 8n) |
      BigInt(octets[3]!))
  );
}

function ipv6ToBigInt(ip: string): bigint | null {
  const groups = expandIpv6Groups(ip);
  if (groups === null) return null;
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 16n) | BigInt(groups[i]!);
  return v;
}

function ipToBigInt(ip: string): { value: bigint; bits: number } | null {
  if (isIPv4(ip)) return { value: ipv4ToBigInt(ip)!, bits: 32 };
  const v6 = ipv6ToBigInt(ip);
  return v6 === null ? null : { value: v6, bits: 128 };
}

export function cidrContains(ip: string, cidr: string): boolean {
  const slashIdx = cidr.indexOf("/");
  if (slashIdx === -1) return false;
  const rangeIp = cidr.slice(0, slashIdx);
  const lenStr = cidr.slice(slashIdx + 1);
  const parsed = ipToBigInt(ip);
  const range = ipToBigInt(rangeIp);
  if (parsed === null || range === null || parsed.bits !== range.bits) return false;
  const prefixLen = Number(lenStr);
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > parsed.bits) return false;
  const shift = BigInt(parsed.bits - prefixLen);
  return parsed.value >> shift === range.value >> shift;
}

const CF_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const CF_IPV6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

type CfBound = { low: bigint; high: bigint };

function cfCidrToBound(cidr: string): CfBound {
  const slash = cidr.indexOf("/");
  const ipPart = cidr.slice(0, slash);
  const len = Number(cidr.slice(slash + 1));
  const parsed = ipToBigInt(ipPart)!;
  const shift = BigInt(parsed.bits - len);
  const low = (parsed.value >> shift) << shift;
  const high = shift === 0n ? low : low | ((1n << shift) - 1n);
  return { low, high };
}

let cfV4Bounds: CfBound[] | null = null;
let cfV6Bounds: CfBound[] | null = null;

function getCfV4Bounds(): CfBound[] {
  if (cfV4Bounds) return cfV4Bounds;
  cfV4Bounds = CF_IPV4_RANGES.map(cfCidrToBound);
  return cfV4Bounds;
}

function getCfV6Bounds(): CfBound[] {
  if (cfV6Bounds) return cfV6Bounds;
  cfV6Bounds = CF_IPV6_RANGES.map(cfCidrToBound);
  return cfV6Bounds;
}

export function isCloudflareIp(ip: string): boolean {
  const parsed = ipToBigInt(ip);
  if (parsed === null) return false;
  const bounds = parsed.bits === 32 ? getCfV4Bounds() : getCfV6Bounds();
  for (const b of bounds) {
    if (parsed.value >= b.low && parsed.value <= b.high) return true;
  }
  return false;
}

const PRIVATE_V4 = ["0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16"];
const PRIVATE_V6 = ["::1/128", "::/128", "fc00::/7", "fe80::/10"];

export function isLocalOrPrivateTarget(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (isIPv4(h)) return PRIVATE_V4.some((r) => cidrContains(h, r));
  if (h.includes(":") && isIPv6(h)) {
    const bare = h.replace(/%.*$/, "");
    return PRIVATE_V6.some((r) => cidrContains(bare, r));
  }
  return false;
}

export function normalizeCleanAddress(raw: string): string | null {
  const hp = parseHostPort(raw.trim(), 0);
  if (hp === null || hp.host.length === 0) return null;
  const host = hp.host.toLowerCase();
  const isAddr = isIPv4(host) || isIPv6(host);
  const looksDomain = host.includes(".") && /^[a-z0-9.-]+$/.test(host) && !host.startsWith(".") && !host.endsWith("-");
  if (!isAddr && !looksDomain) return null;
  const display = isIPv6(host) ? `[${host}]` : host;
  return hp.port > 0 ? `${display}:${hp.port}` : display;
}
