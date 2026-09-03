import type { AmneziaParams, WarpAddresses, WarpConfig, WarpEndpoint } from "../types/warp";
import { isBase64Key32, publicKeyFromPrivate } from "../crypto/x25519";
import { isIPv6 } from "../utils/net";

export interface ParseOk {
  ok: true;
  config: WarpConfig;
  amnezia_overrides: AmneziaParams | null;
  endpoints?: WarpEndpoint[];
}

export interface ParseFail {
  ok: false;
  reason: string;
}

export type ParseResult = ParseOk | ParseFail;

const AMNEZIA_INT_KEYS = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4"] as const;

const INTERFACE_KEYS = new Set([
  "privatekey",
  "address",
  "dns",
  "mtu",
  "listenport",
  "jc",
  "jmin",
  "jmax",
  "s1",
  "s2",
  "s3",
  "s4",
  "h1",
  "h2",
  "h3",
  "h4",
  "i1",
]);

const PEER_KEYS = new Set([
  "publickey",
  "presharedkey",
  "allowedips",
  "endpoint",
  "persistentkeepalive",
  "reserved",
  "clientid",
]);

const DEFAULT_PEER_PUBLIC_KEY = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";
const DEFAULT_WARP_IPV4 = "172.16.0.2/32";

function fail(reason: string): ParseFail {
  return { ok: false, reason };
}

export function isValidIpv4Part(part: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(part.trim());
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    if (Number(m[i]) > 255) return false;
  }
  if (m[5] !== undefined && Number(m[5]) > 32) return false;
  return true;
}

export function isValidIpv6Part(part: string): boolean {
  let p = part.trim();
  const slash = p.indexOf("/");
  let prefix: number | null = null;
  if (slash >= 0) {
    prefix = Number(p.slice(slash + 1));
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;
    p = p.slice(0, slash);
  }
  if (p === "") return false;
  const double = p.split("::");
  if (double.length > 2) return false;
  const groups = (double.length === 2 ? double[0]!.split(":").concat(double[1]!.split(":")) : p.split(":")).filter(
    (g) => g.length > 0,
  );
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  if (double.length === 1 && groups.length !== 8) return false;
  if (double.length === 2 && groups.length > 7) return false;
  return true;
}

export function isValidAddressValue(value: string): boolean {
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (part.length === 0) return false;
    if (part.includes(":")) {
      if (!isValidIpv6Part(part)) return false;
    } else if (!isValidIpv4Part(part)) {
      return false;
    }
  }
  return true;
}

export function decodeReservedTriplet(b64: string): [number, number, number] | null {
  if (b64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  let padded = b64;
  while (padded.length % 4 !== 0) padded += "=";
  try {
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (bytes.length !== 3) return null;
    return [bytes[0]!, bytes[1]!, bytes[2]!];
  } catch {
    return null;
  }
}

function decodeReservedBytes(value: string): [number, number, number] | null {
  const parts = value.split(/[,\s]+/).filter((p) => p.length > 0);
  if (parts.length === 3) {
    const nums = parts.map((p) => Number(p));
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return [nums[0]!, nums[1]!, nums[2]!];
    }
    return null;
  }
  if (parts.length === 1) return decodeReservedTriplet(parts[0]!);
  return null;
}

function parseAmneziaInt(key: string, value: string): { ok: true; value: number | string } | { ok: false } {
  const v = value.trim();
  if (key.startsWith("H")) {
    const range = /^(\d+)-(\d+)$/.exec(v);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (lo > hi || hi > 2147483647) return { ok: false };
      return { ok: true, value: `${lo}-${hi}` };
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 2147483647) return { ok: false };
    return { ok: true, value: n };
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return { ok: false };
  if (key === "Jc" && n > 128) return { ok: false };
  if ((key === "Jmin" || key === "Jmax") && n > 1280) return { ok: false };
  if (key.startsWith("S") && n > 65535) return { ok: false };
  return { ok: true, value: n };
}

