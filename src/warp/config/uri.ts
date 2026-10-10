import type { AmneziaParams, WarpConfig, WarpEndpoint } from "../../types/warp";
import { isBase64Key32, publicKeyFromPrivate } from "../../crypto/x25519";
import { dedupeEndpoints, isValidIpv4Part, isValidIpv6Part, parseEndpointHostPort, splitWgAddressList } from "./address";
import { decodeReservedBytes, parseAmneziaInt } from "./amnezia";
import { AMNEZIA_INT_KEYS, DEFAULT_PEER_PUBLIC_KEY, fail, type ParseFail, type ParseOk, type ParseResult } from "./types";
import { parseBoundedInt } from "../../utils/numbers";

interface UriEnvelope {
  userKey: string | null;
  query: Map<string, string>;
  authorityHost: string;
}

interface UriBuild extends UriEnvelope {
  privateKey: string;
  ipv4: string;
  ipv6: string;
  peerKey: string;
  mtu: number;
  reserved: [number, number, number];
  amnezia: AmneziaParams;
  hasAmnezia: boolean;
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

// Phase 1: split the URI into userinfo key, query map, and authority host text.
// Kept as a manual slice (not `new URL`) on purpose: wg:// authorities may be
// empty (`wg://<key>@?...`), carry raw base64 userinfo whose "/" would end a
// URL authority early, and carry unencoded "+" in query values which
// URLSearchParams would corrupt to a space. parseQuery preserves "+" like before.
function splitUriEnvelope(uri: string): { ok: true; envelope: UriEnvelope } | { ok: false; fail: ParseFail } {
  const trimmed = uri.trim();
  const m = /^(?:wg|wireguard):\/\//i.exec(trimmed);
  if (!m) return { ok: false, fail: fail("not a wg:// or wireguard:// URI") };
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
      return { ok: false, fail: fail("invalid private_key encoding") };
    }
  }
  const authorityHost = userinfo !== null ? rest.slice(at + 1, authorityEnd) : rest.slice(0, authorityEnd);
  return { ok: true, envelope: { userKey, query: q, authorityHost } };
}

// Phase 2: resolve the private key from the query or userinfo.
function resolveUriIdentity(build: UriBuild): ParseFail | null {
  const privateKey = build.query.get("private_key") ?? build.userKey;
  if (privateKey === null || !isBase64Key32(privateKey)) return fail("missing or invalid private_key");
  build.privateKey = privateKey;
  return null;
}

// Phase 3: resolve local addresses from local_address/address params.
function resolveUriAddresses(build: UriBuild): ParseFail | null {
  const addressValue = (build.query.get("local_address") ?? build.query.get("address")) ?? null;
  if (addressValue === null || addressValue.length === 0) return fail("missing local_address");
  const parts = splitWgAddressList(addressValue);
  for (const part of parts) {
    if (part.includes(":")) {
      if (!isValidIpv6Part(part)) return fail(`invalid ipv6 address: ${part}`);
      if (build.ipv6.length === 0) build.ipv6 = part;
    } else {
      if (!isValidIpv4Part(part)) return fail(`invalid ipv4 address: ${part}`);
      if (build.ipv4.length === 0) build.ipv4 = part;
    }
  }
  if (build.ipv4.length === 0 && build.ipv6.length === 0) return fail("no usable address");
  return null;
}

// Phase 4: resolve peer key, MTU, and reserved triplet.
function resolveUriPeer(build: UriBuild): ParseFail | null {
  const q = build.query;
  const publicKey = q.get("public_key") ?? q.get("publickey") ?? DEFAULT_PEER_PUBLIC_KEY;
  if (!isBase64Key32(publicKey)) return fail("invalid public_key");
  build.peerKey = publicKey;
  const mtuRaw = q.get("mtu");
  if (mtuRaw !== undefined && mtuRaw.length > 0) {
    const mtu = parseBoundedInt(mtuRaw, 576, 65535);
    if (mtu === null) return fail("invalid mtu");
    build.mtu = mtu;
  }
  const reservedRaw = q.get("reserved");
  if (reservedRaw !== undefined && reservedRaw.length > 0) {
    if (reservedRaw.includes("-") && !/^\d+-\d+-\d+$/.test(reservedRaw)) return fail("invalid reserved");
    const parsed = decodeReservedBytes(reservedRaw.split("-").join(","));
    if (parsed === null) return fail("invalid reserved");
    build.reserved = parsed;
  }
  return null;
}

// Phase 5: resolve opt-in AmneziaWG overrides.
function resolveUriAmnezia(build: UriBuild): ParseFail | null {
  const q = build.query;
  const enable = (q.get("enable_amnezia") ?? "").toLowerCase();
  if (enable !== "true" && enable !== "1") return null;
  for (const key of AMNEZIA_INT_KEYS) {
    const raw = q.get(key.toLowerCase());
    if (raw === undefined || raw.length === 0) continue;
    const parsed = parseAmneziaInt(key, raw);
    if (!parsed.ok) return fail(`invalid amnezia value for ${key}`);
    build.amnezia[key] = parsed.value;
    build.hasAmnezia = true;
  }
  const i1 = q.get("i1");
  if (i1 !== undefined && i1.length > 0) {
    if (!/^<([rb]) [^>]*>$/.test(i1)) return fail("invalid I1 notation");
    build.amnezia.I1 = i1;
    build.hasAmnezia = true;
  }
  return null;
}

// Phase 6: derive the public key, build the config, collect endpoints.
function finalizeUriConfig(build: UriBuild): ParseResult {
  let derivedPublicKey: string;
  try {
    derivedPublicKey = publicKeyFromPrivate(build.privateKey);
  } catch {
    return fail("invalid private_key (weak key)");
  }
  const config: WarpConfig = {
    private_key: build.privateKey,
    public_key: derivedPublicKey,
    addresses: { ipv4: build.ipv4, ipv6: build.ipv6 },
    peer_public_key: build.peerKey,
    mtu: build.mtu,
    reserved: build.reserved,
  };
  const result: ParseOk = { ok: true, config, amnezia_overrides: build.hasAmnezia ? build.amnezia : null };
  const endpoints: WarpEndpoint[] = [];
  const authorityEndpoint = parseEndpointHostPort(build.authorityHost);
  if (authorityEndpoint !== null) endpoints.push(authorityEndpoint);
  const endpointParam = build.query.get("endpoint");
  if (endpointParam !== undefined && endpointParam.length > 0) {
    const ep = parseEndpointHostPort(endpointParam);
    if (ep !== null) endpoints.push(ep);
  }
  if (endpoints.length > 0) result.endpoints = dedupeEndpoints(endpoints);
  return result;
}

export function parseWgUri(uri: string): ParseResult {
  const envelope = splitUriEnvelope(uri);
  if (!envelope.ok) return envelope.fail;
  const build: UriBuild = {
    ...envelope.envelope,
    privateKey: "",
    ipv4: "",
    ipv6: "",
    peerKey: DEFAULT_PEER_PUBLIC_KEY,
    mtu: 1280,
    reserved: [0, 0, 0],
    amnezia: {},
    hasAmnezia: false,
  };
  for (const phase of [resolveUriIdentity, resolveUriAddresses, resolveUriPeer, resolveUriAmnezia]) {
    const err = phase(build);
    if (err !== null) return err;
  }
  return finalizeUriConfig(build);
}
