import { concatBytes, u16be } from "../utils/bytes";
import type { ShadowsocksMethod } from "../types/settings";
import {
  ByteAccumulator,
  parseAddress,
  type BodyCodec,
  type DownlinkEncoder,
  type ParsedRequest,
  type ProtocolInbound,
  type PushOutcome,
} from "./common";

type ShadowsocksRequest = ParsedRequest<"tcp">;

const SALT_LEN: Record<Exclude<ShadowsocksMethod, "chacha20-ietf-poly1305">, number> = {
  "aes-128-gcm": 16,
  "aes-256-gcm": 32,
};
const KEY_LEN = SALT_LEN;
const TAG_LEN = 16;

function nonceFor(counter: number): Uint8Array {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setUint32(8, counter);
  return out;
}

async function deriveSubkey(password: string, salt: Uint8Array, keyLen: number): Promise<CryptoKey | null> {
  try {
    const te = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", te.encode(password), { name: "HKDF" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-1", salt: salt as BufferSource, info: te.encode("ss-subkey") },
      base,
      keyLen * 8,
    );
    return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

async function openChunk(key: CryptoKey, counter: number, data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonceFor(counter) as BufferSource },
      key,
      data as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

async function sealChunk(key: CryptoKey, counter: number, plain: Uint8Array): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceFor(counter) as BufferSource },
    key,
    plain as BufferSource,
  );
  return new Uint8Array(ct);
}

// Shadowsocks AEAD TCP inbound (aes-*-gcm via WebCrypto). The stream opens
// with salt + E(len) + E(addr+payload); follow-up chunks decrypt with
// incrementing nonces. UDP has no handshake marker on this path, so only
// TCP is served (DNS still flows over vless/trojan UDP or DoH).
export function createShadowsocksInbound(method: ShadowsocksMethod, password: string): ProtocolInbound<ShadowsocksRequest> {
  let acc = new ByteAccumulator();
  let done = false;
  let initialPayload: Uint8Array | null = null;
  let sessionKey: CryptoKey | null = null;
  let nextNonce = 0;

  return {
    async push(data: Uint8Array): Promise<PushOutcome<ShadowsocksRequest>> {
      if (done) return { state: "reject", reason: "data after completed handshake" };
      if (!acc.append(data)) return { state: "reject", reason: "handshake too large" };
      const buf = acc.drain();
      const outcome = await tryParse(buf);
      if (outcome.state === "need-more") {
        acc.append(buf);
        return outcome;
      }
      done = true;
      return outcome;
    },
    responseHeader(): Uint8Array | null {
      return null;
    },
    takeInitialPayload(): Uint8Array | null {
      const p = initialPayload;
      initialPayload = null;
      return p;
    },
    bodyCodec(): BodyCodec | null {
      if (!done || sessionKey === null) return null;
      const key = sessionKey;
      const saltLen = (SALT_LEN as Record<string, number>)[method] ?? 16;
      const keyLen = (KEY_LEN as Record<string, number>)[method] ?? 16;
      let counter = nextNonce;
      let buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
      let downSalt: Uint8Array | null = null;
      let downKey: CryptoKey | null = null;
      let downCounter = 0;
      const downEncoder: DownlinkEncoder = {
        header(): Uint8Array | null {
          return null;
        },
        async encode(chunk: Uint8Array): Promise<Uint8Array> {
          if (downSalt === null || downKey === null) {
            downSalt = crypto.getRandomValues(new Uint8Array(saltLen));
            const derived = await deriveSubkey(password, downSalt, keyLen);
            if (derived === null) throw new Error("cipher unavailable");
            downKey = derived;
            downCounter = 0;
          }
          const encLen = await sealChunk(downKey, downCounter, u16be(chunk.length));
          const encBody = await sealChunk(downKey, downCounter + 1, chunk);
          downCounter += 2;
          // The salt opens the server stream exactly once.
          if (downCounter === 2) return concatBytes(downSalt, encLen, encBody);
          return concatBytes(encLen, encBody);
        },
      };
      return {
        async decodeUp(chunk: Uint8Array): Promise<Uint8Array | null> {
          buf = concatBytes(buf as Uint8Array, chunk as Uint8Array) as Uint8Array<ArrayBufferLike>;
          const parts: Uint8Array[] = [];
          for (;;) {
            if (buf.length < 2 + TAG_LEN) break;
            const lenBytes = await openChunk(key, counter, buf.subarray(0, 2 + TAG_LEN));
            if (lenBytes === null || lenBytes.length !== 2) break;
            const len = (lenBytes[0]! << 8) | lenBytes[1]!;
            if (buf.length < 2 + TAG_LEN + len + TAG_LEN) break;
            const body = await openChunk(key, counter + 1, buf.subarray(2 + TAG_LEN, 2 + TAG_LEN + len + TAG_LEN));
            if (body === null) break;
            counter += 2;
            buf = buf.subarray(2 + TAG_LEN + len + TAG_LEN);
            parts.push(body);
          }
          if (parts.length === 0) return new Uint8Array(0);
          return parts.length === 1 ? parts[0]! : concatBytes(...parts);
        },
        beginDownlink(): DownlinkEncoder {
          return downEncoder;
        },
      };
    },
  };

  async function tryParse(buf: Uint8Array): Promise<PushOutcome<ShadowsocksRequest>> {
    const saltLen = (SALT_LEN as Record<string, number>)[method];
    if (saltLen === undefined) return { state: "reject", reason: "unsupported cipher" };
    if (buf.length < saltLen + 2 + TAG_LEN) return { state: "need-more" };
    const salt = buf.subarray(0, saltLen);
    const key = await deriveSubkey(password, salt, KEY_LEN[method as keyof typeof KEY_LEN]!);
    if (key === null) return { state: "reject", reason: "cipher unavailable" };
    const lenBytes = await openChunk(key, 0, buf.subarray(saltLen, saltLen + 2 + TAG_LEN));
    if (lenBytes === null || lenBytes.length !== 2) return { state: "reject", reason: "invalid user" };
    const len = (lenBytes[0]! << 8) | lenBytes[1]!;
    if (len === 0 || buf.length < saltLen + 2 + TAG_LEN + len + TAG_LEN) {
      if (len === 0) return { state: "reject", reason: "invalid opening length" };
      return { state: "need-more" };
    }
    const body = await openChunk(key, 1, buf.subarray(saltLen + 2 + TAG_LEN, saltLen + 2 + TAG_LEN + len + TAG_LEN));
    if (body === null) return { state: "reject", reason: "invalid user" };
    const addr = parseAddress(body[0]!, body, 1);
    if (!addr.ok) return { state: "reject", reason: addr.reason };
    sessionKey = key;
    nextNonce = 2;
    initialPayload = body.subarray(addr.value.nextOffset);
    return {
      state: "ready",
      parsed: { command: "tcp", target: { host: addr.value.host, port: addr.value.port } },
      rest: initialPayload,
    };
  }
}
