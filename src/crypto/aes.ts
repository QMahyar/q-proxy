const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]!] = i;

function xtime(a: number): number {
  return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
}

function mul(a: number, b: number): number {
  let p = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) p ^= x;
    const hi = x & 0x80;
    x = (x << 1) & 0xff;
    if (hi) x ^= 0x1b;
    y >>= 1;
  }
  return p;
}

function subWord(a0: number, a1: number, a2: number, a3: number): [number, number, number, number] {
  return [SBOX[a0]!, SBOX[a1]!, SBOX[a2]!, SBOX[a3]!];
}

export class Aes128 {
  private readonly rk: Uint8Array;

  constructor(key: Uint8Array) {
    if (key.length !== 16) throw new Error("AES-128 key must be 16 bytes");
    this.rk = Aes128.expand(key);
  }

  private static expand(key: Uint8Array): Uint8Array {
    const rk = new Uint8Array(176);
    rk.set(key);
    let rcon = 1;
    for (let i = 16; i < 176; i += 4) {
      let t0 = rk[i - 4]!;
      let t1 = rk[i - 3]!;
      let t2 = rk[i - 2]!;
      let t3 = rk[i - 1]!;
      if (i % 16 === 0) {
        [t0, t1, t2, t3] = subWord(t1, t2, t3, t0);
        t0 ^= rcon;
        rcon = xtime(rcon);
      }
      rk[i] = rk[i - 16]! ^ t0;
      rk[i + 1] = rk[i - 15]! ^ t1;
      rk[i + 2] = rk[i - 14]! ^ t2;
      rk[i + 3] = rk[i - 13]! ^ t3;
    }
    return rk;
  }

  private static shiftRows(s: Uint8Array): void {
    let t = s[1]!;
    s[1] = s[5]!;
    s[5] = s[9]!;
    s[9] = s[13]!;
    s[13] = t;
    t = s[2]!;
    s[2] = s[10]!;
    s[10] = t;
    t = s[6]!;
    s[6] = s[14]!;
    s[14] = t;
    t = s[15]!;
    s[15] = s[11]!;
    s[11] = s[7]!;
    s[7] = s[3]!;
    s[3] = t;
  }

  private static invShiftRows(s: Uint8Array): void {
    let t = s[13]!;
    s[13] = s[9]!;
    s[9] = s[5]!;
    s[5] = s[1]!;
    s[1] = t;
    t = s[2]!;
    s[2] = s[10]!;
    s[10] = t;
    t = s[6]!;
    s[6] = s[14]!;
    s[14] = t;
    t = s[3]!;
    s[3] = s[7]!;
    s[7] = s[11]!;
    s[11] = s[15]!;
    s[15] = t;
  }

  private static mixColumns(s: Uint8Array): void {
    for (let o = 0; o < 16; o += 4) {
      const a0 = s[o]!;
      const a1 = s[o + 1]!;
      const a2 = s[o + 2]!;
      const a3 = s[o + 3]!;
      s[o] = (xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3) & 0xff;
      s[o + 1] = (a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3) & 0xff;
      s[o + 2] = (a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3) & 0xff;
      s[o + 3] = (xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3)) & 0xff;
    }
  }

  private static invMixColumns(s: Uint8Array): void {
    for (let o = 0; o < 16; o += 4) {
      const a0 = s[o]!;
      const a1 = s[o + 1]!;
      const a2 = s[o + 2]!;
      const a3 = s[o + 3]!;
      s[o] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
      s[o + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
      s[o + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
      s[o + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
    }
  }

  private static addRoundKey(s: Uint8Array, rk: Uint8Array, off: number): void {
    for (let i = 0; i < 16; i++) s[i] = s[i]! ^ rk[off + i]!;
  }

  encryptBlock(input: Uint8Array, inOff = 0): Uint8Array {
    const s = new Uint8Array(16);
    for (let i = 0; i < 16; i++) s[i] = input[inOff + i]!;
    const rk = this.rk;
    Aes128.addRoundKey(s, rk, 0);
    for (let round = 1; round <= 10; round++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]!]!;
      Aes128.shiftRows(s);
      if (round < 10) {
        Aes128.mixColumns(s);
        Aes128.addRoundKey(s, rk, round * 16);
      } else {
        Aes128.addRoundKey(s, rk, 160);
      }
    }
    return s;
  }

  decryptBlock(input: Uint8Array, inOff = 0): Uint8Array {
    const s = new Uint8Array(16);
    for (let i = 0; i < 16; i++) s[i] = input[inOff + i]!;
    const rk = this.rk;
    Aes128.addRoundKey(s, rk, 160);
    for (let round = 9; round >= 0; round--) {
      Aes128.invShiftRows(s);
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]!]!;
      Aes128.addRoundKey(s, rk, round * 16);
      if (round > 0) Aes128.invMixColumns(s);
    }
    return s;
  }
}
