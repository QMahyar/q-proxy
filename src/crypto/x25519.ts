const P = 2n ** 255n - 19n;
const BASE_POINT = (() => {
  const b = new Uint8Array(32);
  b[0] = 9;
  return b;
})();

function decodeScalar(bytes: Uint8Array): bigint {
  const k = bytes.slice();
  if (k.length < 32) return 0n;
  k[0]! &= 248;
  k[31]! &= 127;
  k[31]! |= 64;
  let v = 0n;
  for (let i = 31; i >= 0; i--) v = (v << 8n) | BigInt(k[i]!);
  return v;
}

function decodeU(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = 31; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i] ?? 0);
  return (v & ((1n << 255n) - 1n)) % P;
}

function encodeU(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = v % P;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(x & 255n);
    x >>= 8n;
  }
  return out;
}

function powMod(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = base % P;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

export function x25519(scalarBytes: Uint8Array, uBytes: Uint8Array): Uint8Array {
  const k = decodeScalar(scalarBytes);
  const x1 = decodeU(uBytes);
  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0n;
  for (let t = 254; t >= 0; t--) {
    const kt = (k >> BigInt(t)) & 1n;
    const mask = (swap ^ kt) ? -1n : 0n;
    let t1 = (x2 ^ x3) & mask;
    x2 ^= t1;
    x3 ^= t1;
    let t2 = (z2 ^ z3) & mask;
    z2 ^= t2;
    z3 ^= t2;
    swap = kt;
    const a = (x2 + z2) % P;
    const aa = (a * a) % P;
    const b = (x2 - z2 + P) % P;
    const bb = (b * b) % P;
    const e = (aa - bb + P) % P;
    const c = (x3 + z3) % P;
    const d = (x3 - z3 + P) % P;
    const da = (d * a) % P;
    const cb = (c * b) % P;
    const dab = (da + cb) % P;
    const dacb = (da - cb + P) % P;
    x3 = (dab * dab) % P;
    z3 = (x1 * dacb * dacb) % P;
    x2 = (aa * bb) % P;
    z2 = (e * ((aa + 121665n * e) % P)) % P;
  }
  {
    const mask2 = swap ? -1n : 0n;
    let t1 = (x2 ^ x3) & mask2;
    x2 ^= t1;
    x3 ^= t1;
    let t2 = (z2 ^ z3) & mask2;
    z2 ^= t2;
    z3 ^= t2;
  }
  return encodeU((x2 * powMod(z2, P - 2n)) % P);
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generatePrivateKey(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return bytesToB64(raw);
}

export function publicKeyFromPrivate(privateKeyB64: string): string {
  const priv = b64ToBytes(privateKeyB64);
  if (priv.length !== 32) throw new Error("private key must be 32 bytes");
  const out = x25519(priv, BASE_POINT);
  if (isAllZeroOutput(out)) throw new Error("weak public key");
  return bytesToB64(out);
}

export function generateKeypair(): { privateKey: string; publicKey: string } {
  for (let i = 0; i < 16; i++) {
    const privateKey = generatePrivateKey();
    try {
      return { privateKey, publicKey: publicKeyFromPrivate(privateKey) };
    } catch {}
  }
  const privateKey = generatePrivateKey();
  return { privateKey, publicKey: publicKeyFromPrivate(privateKey) };
}

export function isBase64Key32(value: string): boolean {
  if (!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(value)) return false;
  try {
    return b64ToBytes(value).length === 32;
  } catch {
    return false;
  }
}

export function isAllZeroOutput(bytes: Uint8Array): boolean {
  let acc = 0;
  for (let i = 0; i < bytes.length; i++) acc |= bytes[i]!;
  return acc === 0;
}

export function sharedSecret(myPrivateB64: string, theirPublicB64: string): string {
  const priv = b64ToBytes(myPrivateB64);
  const pub = b64ToBytes(theirPublicB64);
  if (priv.length !== 32 || pub.length !== 32) throw new Error("keys must be 32 bytes");
  const out = x25519(priv, pub);
  if (isAllZeroOutput(out)) throw new Error("weak public key");
  return bytesToB64(out);
}