export function parseWireGuardConf(text: string): ParseResult {
  const raw = text.trim();
  if (raw.length < 100) return fail("config too short");
  if (raw.length > 10 * 1024) return fail("config too large");
  const lines = raw.split(/\r?\n/);
  let section = "";
  let interfaceCount = 0;
  let peerCount = 0;
  let privateKey: string | null = null;
  let address: string | null = null;
  let mtu = 1280;
  let peerPublicKey: string | null = null;
  let reserved: [number, number, number] | null = null;
  const endpoints: WarpEndpoint[] = [];
  const amnezia: AmneziaParams = {};
  let hasAmnezia = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (trimmed.startsWith("[")) {
      const name = trimmed.replace(/[\[\]]/g, "").trim().toLowerCase();
      if (name === "interface") {
        interfaceCount += 1;
        if (interfaceCount > 1) return fail("multiple [Interface] sections");
      } else if (name === "peer") {
        peerCount += 1;
        if (peerCount > 1) return fail("multiple [Peer] sections");
      }
      section = name;
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (section === "interface") {
      if (!INTERFACE_KEYS.has(key)) return fail(`unknown interface key: ${key}`);
      if (key === "privatekey") privateKey = value;
      else if (key === "address") address = value;
      else if (key === "mtu") {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 576 || n > 65535) return fail("invalid mtu");
        mtu = n;
      } else if (AMNEZIA_INT_KEYS.some((k) => k.toLowerCase() === key)) {
        const canonical = AMNEZIA_INT_KEYS.find((k) => k.toLowerCase() === key)!;
        const parsed = parseAmneziaInt(canonical, value);
        if (!parsed.ok) return fail(`invalid amnezia value for ${canonical}`);
        amnezia[canonical] = parsed.value;
        hasAmnezia = true;
      } else if (key === "i1") {
        if (value.length > 0 && !/^<([rb]) [^>]*>$/.test(value)) return fail("invalid I1 notation");
        amnezia.I1 = value;
        hasAmnezia = true;
      }
    } else if (section === "peer") {
      if (key === "presharedkey") return fail("PresharedKey not supported");
      if (key === "persistentkeepalive") continue;
      if (!PEER_KEYS.has(key)) return fail(`unknown peer key: ${key}`);
      if (key === "publickey") peerPublicKey = value;
      else if ((key === "reserved" || key === "clientid") && reserved === null) {
        const parsed = decodeReservedBytes(value);
        if (parsed === null) return fail("invalid reserved");
        reserved = parsed;
      } else if (key === "endpoint") {
        const ep = parseEndpointHostPort(value);
        if (ep !== null) endpoints.push(ep);
      }
    }
  }
  if (privateKey === null) return fail("missing PrivateKey");
  if (address === null) return fail("missing Address");
  if (peerPublicKey === null) return fail("missing peer PublicKey");
  if (!isBase64Key32(privateKey)) return fail("invalid PrivateKey");
  if (!isBase64Key32(peerPublicKey)) return fail("invalid peer PublicKey");
  if (!isValidAddressValue(address)) return fail("invalid Address");
  const addresses = splitAddresses(address);
  if (addresses === null) return fail("no usable Address");
  let publicKey: string;
  try {
    publicKey = publicKeyFromPrivate(privateKey);
  } catch {
    return fail("invalid PrivateKey (weak key)");
  }
  const config: WarpConfig = {
    private_key: privateKey,
    public_key: publicKey,
    addresses,
    peer_public_key: peerPublicKey,
    mtu,
    reserved: reserved ?? [0, 0, 0],
  };
  const result: ParseOk = { ok: true, config, amnezia_overrides: hasAmnezia ? amnezia : null };
  if (endpoints.length > 0) result.endpoints = dedupeEndpoints(endpoints);
  return result;
}

function splitAddresses(value: string): WarpAddresses | null {
  const parts = value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
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
    host = bracket[1]!;
    portStr = bracket[2]!;
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0 && host.indexOf(":") === colon) {
      portStr = host.slice(colon + 1);
      host = host.slice(0, colon);
    }
  }
  const port = Number(portStr);
  if (portStr === "" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  host = host.replace(/^\[|\]$/g, "");
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

function dedupeEndpoints(list: WarpEndpoint[]): WarpEndpoint[] {
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

function parseQuery(query: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const piece of query.split("&")) {
    if (piece.length === 0) continue;
    const eq = piece.indexOf("=");
    const key = (eq < 0 ? piece : piece.slice(0, eq)).trim();
    let value = eq < 0 ? "" : piece.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw */
    }
    if (key.length > 0 && !map.has(key)) map.set(key, value);
  }
  return map;
}

