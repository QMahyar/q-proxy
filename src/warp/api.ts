import type { WarpConfig } from "../types/warp";
import { generateKeypair } from "../crypto/x25519";
import { decodeReservedTriplet } from "./config";

const WARP_BASE = "https://api.cloudflareclient.com/v0a4005";
const WARP_UA = "okhttp/3.12.1";
const WARP_CLIENT_VERSION = "a-6.30-3596";
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const PEER_PUBLIC_KEY = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";

export interface WarpRegistration {
  warpId: string;
  warpToken: string;
  config: WarpConfig;
}

export class WarpApiError extends Error {
  readonly status: number;
  readonly retryAfterHeader: string | null;
  constructor(message: string, status: number, retryAfterHeader: string | null = null, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
    this.retryAfterHeader = retryAfterHeader;
  }
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader !== null) {
    const asSeconds = Number(retryAfterHeader);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }
  const base = Math.min(5000, 500 * 2 ** attempt);
  const jitter = base * 0.5;
  return base + Math.random() * jitter;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function firstString(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function decodeReserved(clientId: unknown): [number, number, number] | null {
  if (typeof clientId !== "string") return null;
  return decodeReservedTriplet(clientId);
}

function extractConfig(body: unknown): Omit<WarpRegistration, "warpToken"> | null {
  const envelope = asRecord(body);
  if (envelope === null) return null;
  const inner = asRecord(envelope.data) ?? asRecord(envelope.result) ?? envelope;
  const account = asRecord(inner.result) ?? inner;
  const warpId = firstString(account.id, (asRecord(envelope.data)?.id) ?? undefined);
  const configSource = asRecord(account.config) ?? (asRecord(account.interface) !== null ? account : null);
  if (configSource === null) return null;
  const iface = asRecord(configSource.interface) ?? asRecord(account.interface);
  const peerBlock = (asRecord(configSource.peers)?.[0] ?? asRecord(account.peers)?.[0]) ?? null;
  if (iface === null || peerBlock === null) return null;
  const addresses = asRecord(iface.addresses);
  if (addresses === null) return null;
  const ipv4 = firstString(addresses.v4, addresses.ipv4);
  const ipv6 = firstString(addresses.v6, addresses.ipv6);
  if (ipv4 === null) return null;
  const peer = peerBlock as Record<string, unknown>;
  const peerKey = firstString(peer.public_key, peer.publicKey) ?? PEER_PUBLIC_KEY;
  const reserved = decodeReserved(configSource.client_id ?? configSource.clientId ?? account.client_id);
  return {
    warpId: warpId ?? "",
    config: {
      private_key: "",
      public_key: "",
      addresses: { ipv4, ipv6: ipv6 ?? "" },
      peer_public_key: peerKey,
      mtu: 1280,
      reserved: reserved ?? [0, 0, 0],
    },
  };
}

async function postReg(keyPublic: string): Promise<unknown> {
  let lastError: WarpApiError = new WarpApiError("warp api unreachable", 0);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const retryAfter = lastError.retryAfterHeader;
      await new Promise((r) => setTimeout(r, backoffMs(attempt - 1, retryAfter)));
    }
    try {
      const res = await fetch(`${WARP_BASE}/reg`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": WARP_UA,
          "CF-Client-Version": WARP_CLIENT_VERSION,
        },
        body: JSON.stringify({
          key: keyPublic,
          install_id: "",
          fcm_token: "",
          tos: "2021-01-01T00:00:00.000Z",
          model: "PC",
          type: "Windows",
          locale: "en_US",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new WarpApiError("warp api unavailable", res.status, res.headers.get("Retry-After"));
        continue;
      }
      if (!res.ok) {
        throw new WarpApiError(`warp api rejected registration (${res.status})`, res.status);
      }
      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof WarpApiError && err.status < 500 && err.status !== 429) throw err;
      lastError = new WarpApiError(`warp api request failed: ${String(err)}`, 0, null, { cause: err });
    }
  }
  throw lastError;
}

async function deleteReg(warpId: string, warpToken: string): Promise<void> {
  if (warpId.length === 0 || warpToken.length === 0) return;
  await fetch(`${WARP_BASE}/reg/${warpId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${warpToken}`, "User-Agent": WARP_UA, "CF-Client-Version": WARP_CLIENT_VERSION },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {});
}

export async function registerWarpDevice(): Promise<WarpRegistration> {
  const keypair = generateKeypair();
  const body = await postReg(keypair.publicKey);
  const extracted = extractConfig(body);
  if (extracted === null || extracted.warpId.length === 0) {
    throw new WarpApiError("warp api returned an unreadable registration", 502);
  }
  const envelope = asRecord(body);
  const inner = asRecord(envelope?.data) ?? asRecord(envelope?.result) ?? envelope;
  const account = asRecord(inner?.result) ?? inner;
  const warpToken = firstString(account?.token) ?? "";
  if (warpToken.length === 0) {
    await deleteReg(extracted.warpId, "");
    throw new WarpApiError("warp api returned no device token", 502);
  }
  return {
    warpId: extracted.warpId,
    warpToken,
    config: {
      ...extracted.config,
      private_key: keypair.privateKey,
      public_key: keypair.publicKey,
    },
  };
}

export async function removeWarpDevice(warpId: string | null, warpToken: string | null): Promise<void> {
  if (warpId === null || warpToken === null) return;
  await deleteReg(warpId, warpToken);
}
