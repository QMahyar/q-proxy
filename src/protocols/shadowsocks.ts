import { evpBytesToKey, hkdfSha1 } from "../crypto/kdf";
import { randomBytes } from "../utils/random";
import { concatBytes, readU16BE, writeU16BE } from "../utils/bytes";
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

export function createSSInbound(
  method: "aes-128-gcm" | "aes-256-gcm",
  password: string,
): ProtocolInbound<SsRequest> {
  const keyLen = method === "aes-128-gcm" ? 16 : 32;
  const masterKey = evpBytesToKey(password, keyLen);
  const subkeyInfo = new TextEncoder().encode(SUBKEY_INFO);

  let acc = new ByteAccumulator();
  let subkey: Uint8Array | null = null;
  let handshakeDone = false;
  let handshakeOk = false;
  let initialPayload: Uint8Array | null = null;
  const upState = { counter: 0 };
  let pendingBody: Uint8Array[] = [];

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
        subkey = await hkdfSha1(masterKey, salt, subkeyInfo, keyLen);
      }
      const stream = buf.subarray(keyLen);

      if (stream.length < LEN_FRAME_LEN) {
        acc.append(buf);
        return { state: "need-more" };
      }
      upState.counter = 0;
      const lenFrame = await openFrame(subkey, upState.counter++, stream.subarray(0, LEN_FRAME_LEN));
      if (lenFrame === null || lenFrame.length !== 2) {
        return complete({ state: "reject", reason: "length chunk decrypt failed" });
      }
      const chunkLen = readU16BE(lenFrame, 0);
      if (chunkLen === 0 || chunkLen > MAX_CHUNK_LEN) {
        return complete({ state: "reject", reason: `invalid chunk length ${chunkLen}` });
      }

      const payloadFrameLen = chunkLen + TAG_LEN;
      if (stream.length - LEN_FRAME_LEN < payloadFrameLen) {
        acc.append(buf);
        return { state: "need-more" };
      }
      const payloadFrame = await openFrame(
        subkey,
        upState.counter++,
        stream.subarray(LEN_FRAME_LEN, LEN_FRAME_LEN + payloadFrameLen),
      );
      if (payloadFrame === null || payloadFrame.length !== chunkLen) {
        return complete({ state: "reject", reason: "payload chunk decrypt failed" });
      }

      if (payloadFrame.length < 1) {
        return complete({ state: "reject", reason: "missing target header" });
      }
      const target = parseAddress(payloadFrame[0]!, payloadFrame, 1);
      if (!target.ok) return complete({ state: "reject", reason: target.reason });

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
      return createSsBodyCodec(masterKey, subkeyInfo, keyLen, subkey, upState, pendingBody);
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
): BodyCodec {
  let upAlive = true;
  return {
    async decodeUp(chunk: Uint8Array): Promise<Uint8Array | null> {
      if (!upAlive) return null;
      if (chunk.length > 0 && !appendChunk(pending, chunk)) {
        upAlive = false;
        return null;
      }
      const parts: Uint8Array[] = [];
      while (true) {
        const lenFrameBytes = peekFlat(pending, LEN_FRAME_LEN);
        if (lenFrameBytes === null) break;
        const lenFrame = await openFrame(upSubkey, upState.counter, lenFrameBytes);
        if (lenFrame === null || lenFrame.length !== 2) {
          upAlive = false;
          return null;
        }
        const chunkLen = readU16BE(lenFrame, 0);
        if (chunkLen === 0 || chunkLen > MAX_CHUNK_LEN) {
          upAlive = false;
          return null;
        }
        const frameLen = LEN_FRAME_LEN + chunkLen + TAG_LEN;
        const wholeFrame = peekFlat(pending, frameLen);
        if (wholeFrame === null) break;
        const payload = await openFrame(upSubkey, upState.counter + 1, wholeFrame.subarray(LEN_FRAME_LEN));
        if (payload === null || payload.length !== chunkLen) {
          upAlive = false;
          return null;
        }
        dropChunks(pending, frameLen);
        upState.counter += 2;
        parts.push(payload);
      }
      return concatBytes(...parts);
    },
    beginDownlink(): DownlinkEncoder {
      const salt = randomBytes(keyLen);
      const downSubkeyPromise = hkdfSha1(masterKey, salt, subkeyInfo, keyLen);
      let counter = 0;
      return {
        header(): Uint8Array | null {
          return salt;
        },
        async encode(chunk: Uint8Array): Promise<Uint8Array> {
          const sk = await downSubkeyPromise;
          if (chunk.length === 0) return new Uint8Array(0);
          const parts: Uint8Array[] = [];
          for (let off = 0; off < chunk.length; off += MAX_CHUNK_LEN) {
            const piece = chunk.subarray(off, Math.min(off + MAX_CHUNK_LEN, chunk.length));
            const lenPlain = new Uint8Array(2);
            writeU16BE(lenPlain, 0, piece.length);
            parts.push(await sealFrame(sk, counter++, lenPlain));
            parts.push(await sealFrame(sk, counter++, piece));
          }
          return concatBytes(...parts);
        },
      };
    },
  };
}

async function openFrame(
  subkey: Uint8Array,
  counter: number,
  frame: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const ck = await crypto.subtle.importKey("raw", subkey as BufferSource, "AES-GCM", false, [
      "decrypt",
    ]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buildNonce(counter) as BufferSource, tagLength: 128 },
      ck,
      frame as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

async function sealFrame(
  subkey: Uint8Array,
  counter: number,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", subkey as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: buildNonce(counter) as BufferSource, tagLength: 128 },
      ck,
      plaintext as BufferSource,
    ),
  );
}

function buildNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  for (let i = 0; i < 8; i++) {
    nonce[i] = Math.floor(counter / 256 ** i) & 0xff;
  }
  return nonce;
}
