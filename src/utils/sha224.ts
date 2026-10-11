// Pure-JS SHA-224 (FIPS 180-4): SHA-256 compression with the 224 IV,
// output truncated to 28 bytes. WebCrypto has no SHA-224 in Node or
// workerd, and trojan password verification needs exactly this hash.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H224 = new Uint32Array([
  0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function padded(message: Uint8Array): Uint8Array {
  const bitLenHi = Math.floor(message.byteLength / 0x20000000);
  const bitLenLo = (message.byteLength << 3) >>> 0;
  const padLen = ((56 - (message.byteLength + 1) % 64) + 64) % 64;
  const out = new Uint8Array(message.byteLength + 1 + padLen + 8);
  out.set(message, 0);
  out[message.byteLength] = 0x80;
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(out.byteLength - 8, bitLenHi);
  dv.setUint32(out.byteLength - 4, bitLenLo);
  return out;
}

export function sha224(message: Uint8Array): Uint8Array {
  const data = padded(message);
  const h = H224.slice();
  const w = new Uint32Array(64);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let off = 0; off < data.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
    h[5] = (h[5]! + f) | 0;
    h[6] = (h[6]! + g) | 0;
    h[7] = (h[7]! + hh) | 0;
  }
  const out = new Uint8Array(28);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 7; i++) odv.setUint32(i * 4, h[i]!);
  return out;
}

const HEX = "0123456789abcdef";

export function sha224Hex(text: string): string {
  const digest = sha224(new TextEncoder().encode(text));
  let out = "";
  for (const b of digest) out += HEX[(b >> 4) & 0xf]! + HEX[b & 0xf]!;
  return out;
}

export function sha224BytesHex(digest: Uint8Array): string {
  let out = "";
  for (const b of digest) out += HEX[(b >> 4) & 0xf]! + HEX[b & 0xf]!;
  return out;
}
