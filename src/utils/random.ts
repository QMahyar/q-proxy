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
  if (length <= 0) return "";
  if (charset.length === 0) return "";
  if (charset.length === 1) return charset[0]!.repeat(length);
  const threshold = Math.floor(256 / charset.length) * charset.length;
  let s = "";
  while (s.length < length) {
    const need = length - s.length;
    const batch = randomBytes(Math.ceil((need * 256) / threshold) + 8);
    for (let i = 0; i < batch.length && s.length < length; i++) {
      const b = batch[i]!;
      if (b < threshold) s += charset[b % charset.length]!;
    }
  }
  return s;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let acc = 0;
  for (let i = 0; i < max; i++) {
    acc |= (a.charCodeAt(i) || 0x10000) ^ (b.charCodeAt(i) || 0x10000);
  }
  return acc === 0 && a.length === b.length;
}