export function parseWgUri(uri: string): ParseResult {
  const trimmed = uri.trim();
  const m = /^(?:wg|wireguard):\/\//i.exec(trimmed);
  if (!m) return fail("not a wg:// or wireguard:// URI");
  const rest = trimmed.slice(m[0].length);
  const at = rest.indexOf("@");
  const hash = rest.indexOf("#");
  const queryStart = rest.indexOf("?");
  const authorityEnd = queryStart >= 0 ? queryStart : hash >= 0 ? hash : rest.length;
  const userinfo = at >= 0 && at < authorityEnd ? rest.slice(0, at) : null;
  const query = queryStart >= 0 ? rest.slice(queryStart + 1, hash >= 0 && hash > queryStart ? hash : undefined) : "";
  const q = parseQuery(query);
  let userKey: string | null = null;
  if (userinfo !== null) {
    try {
      userKey = decodeURIComponent(userinfo);
    } catch {
      return fail("invalid private_key encoding");
    }
  }
  const privateKey = q.get("private_key") ?? userKey;
  if (privateKey === null || !isBase64Key32(privateKey)) return fail("missing or invalid private_key");
  const addressValue = (q.get("local_address") ?? q.get("address")) ?? null;
  if (addressValue === null || addressValue.length === 0) return fail("missing local_address");
  const parts = addressValue.split(/[,\-]/).map((p) => p.trim()).filter((p) => p.length > 0);
  let ipv4 = "";
  let ipv6 = "";
  for (const part of parts) {
    if (part.includes(":")) {
      if (!isValidIpv6Part(part)) return fail(`invalid ipv6 address: ${part}`);
      if (ipv6.length === 0) ipv6 = part;
    } else {
      if (!isValidIpv4Part(part)) return fail(`invalid ipv4 address: ${part}`);
      if (ipv4.length === 0) ipv4 = part;
    }
  }
  if (ipv4.length === 0 && ipv6.length === 0) return fail("no usable address");
  const publicKey = q.get("public_key") ?? q.get("publickey") ?? DEFAULT_PEER_PUBLIC_KEY;
  if (!isBase64Key32(publicKey)) return fail("invalid public_key");
  let mtu = 1280;
  const mtuRaw = q.get("mtu");
  if (mtuRaw !== undefined && mtuRaw.length > 0) {
    const n = Number(mtuRaw);
    if (!Number.isInteger(n) || n < 576 || n > 65535) return fail("invalid mtu");
    mtu = n;
  }
  let reserved: [number, number, number] = [0, 0, 0];
  const reservedRaw = q.get("reserved");
  if (reservedRaw !== undefined && reservedRaw.length > 0) {
    const dashForm = reservedRaw.includes("-") && !/^\d+-\d+-\d+$/.test(reservedRaw) ? null : reservedRaw;
    if (dashForm !== null) {
      const parsed = decodeReservedBytes(reservedRaw.split("-").join(","));
      if (parsed === null) return fail("invalid reserved");
      reserved = parsed;
    } else {
      return fail("invalid reserved");
    }
  }
  const amnezia: AmneziaParams = {};
  let hasAmnezia = false;
  const enable = (q.get("enable_amnezia") ?? "").toLowerCase();
  if (enable === "true" || enable === "1") {
    for (const key of AMNEZIA_INT_KEYS) {
      const raw = q.get(key.toLowerCase());
      if (raw === undefined || raw.length === 0) continue;
      const parsed = parseAmneziaInt(key, raw);
      if (!parsed.ok) return fail(`invalid amnezia value for ${key}`);
      amnezia[key] = parsed.value;
      hasAmnezia = true;
    }
    const i1 = q.get("i1");
    if (i1 !== undefined && i1.length > 0) {
      if (!/^<([rb]) [^>]*>$/.test(i1)) return fail("invalid I1 notation");
      amnezia.I1 = i1;
      hasAmnezia = true;
    }
  }
  let derivedPublicKey: string;
  try {
    derivedPublicKey = publicKeyFromPrivate(privateKey);
  } catch {
    return fail("invalid private_key (weak key)");
  }
  const config: WarpConfig = {
    private_key: privateKey,
    public_key: derivedPublicKey,
    addresses: { ipv4, ipv6 },
    peer_public_key: publicKey,
    mtu,
    reserved,
  };
  const result: ParseOk = { ok: true, config, amnezia_overrides: hasAmnezia ? amnezia : null };
  const endpoints: WarpEndpoint[] = [];
  const authorityHost = userinfo !== null ? rest.slice(at + 1, authorityEnd) : rest.slice(0, authorityEnd);
  const authorityEndpoint = parseEndpointHostPort(authorityHost);
  if (authorityEndpoint !== null) endpoints.push(authorityEndpoint);
  const endpointParam = q.get("endpoint");
  if (endpointParam !== undefined && endpointParam.length > 0) {
    const ep = parseEndpointHostPort(endpointParam);
    if (ep !== null) endpoints.push(ep);
  }
  if (endpoints.length > 0) result.endpoints = dedupeEndpoints(endpoints);
  return result;
}

export function parseWarpConfig(text: string): ParseResult {
  const trimmed = text.trim();
  if (/^(?:wg|wireguard):\/\//i.test(trimmed)) return parseWgUri(trimmed);
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return fail("invalid JSON config");
    }
    return parseWarpJson(parsed);
  }
  return parseWireGuardConf(trimmed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function jsonAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isValidAddressValue(trimmed) ? trimmed : null;
}

