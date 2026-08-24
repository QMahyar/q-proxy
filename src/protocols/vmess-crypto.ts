import { Aes128 } from "../crypto/aes";
import { md5 } from "../crypto/md5";
import { vmessKdf, vmessKdf16 } from "../crypto/kdf";
import { concatBytes, readU16BE, readU32BE, writeU16BE } from "../utils/bytes";
import { randomBytes } from "../utils/random";

const KDF_SALT_AUTH_ID_ENCRYPTION = "AES Auth ID Encryption";
const KDF_SALT_HEADER_PAYLOAD_AEAD_KEY = "VMess Header AEAD Key";
const KDF_SALT_HEADER_PAYLOAD_AEAD_IV = "VMess Header AEAD Nonce";
const KDF_SALT_HEADER_PAYLOAD_LEN_AEAD_KEY = "VMess Header AEAD Key_Length";
const KDF_SALT_HEADER_PAYLOAD_LEN_AEAD_IV = "VMess Header AEAD Nonce_Length";
const KDF_SALT_RESP_HEADER_LEN_KEY = "AEAD Resp Header Len Key";
const KDF_SALT_RESP_HEADER_LEN_IV = "AEAD Resp Header Len IV";
const KDF_SALT_RESP_HEADER_PAYLOAD_KEY = "AEAD Resp Header Key";
const KDF_SALT_RESP_HEADER_PAYLOAD_IV = "AEAD Resp Header IV";

export const AUTH_ID_EPOCH_WINDOW_SECONDS = 120;
const AUTH_TIME_DRAIN_BYTES = 16 + 38;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function fnv1a32(data: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

async function aesGcmEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array | null,
): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
  const params: { name: "AES-GCM"; iv: Uint8Array; tagLength: number; additionalData?: Uint8Array } =
    { name: "AES-GCM", iv: nonce, tagLength: 128 };
  if (aad) params.additionalData = aad;
  return new Uint8Array(await crypto.subtle.encrypt(params, ck, plaintext as BufferSource));
}

export { aesGcmEncrypt };

export async function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array | null,
): Promise<Uint8Array | null> {
  try {
    const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [
      "decrypt",
    ]);
    const params: {
      name: "AES-GCM";
      iv: Uint8Array;
      tagLength: number;
      additionalData?: Uint8Array;
    } = { name: "AES-GCM", iv: nonce, tagLength: 128 };
    if (aad) params.additionalData = aad;
    return new Uint8Array(await crypto.subtle.decrypt(params, ck, ciphertext as BufferSource));
  } catch {
    return null;
  }
}

const CMD_KEY_SALT = "c48619fe-8f02-49e0-b9e9-edf763e17e21";

export function deriveCmdKey(uuidBytes: Uint8Array): Uint8Array {
  const digest = md5(concatBytes(uuidBytes, utf8Encode(CMD_KEY_SALT)));
  return digest.subarray(0, 16).slice();
}

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export async function deriveAuthIdEncryptionKey(cmdKey: Uint8Array): Promise<Uint8Array> {
  return vmessKdf16(cmdKey, KDF_SALT_AUTH_ID_ENCRYPTION);
}

export interface AuthIdParts {
  epochSeconds: number;
}

export function createAuthId(
  authIdKey: Uint8Array,
  epochSeconds: number,
  rand?: Uint8Array,
): Uint8Array {
  const inner = new Uint8Array(12);
  const dv = new DataView(inner.buffer);
  dv.setUint32(0, Math.floor(epochSeconds / 4294967296));
  dv.setUint32(4, epochSeconds >>> 0);
  inner.set(rand ?? randomBytes(4), 8);
  const crc = crc32(inner);
  const full = new Uint8Array(16);
  full.set(inner);
  new DataView(full.buffer).setUint32(12, crc);
  const cipher = new Aes128(authIdKey);
  return cipher.encryptBlock(full);
}

export interface AuthIdCheckResult {
  ok: boolean;
  reason?: string;
  epochSeconds?: number;
}

export function checkAuthId(
  authIdKey: Uint8Array,
  authId: Uint8Array,
  nowEpochSeconds: number,
): AuthIdCheckResult {
  if (authId.length !== 16) return { ok: false, reason: "invalid auth id length" };
  const cipher = new Aes128(authIdKey);
  const plain = cipher.decryptBlock(authId);
  const tHigh = readU32BE(plain, 0);
  const tLow = readU32BE(plain, 4);
  const seconds = tHigh * 4294967296 + tLow;
  const storedCrc = readU32BE(plain, 12);
  const computedCrc = crc32(plain.subarray(0, 12));
  if (storedCrc !== computedCrc) return { ok: false, reason: "auth id crc mismatch" };
  if (Math.abs(seconds - nowEpochSeconds) > AUTH_ID_EPOCH_WINDOW_SECONDS) {
    return { ok: false, reason: "auth id expired or not yet valid" };
  }
  return { ok: true, epochSeconds: seconds };
}

export interface OpenAeadHeaderResult {
  header: Uint8Array | null;
  failReason: string | null;
  consumedBytes: number;
}

