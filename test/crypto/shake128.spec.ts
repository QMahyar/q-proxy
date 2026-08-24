import { describe, expect, it } from "vitest";
import { hash as nodeHash } from "node:crypto";
import { Shake128 } from "../../src/crypto/shake128";
import { concatBytes } from "../../src/utils/bytes";

function nodeShake(seed: Uint8Array, length: number): Uint8Array {
  const hex = nodeHash("shake128", Buffer.from(seed), {
    outputLength: length,
    encoding: "hex",
  }) as string;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe("Shake128", () => {
  it("matches the NIST SHAKE128(empty) vector", () => {
    const out = new Shake128().squeeze(32);
    expect(
      Array.from(out)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    ).toBe("7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26");
  });

  it("matches node:crypto across assorted seed and output lengths", () => {
    for (const seedLen of [0, 1, 15, 16, 17, 135, 136, 167, 168, 169, 400]) {
      const seed = new Uint8Array(seedLen).map((_, i) => (i * 31 + 11) & 0xff);
      for (const outLen of [16, 31, 32, 64, 168, 200, 512]) {
        expect(Array.from(new Shake128(seed).squeeze(outLen))).toEqual(
          Array.from(nodeShake(seed, outLen)),
        );
      }
    }
  });

  it("supports incremental absorb equivalent to one-shot", () => {
    const seed = new Uint8Array(300).map((_, i) => (i * 13 + 5) & 0xff);
    const shaker = new Shake128();
    shaker.update(seed.subarray(0, 7));
    shaker.update(seed.subarray(7, 168));
    shaker.update(seed.subarray(168));
    expect(Array.from(shaker.squeeze(100))).toEqual(Array.from(nodeShake(seed, 100)));
  });

  it("streams squeeze calls continuously across rate-block boundaries", () => {
    const seed = new Uint8Array(64).map((_, i) => (i * 29 + 3) & 0xff);
    const shaker = new Shake128(seed);
    const a = shaker.squeeze(100);
    const b = shaker.squeeze(200);
    expect(Array.from(concatBytes(a, b))).toEqual(Array.from(nodeShake(seed, 300)));
  });

  it("interleaves equal-length draws the way the vmess size parser consumes masks", () => {
    const seed = new Uint8Array(16).map((_, i) => (i * 41 + 9) & 0xff);
    const shaker = new Shake128(seed);
    const scratch = new Uint8Array(2);
    for (let i = 0; i < 8; i++) {
      shaker.squeezeInto(scratch, 0, 2);
      const expected = (nodeShake(seed, 16)[i * 2]! << 8) | nodeShake(seed, 16)[i * 2 + 1]!;
      expect((scratch[0]! << 8) | scratch[1]!).toBe(expected);
    }
  });
});
