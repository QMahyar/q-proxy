const RATE = 168;
const LANES = 25;
const MASK64 = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROT = new Uint8Array([
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
]);

function rotl64(v: bigint, n: number): bigint {
  const N = BigInt(n);
  return ((v << N) | (v >> (64n - N))) & MASK64;
}

function keccakF1600(a: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const c: bigint[] = new Array(5);
    for (let x = 0; x < 5; x++) {
      c[x] = a[x]! ^ a[x + 5]! ^ a[x + 10]! ^ a[x + 15]! ^ a[x + 20]!;
    }
    const d: bigint[] = new Array(5);
    for (let x = 0; x < 5; x++) {
      d[x] = c[(x + 4) % 5]! ^ rotl64(c[(x + 1) % 5]!, 1);
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        a[x + 5 * y] = a[x + 5 * y]! ^ d[x]!;
      }
    }
    const b: bigint[] = new Array(LANES).fill(0n);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(a[x + 5 * y]!, ROT[x + 5 * y]!);
      }
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        a[x + 5 * y] = b[x + 5 * y]! ^ (~b[(x + 1) % 5 + 5 * y]! & b[(x + 2) % 5 + 5 * y]! & MASK64);
      }
    }
    a[0] = a[0]! ^ RC[round]!;
  }
}

export class Shake128 {
  private state: bigint[] = new Array(LANES).fill(0n);
  private buf = new Uint8Array(RATE);
  private bufLen = 0;
  private squeezing = false;
  private outPos = 0;

  constructor(seed?: Uint8Array) {
    if (seed && seed.length > 0) this.update(seed);
  }

  update(data: Uint8Array): this {
    let off = 0;
    while (off < data.length) {
      const n = Math.min(RATE - this.bufLen, data.length - off);
      this.buf.set(data.subarray(off, off + n), this.bufLen);
      this.bufLen += n;
      off += n;
      if (this.bufLen === RATE) {
        this.absorbBlock();
        keccakF1600(this.state);
        this.bufLen = 0;
      }
    }
    return this;
  }

  private absorbBlock(): void {
    for (let i = 0; i < RATE; i++) {
      this.state[i >> 3] = this.state[i >> 3]! ^ (BigInt(this.buf[i]!) << BigInt(8 * (i & 7)));
    }
  }

  squeezeInto(out: Uint8Array, offset: number, length: number): void {
    if (!this.squeezing) {
      this.buf.fill(0, this.bufLen);
      this.buf[this.bufLen]! ^= 0x1f;
      this.buf[RATE - 1]! ^= 0x80;
      this.absorbBlock();
      keccakF1600(this.state);
      this.squeezing = true;
    }
    let off = offset;
    let remaining = length;
    while (remaining > 0) {
      if (this.outPos === RATE) {
        keccakF1600(this.state);
        this.outPos = 0;
      }
      const n = Math.min(RATE - this.outPos, remaining);
      for (let i = 0; i < n; i++) {
        const lane = (this.outPos + i) >> 3;
        const shift = BigInt(8 * ((this.outPos + i) & 7));
        out[off + i] = Number((this.state[lane]! >> shift) & 0xffn);
      }
      this.outPos += n;
      off += n;
      remaining -= n;
    }
  }

  squeeze(length: number): Uint8Array {
    const out = new Uint8Array(length);
    this.squeezeInto(out, 0, length);
    return out;
  }
}
