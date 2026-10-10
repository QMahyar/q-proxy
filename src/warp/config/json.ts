import type { AmneziaParams, WarpConfig, WarpEndpoint } from "../../types/warp";
import { isBase64Key32, publicKeyFromPrivate } from "../../crypto/x25519";
import { dedupeEndpoints, isValidAddressValue, parseEndpointHostPort } from "./address";
import { decodeReservedBytes, parseAmneziaInt } from "./amnezia";
import { AMNEZIA_INT_KEYS, DEFAULT_PEER_PUBLIC_KEY, DEFAULT_WARP_IPV4, fail, type ParseOk, type ParseResult } from "./types";
import { parseBoundedInt, parseDecimalInt } from "../../utils/numbers";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function jsonAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isValidAddressValue(trimmed) ? trimmed : null;
}

interface JsonBuild {
  source: Record<string, unknown>;
  privateKey: string;
  publicKey: string;
  ipv4: string;
  ipv6: string;
  peerPublicKey: string;
  mtu: number;
  reserved: [number, number, number];
  amnezia: AmneziaParams;
  hasAmnezia: boolean;
}

// Phase 1: unwrap the root object (tolerating a nested {config} wrapper).
function unwrapJsonSource(root: unknown): { ok: true; source: Record<string, unknown> } | { ok: false; reason: string } {
  let source = asRecord(root);
  if (source === null) return { ok: false, reason: "JSON config must be an object" };
  const inner = asRecord(source.config);
  if (inner !== null) source = inner;
  return { ok: true, source };
}

// Phase 2: resolve the private key and derive the public key.
function resolveJsonIdentity(source: Record<string, unknown>): { ok: true; privateKey: string; publicKey: string } | { ok: false; reason: string } {
  const privateKey = typeof source.private_key === "string" ? source.private_key.trim() : "";
  if (!isBase64Key32(privateKey)) return { ok: false, reason: "missing or invalid private_key" };
  try {
    return { ok: true, privateKey, publicKey: publicKeyFromPrivate(privateKey) };
  } catch {
    return { ok: false, reason: "invalid private_key (weak key)" };
  }
}

// Phase 3: resolve addresses, defaulting to the WARP IPv4 when absent.
function resolveJsonAddresses(source: Record<string, unknown>): { ok: true; ipv4: string; ipv6: string } | { ok: false; reason: string } {
  const addressesRaw = asRecord(source.addresses);
  let ipv4 = "";
  let ipv6 = "";
  if (addressesRaw !== null) {
    const v4 = jsonAddress(addressesRaw.ipv4);
    const v6 = jsonAddress(addressesRaw.ipv6);
    if (addressesRaw.ipv4 !== undefined && v4 === null) return { ok: false, reason: "invalid addresses.ipv4" };
    if (addressesRaw.ipv6 !== undefined && v6 === null) return { ok: false, reason: "invalid addresses.ipv6" };
    ipv4 = v4 ?? "";
    ipv6 = v6 ?? "";
  }
  if (ipv4.length === 0 && ipv6.length === 0) ipv4 = DEFAULT_WARP_IPV4;
  return { ok: true, ipv4, ipv6 };
}

// Phase 4: resolve the peer key, MTU, and reserved triplet.
function resolveJsonPeer(source: Record<string, unknown>): { ok: true; peerPublicKey: string; mtu: number; reserved: [number, number, number] } | { ok: false; reason: string } {
  const peerKeyRaw = typeof source.peer_public_key === "string" ? source.peer_public_key.trim() : "";
  if (peerKeyRaw.length > 0 && !isBase64Key32(peerKeyRaw)) return { ok: false, reason: "invalid peer_public_key" };
  const peerPublicKey = peerKeyRaw.length > 0 ? peerKeyRaw : DEFAULT_PEER_PUBLIC_KEY;
  let mtu = 1280;
  if (source.mtu !== undefined && source.mtu !== null) {
    if (typeof source.mtu === "string") {
      const parsed = parseBoundedInt(source.mtu, 576, 65535);
      if (parsed === null) return { ok: false, reason: "invalid mtu" };
      mtu = parsed;
    } else {
      const n = Number(source.mtu);
      if (!Number.isInteger(n) || n < 576 || n > 65535) return { ok: false, reason: "invalid mtu" };
      mtu = n;
    }
  }
  let reserved: [number, number, number] = [0, 0, 0];
  const reservedRaw = source.reserved;
  if (reservedRaw !== undefined && reservedRaw !== null) {
    if (typeof reservedRaw === "string") {
      const parsed = decodeReservedBytes(reservedRaw);
      if (parsed === null) return { ok: false, reason: "invalid reserved" };
      reserved = parsed;
    } else if (Array.isArray(reservedRaw)) {
      if (reservedRaw.length !== 3) return { ok: false, reason: "invalid reserved" };
      const nums: number[] = [];
      for (const p of reservedRaw) {
        const n = typeof p === "string" ? parseDecimalInt(p) : Number(p);
        if (n === null || !Number.isInteger(n) || n < 0 || n > 255) return { ok: false, reason: "invalid reserved" };
        nums.push(n);
      }
      const [r0, r1, r2] = nums;
      if (r0 === undefined || r1 === undefined || r2 === undefined) return { ok: false, reason: "invalid reserved" };
      reserved = [r0, r1, r2];
    } else {
      return { ok: false, reason: "invalid reserved" };
    }
  }
  return { ok: true, peerPublicKey, mtu, reserved };
}

