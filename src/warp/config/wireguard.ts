import type { AmneziaParams, WarpConfig, WarpEndpoint } from "../../types/warp";
import { isBase64Key32, publicKeyFromPrivate } from "../../crypto/x25519";
import { dedupeEndpoints, isValidAddressValue, parseEndpointHostPort, splitAddresses } from "./address";
import { decodeReservedBytes, parseAmneziaInt } from "./amnezia";
import { INTERFACE_KEYS, PEER_KEYS, AMNEZIA_INT_KEYS, fail, type ParseFail, type ParseOk, type ParseResult } from "./types";
import { parseBoundedInt } from "../../utils/numbers";

interface ConfScan {
  section: string;
  interfaceCount: number;
  peerCount: number;
  privateKey: string | null;
  address: string | null;
  mtu: number;
  peerPublicKey: string | null;
  reserved: [number, number, number] | null;
  endpoints: WarpEndpoint[];
  amnezia: AmneziaParams;
  hasAmnezia: boolean;
}

function newConfScan(): ConfScan {
  return {
    section: "",
    interfaceCount: 0,
    peerCount: 0,
    privateKey: null,
    address: null,
    mtu: 1280,
    peerPublicKey: null,
    reserved: null,
    endpoints: [],
    amnezia: {},
    hasAmnezia: false,
  };
}

// Phase 1: reject inputs that are too short to be real or too large to scan safely.
function checkConfSize(text: string): { ok: true; raw: string } | { ok: false; fail: ParseFail } {
  const raw = text.trim();
  if (raw.length < 100) return { ok: false, fail: fail("config too short") };
  if (raw.length > 10 * 1024) return { ok: false, fail: fail("config too large") };
  return { ok: true, raw };
}

// Phase 2: walk lines, track the current section, delegate key=value entries.
function scanConfLines(scan: ConfScan, raw: string): ParseFail | null {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (trimmed.startsWith("[")) {
      const name = trimmed.replace(/[\[\]]/g, "").trim().toLowerCase();
      if (name === "interface") {
        scan.interfaceCount += 1;
        if (scan.interfaceCount > 1) return fail("multiple [Interface] sections");
      } else if (name === "peer") {
        scan.peerCount += 1;
        if (scan.peerCount > 1) return fail("multiple [Peer] sections");
      }
      scan.section = name;
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (scan.section === "interface") {
      const err = applyInterfaceEntry(scan, key, value);
      if (err !== null) return err;
    } else if (scan.section === "peer") {
      const err = applyPeerEntry(scan, key, value);
      if (err !== null) return err;
    }
  }
  return null;
}

// Phase 3: apply one [Interface] entry (keys, MTU, AmneziaWG overrides).
function applyInterfaceEntry(scan: ConfScan, key: string, value: string): ParseFail | null {
  if (!INTERFACE_KEYS.has(key)) return fail(`unknown interface key: ${key}`);
  if (key === "privatekey") scan.privateKey = value;
  else if (key === "address") scan.address = value;
  else if (key === "mtu") {
    const mtu = parseBoundedInt(value, 576, 65535);
    if (mtu === null) return fail("invalid mtu");
    scan.mtu = mtu;
  } else if (AMNEZIA_INT_KEYS.some((k) => k.toLowerCase() === key)) {
    const canonical = AMNEZIA_INT_KEYS.find((k) => k.toLowerCase() === key);
    if (canonical === undefined) return fail(`unknown interface key: ${key}`);
    const parsed = parseAmneziaInt(canonical, value);
    if (!parsed.ok) return fail(`invalid amnezia value for ${canonical}`);
    scan.amnezia[canonical] = parsed.value;
    scan.hasAmnezia = true;
  } else if (key === "i1") {
    if (value.length > 0 && !/^<([rb]) [^>]*>$/.test(value)) return fail("invalid I1 notation");
    scan.amnezia.I1 = value;
    scan.hasAmnezia = true;
  }
  return null;
}

// Phase 4: apply one [Peer] entry (peer key, reserved triplet, endpoints).
function applyPeerEntry(scan: ConfScan, key: string, value: string): ParseFail | null {
  if (key === "presharedkey") return fail("PresharedKey not supported");
  if (key === "persistentkeepalive") return null;
  if (!PEER_KEYS.has(key)) return fail(`unknown peer key: ${key}`);
  if (key === "publickey") scan.peerPublicKey = value;
  else if ((key === "reserved" || key === "clientid") && scan.reserved === null) {
    const parsed = decodeReservedBytes(value);
    if (parsed === null) return fail("invalid reserved");
    scan.reserved = parsed;
  } else if (key === "endpoint") {
    const ep = parseEndpointHostPort(value);
    if (ep !== null) scan.endpoints.push(ep);
  }
  return null;
}

// Phase 5: validate the collected keys/addresses and derive the public key.
function finalizeConfConfig(scan: ConfScan): ParseResult {
  if (scan.privateKey === null) return fail("missing PrivateKey");
  if (scan.address === null) return fail("missing Address");
  if (scan.peerPublicKey === null) return fail("missing peer PublicKey");
  if (!isBase64Key32(scan.privateKey)) return fail("invalid PrivateKey");
  if (!isBase64Key32(scan.peerPublicKey)) return fail("invalid peer PublicKey");
  if (!isValidAddressValue(scan.address)) return fail("invalid Address");
  const addresses = splitAddresses(scan.address);
  if (addresses === null) return fail("no usable Address");
  let publicKey: string;
  try {
    publicKey = publicKeyFromPrivate(scan.privateKey);
  } catch {
    return fail("invalid PrivateKey (weak key)");
  }
  const config: WarpConfig = {
    private_key: scan.privateKey,
    public_key: publicKey,
    addresses,
    peer_public_key: scan.peerPublicKey,
    mtu: scan.mtu,
    reserved: scan.reserved ?? [0, 0, 0],
  };
  const result: ParseOk = { ok: true, config, amnezia_overrides: scan.hasAmnezia ? scan.amnezia : null };
  if (scan.endpoints.length > 0) result.endpoints = dedupeEndpoints(scan.endpoints);
  return result;
}

export function parseWireGuardConf(text: string): ParseResult {
  const sized = checkConfSize(text);
  if (!sized.ok) return sized.fail;
  const scan = newConfScan();
  const err = scanConfLines(scan, sized.raw);
  if (err !== null) return err;
  return finalizeConfConfig(scan);
}
