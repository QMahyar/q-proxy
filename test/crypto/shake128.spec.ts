import { describe, expect, it } from "vitest";
import { Shake128 } from "../../src/crypto/shake128";
import { concatBytes } from "../../src/utils/bytes";

describe("Shake128", () => {
  it("matches the NIST SHAKE128(empty) vector", () => {
    const out = new Shake128().squeeze(32);
    expect(
      Array.from(out)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    ).toBe("7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26");
  });

  it("produces identical output for same input (one-shot vs incremental)", () => {
    for (const seedLen of [0, 1, 15, 16, 17, 135, 136, 167, 168, 169, 400]) {
      const seed = new Uint8Array(seedLen).map((_, i) => (i * 31 + 11) & 0xff);
      for (const outLen of [16, 31, 32, 64, 168, 200, 512]) {
        const oneShot = new Shake128(seed).squeeze(outLen);
        const incremental = new Shake128();
        incremental.update(seed);
        expect(Array.from(incremental.squeeze(outLen))).toEqual(Array.from(oneShot));
      }
    }
  });

  it("supports incremental absorb equivalent to one-shot", () => {
    const seed = new Uint8Array(300).map((_, i) => (i * 13 + 5) & 0xff);
    const shaker = new Shake128();
    shaker.update(seed.subarray(0, 7));
    shaker.update(seed.subarray(7, 168));
    shaker.update(seed.subarray(168));
    const oneShot = new Shake128(seed).squeeze(100);
    expect(Array.from(shaker.squeeze(100))).toEqual(Array.from(oneShot));
  });

  it("streams squeeze calls continuously across rate-block boundaries", () => {
    const seed = new Uint8Array(64).map((_, i) => (i * 29 + 3) & 0xff);
    const shaker = new Shake128(seed);
    const a = shaker.squeeze(100);
    const b = shaker.squeeze(200);
    const oneShot = new Shake128(seed).squeeze(300);
    expect(Array.from(concatBytes(a, b))).toEqual(Array.from(oneShot));
  });

  it("interleaves equal-length draws the way the vmess size parser consumes masks", () => {
    const seed = new Uint8Array(16).map((_, i) => (i * 41 + 9) & 0xff);
    const shaker = new Shake128(seed);
    const full = new Shake128(seed).squeeze(16);
    const scratch = new Uint8Array(2);
    for (let i = 0; i < 8; i++) {
      shaker.squeezeInto(scratch, 0, 2);
      const expected = (full[i * 2]! << 8) | full[i * 2 + 1]!;
      expect((scratch[0]! << 8) | scratch[1]!).toBe(expected);
    }
  });
});
