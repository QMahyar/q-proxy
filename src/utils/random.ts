export const ALNUM_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const TROJAN_PASSWORD_EXTRA = "!@$&*_-+.";
export const TROJAN_PASSWORD_CHARSET = ALNUM_CHARSET + TROJAN_PASSWORD_EXTRA;

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function randomHex(byteLength: number): string {
  let s = "";
  const bytes = randomBytes(byteLength);
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, "0");
  return s;
}

export function randomString(length: number, charset: string = ALNUM_CHARSET): string {
  const bytes = randomBytes(length);
  let s = "";
  for (let i = 0; i < length; i++) s += charset[bytes[i]! % charset.length];
  return s;
}

export function randomInt(minInclusive: number, maxExclusive: number): number {
  const range = maxExclusive - minInclusive;
  if (range <= 0) return minInclusive;
  const max = 0x100000000;
  const limit = max - (max % range);
  const buf = new Uint32Array(1);
  let v = 0;
  do {
    crypto.getRandomValues(buf);
    v = buf[0]!;
  } while (v >= limit);
  return minInclusive + (v % range);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let acc = 0;
  for (let i = 0; i < max; i++) {
    acc |= (a.charCodeAt(i) || 0x10000) ^ (b.charCodeAt(i) || 0x10000);
  }
  return acc === 0 && a.length === b.length;
}

export function generateUuid(): string {
  return crypto.randomUUID();
}
