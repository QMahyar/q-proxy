const P = (1n << 130n) - 5n;
const MASK128 = (1n << 128n) - 1n;

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

function rotl(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a]! + s[b]!) >>> 0;
  s[d] = rotl(s[d]! ^ s[a]!, 16);
  s[c] = (s[c]! + s[d]!) >>> 0;
  s[b] = rotl(s[b]! ^ s[c]!, 12);
  s[a] = (s[a]! + s[b]!) >>> 0;
  s[d] = rotl(s[d]! ^ s[a]!, 8);
  s[c] = (s[c]! + s[d]!) >>> 0;
  s[b] = rotl(s[b]! ^ s[c]!, 7);
}

export function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const dv = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const ndv = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const state = new Uint32Array(16);
  state[0] = SIGMA[0]!;
  state[1] = SIGMA[1]!;
  state[2] = SIGMA[2]!;
  state[3] = SIGMA[3]!;
  for (let i = 0; i < 8; i++) state[4 + i] = dv.getUint32(i * 4, true);
  state[12] = counter >>> 0;
  state[13] = ndv.getUint32(0, true);
  state[14] = ndv.getUint32(4, true);
  state[15] = ndv.getUint32(8, true);
  const working = new Uint32Array(state);
  for (let i = 0; i < 10; i++) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) odv.setUint32(i * 4, (working[i]! + state[i]!) >>> 0, true);
  return out;
}

function chacha20Xor(
  key: Uint8Array,
  initialCounter: number,
  nonce: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(data.length);
  let counter = initialCounter >>> 0;
  for (let off = 0; off < data.length; off += 64) {
    const ks = chacha20Block(key, counter, nonce);
    counter++;
    const n = Math.min(64, data.length - off);
    for (let i = 0; i < n; i++) out[off + i] = data[off + i]! ^ ks[i]!;
  }
  return out;
}

function leBytesToBigInt(bytes: Uint8Array, offset: number, length: number): bigint {
  let v = 0n;
  for (let i = length - 1; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[offset + i] ?? 0);
  }
  return v;
}

function bigIntToLeBytes(v: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = v;
  for (let i = 0; i < length; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

export function poly1305(msg: Uint8Array, key: Uint8Array): Uint8Array {
  let r = leBytesToBigInt(key, 0, 16) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leBytesToBigInt(key, 16, 16);
  let acc = 0n;
  const blocks = Math.ceil(msg.length / 16);
  for (let i = 0; i < blocks; i++) {
    const off = i * 16;
    const len = Math.min(16, msg.length - off);
    const n = leBytesToBigInt(msg, off, len) | (1n << BigInt(8 * len));
    acc = ((acc + n) * r) % P;
  }
  acc = (acc + s) & MASK128;
  return bigIntToLeBytes(acc, 16);
}

function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function padTo16(length: number): Uint8Array {
  return new Uint8Array((16 - (length % 16)) % 16);
}

function macData(aad: Uint8Array, ct: Uint8Array): Uint8Array {
  const total = aad.length + padTo16(aad.length).length + ct.length + padTo16(ct.length).length + 16;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(aad, off);
  off += aad.length + padTo16(aad.length).length;
  out.set(ct, off);
  off += ct.length + padTo16(ct.length).length;
  out.set(bigIntToLeBytes(BigInt(aad.length), 8), off);
  out.set(bigIntToLeBytes(BigInt(ct.length), 8), off + 8);
  return out;
}

export function chacha20Poly1305Seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array | null,
): Uint8Array {
  const otk = chacha20Block(key, 0, nonce).subarray(0, 32);
  const ct = chacha20Xor(key, 1, nonce, plaintext);
  const tag = poly1305(macData(aad ?? new Uint8Array(0), ct), otk);
  const out = new Uint8Array(ct.length + 16);
  out.set(ct);
  out.set(tag, ct.length);
  return out;
}

export function chacha20Poly1305Open(
  key: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array | null,
): Uint8Array | null {
  if (sealed.length < 16) return null;
  const ct = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const otk = chacha20Block(key, 0, nonce).subarray(0, 32);
  const expected = poly1305(macData(aad ?? new Uint8Array(0), ct), otk);
  if (!constantTimeEquals(expected, tag)) return null;
  return chacha20Xor(key, 1, nonce, ct);
}