export function parseWarpJson(root: unknown): ParseResult {
  let source = asRecord(root);
  if (source === null) return fail("JSON config must be an object");
  const inner = asRecord(source.config);
  if (inner !== null) source = inner;
  const privateKey = typeof source.private_key === "string" ? source.private_key.trim() : "";
  if (!isBase64Key32(privateKey)) return fail("missing or invalid private_key");
  let publicKey: string;
  try {
    publicKey = publicKeyFromPrivate(privateKey);
  } catch {
    return fail("invalid private_key (weak key)");
  }
  const addressesRaw = asRecord(source.addresses);
  let ipv4 = "";
  let ipv6 = "";
  if (addressesRaw !== null) {
    const v4 = jsonAddress(addressesRaw.ipv4);
    const v6 = jsonAddress(addressesRaw.ipv6);
    if (addressesRaw.ipv4 !== undefined && v4 === null) return fail("invalid addresses.ipv4");
    if (addressesRaw.ipv6 !== undefined && v6 === null) return fail("invalid addresses.ipv6");
    ipv4 = v4 ?? "";
    ipv6 = v6 ?? "";
  }
  if (ipv4.length === 0 && ipv6.length === 0) ipv4 = DEFAULT_WARP_IPV4;
  const peerKeyRaw = typeof source.peer_public_key === "string" ? source.peer_public_key.trim() : "";
  if (peerKeyRaw.length > 0 && !isBase64Key32(peerKeyRaw)) return fail("invalid peer_public_key");
  const peerPublicKey = peerKeyRaw.length > 0 ? peerKeyRaw : DEFAULT_PEER_PUBLIC_KEY;
  let mtu = 1280;
  if (source.mtu !== undefined && source.mtu !== null) {
    const n = Number(source.mtu);
    if (!Number.isInteger(n) || n < 576 || n > 65535) return fail("invalid mtu");
    mtu = n;
  }
  let reserved: [number, number, number] = [0, 0, 0];
  const reservedRaw = source.reserved;
  if (reservedRaw !== undefined && reservedRaw !== null) {
    if (typeof reservedRaw === "string") {
      const parsed = decodeReservedBytes(reservedRaw);
      if (parsed === null) return fail("invalid reserved");
      reserved = parsed;
    } else if (Array.isArray(reservedRaw)) {
      if (reservedRaw.length !== 3) return fail("invalid reserved");
      const nums = reservedRaw.map((p) => Number(p));
      if (!nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return fail("invalid reserved");
      reserved = [nums[0]!, nums[1]!, nums[2]!];
    } else {
      return fail("invalid reserved");
    }
  }
  const amnezia: AmneziaParams = {};
  let hasAmnezia = false;
  const amneziaRaw = asRecord(source.amnezia);
  if (amneziaRaw !== null) {
    for (const key of AMNEZIA_INT_KEYS) {
      const raw = amneziaRaw[key];
      if (raw === undefined || raw === null) continue;
      const parsed = parseAmneziaInt(key, String(raw));
      if (!parsed.ok) return fail(`invalid amnezia value for ${key}`);
      amnezia[key] = parsed.value;
      hasAmnezia = true;
    }
    const i1 = amneziaRaw.I1 ?? amneziaRaw.i1;
    if (typeof i1 === "string" && i1.length > 0) {
      if (!/^<([rb]) [^>]*>$/.test(i1)) return fail("invalid I1 notation");
      amnezia.I1 = i1;
      hasAmnezia = true;
    }
  }
  const endpoints: WarpEndpoint[] = [];
  if (typeof source.endpoint === "string" && source.endpoint.trim().length > 0) {
    const ep = parseEndpointHostPort(source.endpoint);
    if (ep === null) return fail("invalid endpoint");
    endpoints.push(ep);
  }
  const endpointsRaw = source.endpoints;
  if (endpointsRaw !== undefined && endpointsRaw !== null) {
    if (!Array.isArray(endpointsRaw)) return fail("endpoints must be an array");
    for (const item of endpointsRaw) {
      if (typeof item !== "string") return fail("invalid endpoint");
      const ep = parseEndpointHostPort(item);
      if (ep === null) return fail(`invalid endpoint: ${item.slice(0, 60)}`);
      endpoints.push(ep);
    }
  }
  const config: WarpConfig = {
    private_key: privateKey,
    public_key: publicKey,
    addresses: { ipv4, ipv6 },
    peer_public_key: peerPublicKey,
    mtu,
    reserved,
  };
  const result: ParseOk = { ok: true, config, amnezia_overrides: hasAmnezia ? amnezia : null };
  if (endpoints.length > 0) result.endpoints = dedupeEndpoints(endpoints);
  return result;
}
