import { bytesToHex, hexToBytes, utf8Encode } from "../utils/bytes";
import { constantTimeEqual, randomHex } from "../utils/random";

export const PBKDF2_ITERATIONS = 100_000;
export const LEGACY_PBKDF2_ITERATIONS = 15_000;
export const PBKDF2_HASH = "SHA-256";
const KEY_BITS = 256;

async function deriveBits(password: string, salt: string, iterations: number): Promise<string> {
  const saltBytes = hexToBytes(salt);
  if (saltBytes === null) throw new Error("invalid salt encoding");
  const key = await crypto.subtle.importKey("raw", utf8Encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt: saltBytes, iterations },
    key,
    KEY_BITS,
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomHex(16);
  const hash = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return { hash, salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  if (hash.length !== KEY_BITS / 4) return false;
  if (hexToBytes(salt) === null || hexToBytes(hash) === null) return false;
  const candidate = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  if (constantTimeEqual(candidate, hash)) return true;
  const legacy = await deriveBits(password, salt, LEGACY_PBKDF2_ITERATIONS);
  return constantTimeEqual(legacy, hash);
}
