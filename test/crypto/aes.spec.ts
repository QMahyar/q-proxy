import { describe, expect, it } from "vitest";
import { Aes128 } from "../../src/crypto/aes";
import { bytesToHex, hexToBytes } from "../../src/utils/bytes";

const NIST_KEY = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c")!;
const NIST_IV = hexToBytes("000102030405060708090a0b0c0d0e0f")!;
const NIST_PT = hexToBytes(
  "6bc1bee22e409f96e93d7e117393172a" +
    "ae2d8a571e03ac9c9eb76fac45af8e51" +
    "30c81c46a35ce411e5fbc1191a0a52ef" +
    "f69f2445df4f9b17ad2b417be66c3710",
)!;
const NIST_CFB_CT = hexToBytes(
  "3b3fd92eb72dad20333449f8e83cfb4a" +
    "c8a64537a0b3a93fcde3cdad9f1ce58b" +
    "26751f67a3cbb140b1808cf187a4f4df" +
    "c04b05357c5d1c0eeac4c66f9ff7f2e6",
)!;

function patternBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * 37 + 11) & 0xff;
  return out;
}

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
});

describe("Aes128 CFB-128 mode", () => {
  it("NIST SP 800-38A F.3.13 CFB128-AES128.Encrypt vector", () => {
    const aes = new Aes128(NIST_KEY);
    expect(bytesToHex(aes.cfbEncrypt(NIST_IV, NIST_PT))).toBe(bytesToHex(NIST_CFB_CT));
  });

  it("NIST SP 800-38A F.3.14 CFB128-AES128.Decrypt vector", () => {
    const aes = new Aes128(NIST_KEY);
    expect(bytesToHex(aes.cfbDecrypt(NIST_IV, NIST_CFB_CT))).toBe(bytesToHex(NIST_PT));
  });

  const PARTIAL: [string, string][] = [
    ["0b", "5b"],
    ["0b30557a9fc4e90e33587da2c7ec11", "5bce32b606a9dbb8e9514a4b5c43fd"],
    [
      "0b30557a9fc4e90e33587da2c7ec11365b",
      "5bce32b606a9dbb8e9514a4b5c43fd566a",
    ],
    [
      "0b30557a9fc4e90e33587da2c7ec11365b80a5caef14395e83a8cdf2173c6186ab",
      "5bce32b606a9dbb8e9514a4b5c43fd566a20d9630a8aa3400223643a9640ced0bd",
    ],
  ];

  it.each(PARTIAL)("handles non-block-aligned length %i like OpenSSL CFB128", (ptHex, ctHex) => {
    const aes = new Aes128(NIST_KEY);
    const pt = hexToBytes(ptHex)!;
    expect(bytesToHex(aes.cfbEncrypt(NIST_IV, pt))).toBe(ctHex);
    expect(bytesToHex(aes.cfbDecrypt(NIST_IV, hexToBytes(ctHex)!))).toBe(ptHex);
  });

  it("rejects wrong key size", () => {
    expect(() => new Aes128(new Uint8Array(15))).toThrow();
    expect(() => new Aes128(new Uint8Array(32))).toThrow();
  });
});
