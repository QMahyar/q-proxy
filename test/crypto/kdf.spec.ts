import { describe, expect, it } from "vitest";
import {
  evpBytesToKey,
  hkdfSha1,
  hkdfSha1Extract,
  hkdfSha1Expand,
  vmessKdf,
  vmessKdf16,
} from "../../src/crypto/kdf";
import { bytesToHex, hexToBytes, utf8Encode } from "../../src/utils/bytes";

describe("evpBytesToKey", () => {
  const PINNED: [string, number, string][] = [
    ["hello-hello", 16, "ef45feec54459ad88e1c17ae184702d3"],
    [
      "hello-hello",
      32,
      "ef45feec54459ad88e1c17ae184702d311167b190feb0674805066ae725443fa",
    ],
    ["secret", 16, "5ebe2294ecd0e0f08eab7690d2a6ee69"],
    [
      "secret",
      32,
      "5ebe2294ecd0e0f08eab7690d2a6ee6926ae5cc854e36b6bdfca366848dea6bb",
    ],
    ["q-proxy-test-password", 16, "2e6a8812462565d1584a8f815f2da0b3"],
    [
      "q-proxy-test-password",
      32,
      "2e6a8812462565d1584a8f815f2da0b3bc51605d97f7c843dca207436456f05b",
    ],
  ];

  it.each(PINNED)("EVP_BytesToKey(MD5, count=1) matches OpenSSL for %#", (password, keyLen, expected) => {
    expect(bytesToHex(evpBytesToKey(password, keyLen))).toBe(expected);
  });

  it("empty password derives a deterministic key", () => {
    const a = evpBytesToKey("", 16);
    const b = evpBytesToKey("", 16);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(a.length).toBe(16);
  });

  it("aes-256 key extends the aes-128 key prefix", () => {
    const k16 = bytesToHex(evpBytesToKey("pw", 16));
    const k32 = bytesToHex(evpBytesToKey("pw", 32));
    expect(k32.startsWith(k16)).toBe(true);
  });
});

describe("hkdfSha1 (RFC 5869)", () => {
  it("test case 4: basic SHA-1", async () => {
    const ikm = new Uint8Array(11).fill(0x0b);
    const salt = hexToBytes("000102030405060708090a0b0c")!;
    const info = hexToBytes("f0f1f2f3f4f5f6f7f8f9")!;
    const prk = await hkdfSha1Extract(salt, ikm);
    expect(bytesToHex(prk)).toBe("9b6c18c432a7bf8f0e71c8eb88f4b30baa2ba243");
    const okm = await hkdfSha1(ikm, salt, info, 42);
    expect(bytesToHex(okm)).toBe(
      "085a01ea1b10f36933068b56efa5ad81" +
        "a4f14b822f5b091568a9cdd4f155fda2" +
        "c22e422478d305f3f896",
    );
  });

  it("test case 5: longer inputs/outputs (82 octets over 5 blocks)", async () => {
    const ikm = hexToBytes(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f",
    )!;
    const salt = hexToBytes(
      "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
    )!;
    const info = hexToBytes(
      "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    )!;
    const okm = await hkdfSha1(ikm, salt, info, 82);
    expect(bytesToHex(okm)).toBe(
      "0bd770a74d1160f7c9f12cd5912a06eb" +
        "ff6adcae899d92191fe4305673ba2ffe" +
        "8fa3f1a4e5ad79f3f334b3b202b2173c" +
        "486ea37ce3d397ed034c7f9dfeb15c5e" +
        "927336d0441f4c4300e2cff0d0900b52" +
        "d3b4",
    );
  });

  it("expand truncates to requested length and chains T blocks correctly", async () => {
    const prk = hexToBytes("9b6c18c432a7bf8f0e71c8eb88f4b30baa2ba243")!;
    const info = utf8Encode("ss-subkey");
    const out20 = await hkdfSha1Expand(prk, info, 20);
    const out21 = await hkdfSha1Expand(prk, info, 21);
    expect(out20.length).toBe(20);
    expect(out21.length).toBe(21);
    expect(bytesToHex(out21)).toBe(bytesToHex(out20) + bytesToHex(out21).slice(40, 42));
  });
});

describe("vmessKdf (nested HMAC-SHA256 per v2fly/Xray)", () => {
  it("matches the official upstream test vector", async () => {
    const value = await vmessKdf(
      utf8Encode("Demo Key for KDF Value Test"),
      "Demo Path for KDF Value Test",
      "Demo Path for KDF Value Test2",
      "Demo Path for KDF Value Test3",
    );
    expect(bytesToHex(value)).toBe(
      "53e9d7e1bd7bd25022b71ead07d8a596efc8a845c7888652fd684b4903dc8892",
    );
  });

  it("single path element expands via the HMAC-over-HMAC construction (WebCrypto oracle)", async () => {
    const key = utf8Encode("some command key");
    const out = await vmessKdf(key, "AES Auth ID Encryption");

    const k1 = utf8Encode("AES Auth ID Encryption");
    const ipadBlock = new Uint8Array(64).fill(0x36);
    const opadBlock = new Uint8Array(64).fill(0x5c);
    for (let i = 0; i < k1.length; i++) {
      ipadBlock[i]! ^= k1[i]!;
      opadBlock[i]! ^= k1[i]!;
    }
    const innerHash = await rootHmac(ipadBlock, key);
    const expected = await rootHmac(opadBlock, innerHash);
    expect(bytesToHex(out)).toBe(bytesToHex(expected));
    expect((await vmessKdf16(key, "AES Auth ID Encryption")).length).toBe(16);
    expect(bytesToHex(await vmessKdf16(key, "AES Auth ID Encryption"))).toBe(
      bytesToHex(expected).slice(0, 32),
    );
  });

  async function rootHmac(padded: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
    const ck = await crypto.subtle.importKey(
      "raw",
      utf8Encode("VMess AEAD KDF") as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return new Uint8Array(await crypto.subtle.sign("HMAC", ck, concat(padded, msg) as BufferSource));
  }

  it("is deterministic and key-sensitive", async () => {
    const a = await vmessKdf(utf8Encode("key-a"), "salt");
    const b = await vmessKdf(utf8Encode("key-a"), "salt");
    const c = await vmessKdf(utf8Encode("key-b"), "salt");
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(bytesToHex(a)).not.toBe(bytesToHex(c));
  });

  function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }
});
