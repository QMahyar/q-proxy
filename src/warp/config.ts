import type { AmneziaParams, WarpAddresses, WarpConfig } from "../types/warp";
import { isBase64Key32, publicKeyFromPrivate } from "../crypto/x25519";

export interface ParseOk {
  ok: true;
  config: WarpConfig;
  amnezia_overrides: AmneziaParams | null;
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

function decodeReservedBytes(value: string): [number, number, number] | null {
  const parts = value.split(/[,\s]+/).filter((p) => p.length > 0);
  if (parts.length === 3) {
    const nums = parts.map((p) => Number(p));
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return [nums[0]!, nums[1]!, nums[2]!];
    }
    return null;
  }
  if (parts.length === 1) {
    let b64 = parts[0]!;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
    while (b64.length % 4 !== 0) b64 += "=";
    try {
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      if (bytes.length === 3) return [bytes[0]!, bytes[1]!, bytes[2]!];
    } catch {
      return null;
    }
  }
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
  if (key.startsWith("S") && n > 255) return { ok: false };
  return { ok: true, value: n };
}

export function parseWireGuardConf(text: string): ParseResult {
  const raw = text.trim();
  if (raw.length < 100) return fail("config too short");
  if (raw.length > 10 * 1024) return fail("config too large");
  const lines = raw.split(/\r?\n/);
  let section = "";
  let interfaceCount = 0;
  let privateKey: string | null = null;
  let address: string | null = null;
  let mtu = 1280;
  let peerPublicKey: string | null = null;
  let reserved: [number, number, number] | null = null;
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
      if (!PEER_KEYS.has(key)) return fail(`unknown peer key: ${key}`);
      if (key === "publickey") peerPublicKey = value;
      else if ((key === "reserved" || key === "clientid") && reserved === null) {
        const parsed = decodeReservedBytes(value);
        if (parsed === null) return fail("invalid reserved");
        reserved = parsed;
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
  const config: WarpConfig = {
    private_key: privateKey,
    public_key: publicKeyFromPrivate(privateKey),
    addresses,
    peer_public_key: peerPublicKey,
    mtu,
    reserved: reserved ?? [0, 0, 0],
  };
  return { ok: true, config, amnezia_overrides: hasAmnezia ? amnezia : null };
}

function splitAddresses(value: string): WarpAddresses | null {
  const parts = value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  let ipv4: string | null = null;
  let ipv6: string | null = null;
  for (const part of parts) {
    const bare = part.includes("/") ? part : part;
    if (part.includes(":")) {
      if (ipv6 === null) ipv6 = bare;
    } else if (ipv4 === null) {
      ipv4 = bare;
    }
  }
  if (ipv4 === null && ipv6 === null) return null;
  return { ipv4: ipv4 ?? "", ipv6: ipv6 ?? "" };
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
  const privateKey = q.get("private_key") ?? (userinfo !== null ? decodeURIComponent(userinfo) : null);
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
  }
  const config: WarpConfig = {
    private_key: privateKey,
    public_key: publicKeyFromPrivate(privateKey),
    addresses: { ipv4, ipv6 },
    peer_public_key: publicKey,
    mtu,
    reserved,
  };
  return { ok: true, config, amnezia_overrides: hasAmnezia ? amnezia : null };
}

export function parseWarpConfig(text: string): ParseResult {
  const trimmed = text.trim();
  if (/^(?:wg|wireguard):\/\//i.test(trimmed)) return parseWgUri(trimmed);
  return parseWireGuardConf(trimmed);
}
