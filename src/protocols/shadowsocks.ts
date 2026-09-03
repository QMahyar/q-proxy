import { chacha20Poly1305Open, chacha20Poly1305Seal } from "../crypto/chacha20";
import { evpBytesToKey, hkdfSha1 } from "../crypto/kdf";
import { aesGcmKeyFor, aesGcmOpenWith, aesGcmSealWith, type AesGcmKey } from "../crypto/aesgcm";
import { pruneBoundedRegistry } from "../utils/bounded";
import { randomBytes } from "../utils/random";
import { concatBytes, bytesToHex, readU16BE, writeU16BE } from "../utils/bytes";
import {
  appendChunk,
  ByteAccumulator,
  dropChunks,
  parseAddress,
  peekFlat,
  type BodyCodec,
  type DownlinkEncoder,
  type ParsedRequest,
  type ProtocolInbound,
  type PushOutcome,
} from "./common";

type SsRequest = ParsedRequest<"tcp"> | ParsedRequest<"udp">;

const SUBKEY_INFO = "ss-subkey";
const MAX_CHUNK_LEN = 0x3fff;
const TAG_LEN = 16;
const LEN_FRAME_LEN = 2 + TAG_LEN;
const COPY_SLICE = 16384;

const SALT_REUSE_TTL_SECONDS = 600;
const SALT_REGISTRY_LIMIT = 2048;

const seenSalts = new Map<string, number>();

export function clearSaltRegistry(): void {
  seenSalts.clear();
}

export function createSSInbound(
  method: "aes-128-gcm" | "aes-256-gcm" | "chacha20-ietf-poly1305",
  password: string,
): ProtocolInbound<SsRequest> {
  const keyLen = method === "aes-128-gcm" ? 16 : 32;
  const masterKey = evpBytesToKey(password, keyLen);
  const subkeyInfo = new TextEncoder().encode(SUBKEY_INFO);
  const isChacha = method === "chacha20-ietf-poly1305";

  let acc = new ByteAccumulator();
  let subkey: Uint8Array | null = null;
  let pendingSaltKey: string | null = null;
  let handshakeDone = false;
  let handshakeOk = false;
  let initialPayload: Uint8Array | null = null;
  const upState = { counter: 0 };
  let pendingBody: Uint8Array[] = [];

  const rollbackSalt = (): void => {
    if (subkey !== null && pendingSaltKey !== null) {
      seenSalts.delete(pendingSaltKey);
      subkey = null;
      pendingSaltKey = null;
    }
  };

  return {
    async push(data: Uint8Array): Promise<PushOutcome<SsRequest>> {
      if (handshakeDone) return { state: "reject", reason: "data after completed handshake" };
      if (!acc.append(data)) return { state: "reject", reason: "handshake too large" };
      const buf = acc.drain();

      if (subkey === null) {
        if (buf.length < keyLen) {
          acc.append(buf);
          return { state: "need-more" };
        }
        const salt = buf.slice(0, keyLen);
        const nowSec = Math.floor(Date.now() / 1000);
        const saltKey = `${bytesToHex(masterKey)}:${bytesToHex(salt)}`;
        const expiry = seenSalts.get(saltKey);
        if (expiry !== undefined && expiry > nowSec) {
          return complete({ state: "reject", reason: "salt reuse detected" });
        }
        pruneBoundedRegistry(seenSalts, SALT_REGISTRY_LIMIT - 1, nowSec);
        seenSalts.set(saltKey, nowSec + SALT_REUSE_TTL_SECONDS);
        subkey = await hkdfSha1(masterKey, salt, subkeyInfo, keyLen);
        pendingSaltKey = saltKey;
      }
      const stream = buf.subarray(keyLen);

      if (stream.length < LEN_FRAME_LEN) {
        acc.append(buf);
        return { state: "need-more" };
      }
      upState.counter = 0;
      const upCipher = createFrameCipher(frameKeyFor(subkey!, isChacha, "decrypt"), isChacha);
      const lenFrame = await upCipher.open(upState.counter++, stream.subarray(0, LEN_FRAME_LEN));
      if (lenFrame === null || lenFrame.length !== 2) {
        rollbackSalt();
        return complete({ state: "reject", reason: "length chunk decrypt failed" });
      }
      const chunkLen = readU16BE(lenFrame, 0);
      if (chunkLen === 0 || chunkLen > MAX_CHUNK_LEN) {
        rollbackSalt();
        return complete({ state: "reject", reason: `invalid chunk length ${chunkLen}` });
      }

      const payloadFrameLen = chunkLen + TAG_LEN;
      if (stream.length - LEN_FRAME_LEN < payloadFrameLen) {
        acc.append(buf);
        return { state: "need-more" };
      }
      const payloadFrame = await upCipher.open(
        upState.counter++,
        stream.subarray(LEN_FRAME_LEN, LEN_FRAME_LEN + payloadFrameLen),
      );
      if (payloadFrame === null || payloadFrame.length !== chunkLen) {
        rollbackSalt();
        return complete({ state: "reject", reason: "payload chunk decrypt failed" });
      }

      if (payloadFrame.length < 1) {
        rollbackSalt();
        return complete({ state: "reject", reason: "missing target header" });
      }
      const target = parseAddress(payloadFrame[0]!, payloadFrame, 1);
      if (!target.ok) {
        rollbackSalt();
        return complete({ state: "reject", reason: target.reason });
      }

      initialPayload = payloadFrame.subarray(target.value.nextOffset);
      pendingBody = [];
      for (let off = LEN_FRAME_LEN + payloadFrameLen; off < stream.length; off += COPY_SLICE) {
        pendingBody.push(stream.subarray(off, Math.min(off + COPY_SLICE, stream.length)));
      }
      handshakeOk = true;
      return complete({
        state: "ready",
        parsed: {
          command: "tcp",
          target: { host: target.value.host, port: target.value.port },
        },
        rest: initialPayload,
      });
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
      if (!handshakeOk || subkey === null) return null;
      return createSsBodyCodec(
        masterKey,
        subkeyInfo,
        keyLen,
        subkey,
        upState,
        pendingBody,
        isChacha,
      );
    },
  };

  function complete<R>(value: R): R {
    handshakeDone = true;
    return value;
  }
}