export async function openVmessAeadHeader(
  cmdKey: Uint8Array,
  authId: Uint8Array,
  data: Uint8Array,
): Promise<OpenAeadHeaderResult> {
  if (data.length < 18 + 8) {
    return { header: null, failReason: "need-more", consumedBytes: data.length };
  }
  const sealedLengthFrame = data.subarray(0, 18);
  const nonce = data.subarray(18, 26);

  const lenKey = await vmessKdf16(
    cmdKey,
    KDF_SALT_HEADER_PAYLOAD_LEN_AEAD_KEY,
    authId,
    nonce,
  );
  const lenIv = (await vmessKdf(cmdKey, KDF_SALT_HEADER_PAYLOAD_LEN_AEAD_IV, authId, nonce)).subarray(0, 12).slice();
  const decryptedLen = await aesGcmDecrypt(lenKey, lenIv, sealedLengthFrame, authId);
  if (decryptedLen === null || decryptedLen.length !== 2) {
    return { header: null, failReason: "AEAD header length decrypt failed", consumedBytes: Math.min(data.length, AUTH_TIME_DRAIN_BYTES) };
  }
  const payloadLength = readU16BE(decryptedLen, 0);

  const payloadFrameSize = payloadLength + 16;
  const totalNeeded = 26 + payloadFrameSize;
  if (data.length < totalNeeded) {
    return { header: null, failReason: "need-more", consumedBytes: data.length };
  }

  const payloadKey = await vmessKdf16(cmdKey, KDF_SALT_HEADER_PAYLOAD_AEAD_KEY, authId, nonce);
  const payloadIv = (await vmessKdf(cmdKey, KDF_SALT_HEADER_PAYLOAD_AEAD_IV, authId, nonce)).subarray(0, 12).slice();
  const sealedPayload = data.subarray(26, totalNeeded);
  const payload = await aesGcmDecrypt(payloadKey, payloadIv, sealedPayload, authId);
  if (payload === null) {
    return { header: null, failReason: "AEAD header payload decrypt failed", consumedBytes: totalNeeded };
  }
  return { header: payload, failReason: null, consumedBytes: totalNeeded };
}

export async function sealVmessAeadHeader(
  cmdKey: Uint8Array,
  legacyHeader: Uint8Array,
  nowEpochSeconds: number,
  rand?: Uint8Array,
): Promise<Uint8Array> {
  const authIdKey = await deriveAuthIdEncryptionKey(cmdKey);
  const authId = createAuthId(authIdKey, nowEpochSeconds, rand?.subarray(0, 4));
  const connectionNonce = rand ? rand.subarray(4, 12) : randomBytes(8);

  const lenKey = await vmessKdf16(cmdKey, KDF_SALT_HEADER_PAYLOAD_LEN_AEAD_KEY, authId, connectionNonce);
  const lenIv = (await vmessKdf(cmdKey, KDF_SALT_HEADER_PAYLOAD_LEN_AEAD_IV, authId, connectionNonce)).subarray(0, 12).slice();
  const lenBuf = new Uint8Array(2);
  writeU16BE(lenBuf, 0, legacyHeader.length);
  const sealedLen = await aesGcmEncrypt(lenKey, lenIv, lenBuf, authId);

  const payloadKey = await vmessKdf16(cmdKey, KDF_SALT_HEADER_PAYLOAD_AEAD_KEY, authId, connectionNonce);
  const payloadIv = (await vmessKdf(cmdKey, KDF_SALT_HEADER_PAYLOAD_AEAD_IV, authId, connectionNonce)).subarray(0, 12).slice();
  const sealedPayload = await aesGcmEncrypt(payloadKey, payloadIv, legacyHeader, authId);

  return concatBytes(authId, sealedLen, connectionNonce, sealedPayload);
}

export async function sealVmessAeadResponseHeader(
  requestBodyKey: Uint8Array,
  requestBodyIv: Uint8Array,
  responseV: number,
  responseOption = 0x00,
): Promise<Uint8Array> {
  const respBodyKey = await sha256First16(requestBodyKey);
  const respBodyIv = await sha256First16(requestBodyIv);

  const lenKey = await vmessKdf16(respBodyKey, KDF_SALT_RESP_HEADER_LEN_KEY);
  const lenIv = (await vmessKdf(respBodyIv, KDF_SALT_RESP_HEADER_LEN_IV)).subarray(0, 12).slice();

  const payload = new Uint8Array([responseV, responseOption, 0x00, 0x00]);
  const lenBuf = new Uint8Array(2);
  writeU16BE(lenBuf, 0, payload.length);
  const sealedLen = await aesGcmEncrypt(lenKey, lenIv, lenBuf, null);

  const payloadKey = await vmessKdf16(respBodyKey, KDF_SALT_RESP_HEADER_PAYLOAD_KEY);
  const payloadIv = (await vmessKdf(respBodyIv, KDF_SALT_RESP_HEADER_PAYLOAD_IV)).subarray(0, 12).slice();
  const sealedPayload = await aesGcmEncrypt(payloadKey, payloadIv, payload, null);

  return concatBytes(sealedLen, sealedPayload);
}

async function sha256First16(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(digest).subarray(0, 16).slice();
}

export interface ResponseBodyKeys {
  key: Uint8Array;
  iv: Uint8Array;
}

export async function deriveResponseBodyKeys(
  requestBodyKey: Uint8Array,
  requestBodyIv: Uint8Array,
): Promise<ResponseBodyKeys> {
  return {
    key: await sha256First16(requestBodyKey),
    iv: await sha256First16(requestBodyIv),
  };
}

export function deriveChacha20BodyKey(base16: Uint8Array): Uint8Array {
  const first = md5(base16);
  return concatBytes(first, md5(first));
}

export function buildChunkNonce(iv16: Uint8Array, counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  writeU16BE(nonce, 0, counter & 0xffff);
  nonce.set(iv16.subarray(2, 12), 2);
  return nonce;
}
