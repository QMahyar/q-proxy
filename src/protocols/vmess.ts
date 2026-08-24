import { chacha20Poly1305Open, chacha20Poly1305Seal } from "../crypto/chacha20";
import { Shake128 } from "../crypto/shake128";
import {
  concatBytes,
  hexToBytes,
  readU16BE,
  readU32BE,
  u16be,
} from "../utils/bytes";
import { randomBytes } from "../utils/random";
import {
  appendChunk,
  ByteAccumulator,
  dropChunks,
  parseAddressValue,
  peekFlat,
  type BodyCodec,
  type DownlinkEncoder,
  type ParsedRequest,
  type ProtocolInbound,
  type PushOutcome,
} from "./common";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  buildChunkNonce,
  checkAuthId,
  deriveAuthIdEncryptionKey,
  deriveChacha20BodyKey,
  deriveCmdKey,
  deriveResponseBodyKeys,
  fnv1a32,
  openVmessAeadHeader,
  sealVmessAeadResponseHeader,
} from "./vmess-crypto";
import { vmessKdf16 } from "../crypto/kdf";

type VmessRequest = ParsedRequest<"tcp"> | ParsedRequest<"udp">;

const AUTH_ID_LEN = 16;
const CMD_TCP = 1;
const CMD_UDP = 2;
const DNS_PORT = 53;
const SECURITY_UNKNOWN = 0;
const SECURITY_AUTO = 2;
const SECURITY_AES_128_GCM = 3;
const SECURITY_CHACHA20_POLY1305 = 4;
const SECURITY_NONE = 5;
const SECURITY_ZERO = 6;
const LEGACY_HEADER_FIXED_LEN = 38;

export const OPT_CHUNK_STREAM = 0x01;
export const OPT_CHUNK_MASKING = 0x04;
export const OPT_GLOBAL_PADDING = 0x08;
export const OPT_AUTHENTICATED_LENGTH = 0x10;

const AUTH_LEN_SALT = "auth_len";
const TAG_LEN = 16;
const MAX_FRAME_LEN = 0x3fff;
const MAX_ENCODE_PIECE = 0x3800;
const COPY_SLICE = 16384;

type BodyMode = "aes" | "chacha" | "plain";

interface VmessSession {
  requestBodyKey: Uint8Array;
  requestBodyIv: Uint8Array;
  security: number;
  option: number;
}

interface BodyPlan {
  mode: BodyMode;
  framed: boolean;
  masked: boolean;
  padded: boolean;
  authLen: boolean;
}

function planFor(session: VmessSession): BodyPlan | null {
  const mode = resolveMode(session.security);
  if (mode === null) return null;
  const o = session.option;
  const authLen = (o & OPT_AUTHENTICATED_LENGTH) !== 0;
  if (mode === "plain" && authLen) return null;
  return {
    mode,
    framed: (o & OPT_CHUNK_STREAM) !== 0 || mode !== "plain",
    masked: (o & OPT_CHUNK_MASKING) !== 0 && !authLen,
    padded: (o & OPT_GLOBAL_PADDING) !== 0,
    authLen: authLen && mode !== "plain",
  };
}

function resolveMode(security: number): BodyMode | null {
  if (security === SECURITY_AES_128_GCM || security === SECURITY_AUTO) return "aes";
  if (security === SECURITY_CHACHA20_POLY1305) return "chacha";
  if (security === SECURITY_NONE || security === SECURITY_ZERO) return "plain";
  return null;
}

function createShakeDrawer(seed: Uint8Array): () => number {
  const shake = new Shake128(seed);
  const scratch = new Uint8Array(2);
  return () => {
    shake.squeezeInto(scratch, 0, 2);
    return readU16BE(scratch, 0);
  };
}

function bodyKeyFor(mode: BodyMode, base16: Uint8Array): Uint8Array {
  if (mode === "aes") return base16;
  if (mode === "chacha") return deriveChacha20BodyKey(base16);
  return new Uint8Array(0);
}