function createSsBodyCodec(
  masterKey: Uint8Array,
  subkeyInfo: Uint8Array,
  keyLen: number,
  upSubkey: Uint8Array,
  upState: { counter: number },
  pending: Uint8Array[],
  isChacha: boolean,
): BodyCodec {
  const upKey = frameKeyFor(upSubkey, isChacha, "decrypt");
  const upCipher = createFrameCipher(upKey, isChacha);
  return {
    async decodeUp(chunk: Uint8Array): Promise<Uint8Array | null> {
      if (chunk.length > 0 && !appendChunk(pending, chunk)) {
        throw new Error("ss uplink frame buffer exceeded 64 KiB cap");
      }
      const parts: Uint8Array[] = [];
      while (true) {
        const lenFrameBytes = peekFlat(pending, LEN_FRAME_LEN);
        if (lenFrameBytes === null) break;
        const lenFrame = await upCipher.open(upState.counter, lenFrameBytes);
        if (lenFrame === null || lenFrame.length !== 2) {
          throw new Error("ss uplink length frame failed to decrypt");
        }
        const chunkLen = readU16BE(lenFrame, 0);
        if (chunkLen > MAX_CHUNK_LEN) {
          throw new Error("ss uplink length frame exceeds chunk cap");
        }
        const frameLen = LEN_FRAME_LEN + chunkLen + TAG_LEN;
        const wholeFrame = peekFlat(pending, frameLen);
        if (wholeFrame === null) break;
        const payload = await upCipher.open(
          upState.counter + 1,
          wholeFrame.subarray(LEN_FRAME_LEN),
        );
        if (payload === null || payload.length !== chunkLen) {
          throw new Error("ss uplink payload frame failed to decrypt");
        }
        dropChunks(pending, frameLen);
        upState.counter += 2;
        if (chunkLen === 0) continue;
        parts.push(payload);
      }
      return concatBytes(...parts);
    },
    beginDownlink(): DownlinkEncoder {
      const salt = randomBytes(keyLen);
      const downKey: FrameKey = { raw: new Uint8Array(0), aes: null };
      const ready = (async () => {
        const sk = await hkdfSha1(masterKey, salt, subkeyInfo, keyLen);
        downKey.raw = sk;
        downKey.aes = isChacha ? null : aesGcmKeyFor(sk, "encrypt");
      })();
      let counter = 0;
      const downCipher = createFrameCipher(downKey, isChacha);
      return {
        header(): Uint8Array | null {
          return salt;
        },
        async encode(chunk: Uint8Array): Promise<Uint8Array> {
          await ready;
          if (chunk.length === 0) return new Uint8Array(0);
          const parts: Uint8Array[] = [];
          for (let off = 0; off < chunk.length; off += MAX_CHUNK_LEN) {
            const piece = chunk.subarray(off, Math.min(off + MAX_CHUNK_LEN, chunk.length));
            const lenPlain = new Uint8Array(2);
            writeU16BE(lenPlain, 0, piece.length);
            parts.push(await downCipher.seal(counter++, lenPlain));
            parts.push(await downCipher.seal(counter++, piece));
          }
          return concatBytes(...parts);
        },
      };
    },
  };
}

interface FrameKey {
  raw: Uint8Array;
  aes: Promise<AesGcmKey> | null;
}

interface FrameCipher {
  open(counter: number, frame: Uint8Array): Promise<Uint8Array | null>;
  seal(counter: number, plaintext: Uint8Array): Promise<Uint8Array>;
}

function frameKeyFor(subkey: Uint8Array, isChacha: boolean, usage: "encrypt" | "decrypt"): FrameKey {
  return { raw: subkey, aes: isChacha ? null : aesGcmKeyFor(subkey, usage) };
}

function createFrameCipher(key: FrameKey, isChacha: boolean): FrameCipher {
  return {
    async open(counter: number, frame: Uint8Array): Promise<Uint8Array | null> {
      const nonce = buildNonce(counter);
      if (isChacha) return chacha20Poly1305Open(key.raw, nonce, frame, null);
      return aesGcmOpenWith((await key.aes)!, nonce, frame, null);
    },
    async seal(counter: number, plaintext: Uint8Array): Promise<Uint8Array> {
      const nonce = buildNonce(counter);
      if (isChacha) return chacha20Poly1305Seal(key.raw, nonce, plaintext, null);
      return aesGcmSealWith((await key.aes)!, nonce, plaintext, null);
    },
  };
}

function buildNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  for (let i = 0; i < 8; i++) {
    nonce[i] = counter & 0xff;
    counter >>>= 8;
  }
  return nonce;
}