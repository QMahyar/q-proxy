import { bytesToHex, hexToBytes, utf8Encode } from "../utils/bytes";
import { constantTimeEqual, randomHex } from "../utils/random";

export const PBKDF2_ITERATIONS = 100_000;
export const LEGACY_PBKDF2_ITERATIONS = 15_000;
export const PBKDF2_HASH = "SHA-256";
const KEY_BITS = 256;

async function derivePepperInput(password: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8Encode(password));
  return bytesToHex(new Uint8Array(sig));
}

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

export async function hashPassword(
  password: string,
  pepper = "",
): Promise<{ hash: string; salt: string }> {
  const salt = randomHex(16);
  const input = pepper.length > 0 ? await derivePepperInput(password, pepper) : password;
  const hash = await deriveBits(input, salt, PBKDF2_ITERATIONS);
  return { hash, salt };
}

export interface PasswordVerifyResult {
  ok: boolean;
  tier: "current" | "legacy";
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
  pepper = "",
): Promise<PasswordVerifyResult> {
  const reject: PasswordVerifyResult = { ok: false, tier: "current" };
  if (hash.length !== KEY_BITS / 4) return reject;
  if (hexToBytes(salt) === null || hexToBytes(hash) === null) return reject;
  if (pepper.length > 0) {
    const peppered = await derivePepperInput(password, pepper);
    const candidate = await deriveBits(peppered, salt, PBKDF2_ITERATIONS);
    if (constantTimeEqual(candidate, hash)) return { ok: true, tier: "current" };
  }
  const legacy = await deriveBits(password, salt, LEGACY_PBKDF2_ITERATIONS);
  if (constantTimeEqual(legacy, hash)) return { ok: true, tier: "legacy" };
  const candidate = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  if (constantTimeEqual(candidate, hash)) return { ok: true, tier: "legacy" };
  return reject;
}