async function buildLenKeys(
  requestKey: Uint8Array,
  nonceBase: Uint8Array,
  mode: BodyMode,
): Promise<{ key: Uint8Array; base: Uint8Array }> {
  const kdfKey = await vmessKdf16(requestKey, AUTH_LEN_SALT);
  return { key: bodyKeyFor(mode, kdfKey), base: nonceBase };
}

export function createVmessInbound(expectedUuid: string): ProtocolInbound<VmessRequest> {
  const uuidBytes = parseUuid(expectedUuid);
  const cmdKey = uuidBytes === null ? null : deriveCmdKey(uuidBytes);

  let acc = new ByteAccumulator();
  let authIdChecked = false;
  let authIdBytes: Uint8Array | null = null;
  let handshakeDone = false;
  let cachedResponseHeader: Uint8Array | null = null;
  let initialPayload: Uint8Array | null = null;
  let session: VmessSession | null = null;
  let pendingTail: Uint8Array[] = [];

  return {
    async push(data: Uint8Array): Promise<PushOutcome<VmessRequest>> {
      if (handshakeDone) return { state: "reject", reason: "data after completed handshake" };
      if (!acc.append(data)) return { state: "reject", reason: "handshake too large" };
      const buf = acc.drain();

      if (!authIdChecked) {
        if (buf.length < AUTH_ID_LEN) {
          acc.append(buf);
          return { state: "need-more" };
        }
        authIdBytes = buf.slice(0, AUTH_ID_LEN);
        if (cmdKey === null) {
          return complete({ state: "reject", reason: "invalid user" });
        }
        const authIdKey = await deriveAuthIdEncryptionKey(cmdKey);
        const check = checkAuthId(authIdKey, authIdBytes!, Math.floor(Date.now() / 1000));
        if (!check.ok) {
          return complete({ state: "reject", reason: check.reason ?? "invalid user" });
        }
        authIdChecked = true;
      }

      const opened = await openVmessAeadHeader(cmdKey!, authIdBytes!, buf.subarray(AUTH_ID_LEN));
      if (opened.failReason === "need-more") {
        acc.append(buf);
        return { state: "need-more" };
      }
      if (opened.header === null) {
        return complete({ state: "reject", reason: opened.failReason ?? "AEAD open failed" });
      }
      const leftover = buf.subarray(AUTH_ID_LEN + opened.consumedBytes);
      const outcome = await parseLegacyHeader(opened.header);
      if (outcome.state === "ready") {
        for (let off = 0; off < leftover.length; off += COPY_SLICE) {
          pendingTail.push(leftover.subarray(off, Math.min(off + COPY_SLICE, leftover.length)));
        }
      }
      return complete(outcome);
    },
    responseHeader(): Uint8Array | null {
      return cachedResponseHeader;
    },
    takeInitialPayload(): Uint8Array | null {
      const p = initialPayload;
      initialPayload = null;
      return p;
    },
    bodyCodec(): BodyCodec | null {
      if (session === null) return null;
      const plan = planFor(session);
      if (plan === null) return null;
      return createVmessBodyCodec(session, plan, pendingTail);
    },
  };

  function complete<R>(value: R): R {
    handshakeDone = true;
    return value;
  }

  async function parseLegacyHeader(h: Uint8Array): Promise<PushOutcome<VmessRequest>> {
    if (h.length < LEGACY_HEADER_FIXED_LEN) {
      return { state: "reject", reason: "legacy header too short" };
    }
    const requestBodyIv = h.slice(1, 17);
    const requestBodyKey = h.slice(17, 33);
    const responseV = h[33]!;
    const option = h[34]!;
    const security = h[35]! & 0x0f;
    const paddingLen = h[35]! >> 4;
    const command = h[37]!;
    if (security === SECURITY_UNKNOWN) {
      return { state: "reject", reason: `unsupported security type ${security}` };
    }
    if (command !== CMD_TCP && command !== CMD_UDP) {
      return { state: "reject", reason: `unsupported command ${command}` };
    }
    const port = readU16BE(h, LEGACY_HEADER_FIXED_LEN);
    if (port === 0) return { state: "reject", reason: "invalid port 0" };
    const atypeOffset = LEGACY_HEADER_FIXED_LEN + 2;
    const atype = h[atypeOffset]!;
    const addr = parseAddressValue(atype, h, atypeOffset + 1);
    if (!addr.ok) return { state: "reject", reason: addr.reason };
    const paddingOffset = addr.value.nextOffset;
    if (h.length < paddingOffset + paddingLen + 4) {
      return { state: "reject", reason: "truncated padding or checksum" };
    }
    const checksumOffset = paddingOffset + paddingLen;
    const expectedFnv = readU32BE(h, checksumOffset);
    const actualFnv = fnv1a32(h.subarray(0, checksumOffset));
    if (expectedFnv !== actualFnv) {
      return { state: "reject", reason: "invalid auth (checksum mismatch)" };
    }
    if (command === CMD_UDP && port !== DNS_PORT) {
      return { state: "reject", reason: "udp proxy only allowed for port 53" };
    }
    cachedResponseHeader = await sealVmessAeadResponseHeader(
      requestBodyKey,
      requestBodyIv,
      responseV,
      0x00,
    );
    session = { requestBodyKey, requestBodyIv, security, option };
    initialPayload = new Uint8Array(0);
    return {
      state: "ready",
      parsed: {
        command: command === CMD_TCP ? "tcp" : "udp",
        target: { host: addr.value.host, port },
      },
      rest: initialPayload,
    };
  }

  function createVmessBodyCodec(
    s: VmessSession,
    plan: BodyPlan,
    pending: Uint8Array[],
  ): BodyCodec {
    const upDraw =
      plan.padded || plan.masked ? createShakeDrawer(s.requestBodyIv) : null;
    const tagLen = plan.mode === "plain" ? 0 : TAG_LEN;

    let upAlive = true;
    let upEof = false;
    let upPayloadCtr = 0;
    let upSizeCtr = 0;
    let cached: { sizeVal: number; padding: number; sizeFrameLen: number } | null = null;
    let upLenKeys: Promise<{ key: Uint8Array; base: Uint8Array }> | null = plan.authLen
      ? buildLenKeys(s.requestBodyKey, s.requestBodyIv, plan.mode)
      : null;

    async function decodeUp(chunk: Uint8Array): Promise<Uint8Array | null> {
      if (!upAlive) return null;
      if (!plan.framed) return chunk;
      if (upEof) return null;
      if (chunk.length > 0 && !appendChunk(pending, chunk)) {
        upAlive = false;
        return null;
      }
      const parts: Uint8Array[] = [];
      while (true) {
        if (cached === null) {
          const sizeFrameLen = plan.authLen ? 2 + TAG_LEN : 2;
          const head = peekFlat(pending, sizeFrameLen);
          if (head === null) break;
          let padding = 0;
          if (plan.padded && upDraw !== null) padding = upDraw() % 64;
          let sizeVal: number;
          if (upLenKeys !== null) {
            const lenKeys = await upLenKeys;
            const plain = await aesGcmDecrypt(lenKeys.key, buildChunkNonce(lenKeys.base, upSizeCtr), head, null);
            if (plain === null) {
              upAlive = false;
              return null;
            }
            sizeVal = readU16BE(plain, 0) + TAG_LEN;
          } else {
            sizeVal = readU16BE(head, 0);
            if (plan.masked && upDraw !== null) sizeVal ^= upDraw();
          }
          cached = { sizeVal, padding, sizeFrameLen };
        }
        const { sizeVal, padding, sizeFrameLen } = cached;
        if (sizeVal === tagLen + padding) {
          upEof = true;
          return concatBytes(...parts);
        }
        if (sizeVal < tagLen + padding || sizeVal > MAX_FRAME_LEN) {
          upAlive = false;
          return null;
        }
        const frameTotal = sizeFrameLen + sizeVal;
        const whole = peekFlat(pending, frameTotal);
        if (whole === null) break;
        cached = null;
        if (plan.authLen) upSizeCtr++;
        const ct = whole.subarray(sizeFrameLen, frameTotal - padding);
        let data: Uint8Array | null;
        if (plan.mode === "aes") {
          data = await aesGcmDecrypt(s.requestBodyKey, buildChunkNonce(s.requestBodyIv, upPayloadCtr), ct, null);
        } else if (plan.mode === "chacha") {
          data = chacha20Poly1305Open(
            deriveChacha20BodyKey(s.requestBodyKey),
            buildChunkNonce(s.requestBodyIv, upPayloadCtr),
            ct,
            null,
          );
        } else {
          data = ct.slice();
        }
        if (data === null) {
          upAlive = false;
          return null;
        }
        upPayloadCtr++;
        dropChunks(pending, frameTotal);
        parts.push(data);
      }
      return concatBytes(...parts);
    }

    function beginDownlink(): DownlinkEncoder {
      let downPayloadCtr = 0;
      let downSizeCtr = 0;
      let downCache: Promise<{
        bodyKey: Uint8Array;
        nonceBase: Uint8Array;
        lenKeys: { key: Uint8Array; base: Uint8Array } | null;
        draw: (() => number) | null;
      }> | null = null;

      async function ensureDown() {
        if (downCache === null) {
          downCache = (async () => {
            const resp = await deriveResponseBodyKeys(s.requestBodyKey, s.requestBodyIv);
            return {
              bodyKey: bodyKeyFor(plan.mode, resp.key),
              nonceBase: resp.iv,
              lenKeys: plan.authLen
                ? await buildLenKeys(s.requestBodyKey, s.requestBodyIv, plan.mode)
                : null,
              draw: plan.padded || plan.masked ? createShakeDrawer(resp.iv) : null,
            };
          })();
        }
        return downCache;
      }

      return {
        header(): Uint8Array | null {
          return null;
        },
        async encode(chunk: Uint8Array): Promise<Uint8Array> {
          if (!upAlive) throw new Error("uplink failed");
          if (!plan.framed) return chunk.slice();
          if (chunk.length === 0) return new Uint8Array(0);
          const ctx = await ensureDown();
          const parts: Uint8Array[] = [];
          for (let off = 0; off < chunk.length; off += MAX_ENCODE_PIECE) {
            const piece = chunk.subarray(off, Math.min(off + MAX_ENCODE_PIECE, chunk.length));
            let padding = 0;
            if (plan.padded && ctx.draw !== null) padding = ctx.draw() % 64;
            const sizeVal = piece.length + tagLen + padding;
            if (ctx.lenKeys !== null) {
              parts.push(
                await aesGcmEncrypt(
                  ctx.lenKeys.key,
                  buildChunkNonce(ctx.lenKeys.base, downSizeCtr),
                  u16be(sizeVal - TAG_LEN),
                  null,
                ),
              );
              downSizeCtr++;
            } else {
              let v = sizeVal;
              if (plan.masked && ctx.draw !== null) v ^= ctx.draw();
              parts.push(u16be(v));
            }
            parts.push(
              plan.mode === "aes"
                ? await aesGcmEncrypt(ctx.bodyKey, buildChunkNonce(ctx.nonceBase, downPayloadCtr), piece, null)
                : plan.mode === "chacha"
                  ? chacha20Poly1305Seal(ctx.bodyKey, buildChunkNonce(ctx.nonceBase, downPayloadCtr), piece, null)
                  : piece.slice(),
            );
            downPayloadCtr++;
            if (padding > 0) parts.push(randomBytes(padding));
          }
          return concatBytes(...parts);
        },
      };
    }

    return { decodeUp, beginDownlink };
  }
}

function parseUuid(uuid: string): Uint8Array | null {
  const compact = uuid.replaceAll("-", "").toLowerCase();
  if (compact.length !== 32) return null;
  return hexToBytes(compact);
}
