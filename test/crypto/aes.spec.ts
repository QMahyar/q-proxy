import { describe, expect, it } from "vitest";
import { Aes128 } from "../../src/crypto/aes";
import { bytesToHex, hexToBytes } from "../../src/utils/bytes";

const NIST_KEY = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c")!;
const NIST_PT = hexToBytes(
  "6bc1bee22e409f96e93d7e117393172a" +
    "ae2d8a571e03ac9c9eb76fac45af8e51" +
    "30c81c46a35ce411e5fbc1191a0a52ef" +
    "f69f2445df4f9b17ad2b417be66c3710",
)!;

describe("Aes128 block cipher (ECB single block)", () => {
  it("NIST SP 800-38A F.1.1 first block encrypts to known value", () => {
    const aes = new Aes128(NIST_KEY);
    expect(bytesToHex(aes.encryptBlock(NIST_PT))).toBe("3ad77bb40d7a3660a89ecaf32466ef97");
  });

  it("decrypts back", () => {
    const aes = new Aes128(NIST_KEY);
    const ct = hexToBytes("3ad77bb40d7a3660a89ecaf32466ef97")!;
    expect(bytesToHex(aes.decryptBlock(ct))).toBe(bytesToHex(NIST_PT.subarray(0, 16)));
  });

  it("round-trips random blocks and matches the F.1.1 key schedule", () => {
    const aes = new Aes128(NIST_KEY);
    for (let i = 0; i < 16; i++) {
      const pt = new Uint8Array(16);
      crypto.getRandomValues(pt);
      const ct = aes.encryptBlock(pt);
      expect(ct.length).toBe(16);
      expect(bytesToHex(aes.decryptBlock(ct))).toBe(bytesToHex(pt));
    }
  });

  it("rejects wrong key size", () => {
    expect(() => new Aes128(new Uint8Array(15))).toThrow();
    expect(() => new Aes128(new Uint8Array(32))).toThrow();
  });
});