// Phase 5: resolve AmneziaWG overrides.
function resolveJsonAmnezia(source: Record<string, unknown>): { ok: true; amnezia: AmneziaParams; hasAmnezia: boolean } | { ok: false; reason: string } {
  const amnezia: AmneziaParams = {};
  let hasAmnezia = false;
  const amneziaRaw = asRecord(source.amnezia);
  if (amneziaRaw !== null) {
    for (const key of AMNEZIA_INT_KEYS) {
      const raw = amneziaRaw[key];
      if (raw === undefined || raw === null) continue;
      const parsed = parseAmneziaInt(key, String(raw));
      if (!parsed.ok) return { ok: false, reason: `invalid amnezia value for ${key}` };
      amnezia[key] = parsed.value;
      hasAmnezia = true;
    }
    const i1 = amneziaRaw.I1 ?? amneziaRaw.i1;
    if (typeof i1 === "string" && i1.length > 0) {
      if (!/^<([rb]) [^>]*>$/.test(i1)) return { ok: false, reason: "invalid I1 notation" };
      amnezia.I1 = i1;
      hasAmnezia = true;
    }
  }
  return { ok: true, amnezia, hasAmnezia };
}

// Phase 6: collect endpoints from endpoint/endpoints fields.
function collectJsonEndpoints(source: Record<string, unknown>): { ok: true; endpoints: WarpEndpoint[] } | { ok: false; reason: string } {
  const endpoints: WarpEndpoint[] = [];
  if (typeof source.endpoint === "string" && source.endpoint.trim().length > 0) {
    const ep = parseEndpointHostPort(source.endpoint);
    if (ep === null) return { ok: false, reason: "invalid endpoint" };
    endpoints.push(ep);
  }
  const endpointsRaw = source.endpoints;
  if (endpointsRaw !== undefined && endpointsRaw !== null) {
    if (!Array.isArray(endpointsRaw)) return { ok: false, reason: "endpoints must be an array" };
    for (const item of endpointsRaw) {
      if (typeof item !== "string") return { ok: false, reason: "invalid endpoint" };
      const ep = parseEndpointHostPort(item);
      if (ep === null) return { ok: false, reason: `invalid endpoint: ${item.slice(0, 60)}` };
      endpoints.push(ep);
    }
  }
  return { ok: true, endpoints };
}

export function parseWarpJson(root: unknown): ParseResult {
  const unwrapped = unwrapJsonSource(root);
  if (!unwrapped.ok) return fail(unwrapped.reason);
  const source = unwrapped.source;
  const identity = resolveJsonIdentity(source);
  if (!identity.ok) return fail(identity.reason);
  const addresses = resolveJsonAddresses(source);
  if (!addresses.ok) return fail(addresses.reason);
  const peer = resolveJsonPeer(source);
  if (!peer.ok) return fail(peer.reason);
  const amnezia = resolveJsonAmnezia(source);
  if (!amnezia.ok) return fail(amnezia.reason);
  const collected = collectJsonEndpoints(source);
  if (!collected.ok) return fail(collected.reason);
  const build: JsonBuild = {
    source,
    privateKey: identity.privateKey,
    publicKey: identity.publicKey,
    ipv4: addresses.ipv4,
    ipv6: addresses.ipv6,
    peerPublicKey: peer.peerPublicKey,
    mtu: peer.mtu,
    reserved: peer.reserved,
    amnezia: amnezia.amnezia,
    hasAmnezia: amnezia.hasAmnezia,
  };
  const config: WarpConfig = {
    private_key: build.privateKey,
    public_key: build.publicKey,
    addresses: { ipv4: build.ipv4, ipv6: build.ipv6 },
    peer_public_key: build.peerPublicKey,
    mtu: build.mtu,
    reserved: build.reserved,
  };
  const result: ParseOk = { ok: true, config, amnezia_overrides: build.hasAmnezia ? build.amnezia : null };
  if (collected.endpoints.length > 0) result.endpoints = dedupeEndpoints(collected.endpoints);
  return result;
}
