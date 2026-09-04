import { describe, expect, it } from "vitest";
import { buildChunkNonce } from "../../src/protocols/vmess-crypto";
import { readU16BE } from "../../src/utils/bytes";

function testIv(): Uint8Array {
  const iv = new Uint8Array(16);
  for (let i = 0; i < 16; i++) iv[i] = (i * 37 + 11) & 0xff;
  return iv;
}

describe("buildChunkNonce overflow guard", () => {
  it("encodes boundary counters 0 and 65535 without throwing", () => {
    const iv = testIv();
    const zero = buildChunkNonce(iv, 0);
    expect(zero.length).toBe(12);
    expect(readU16BE(zero, 0)).toBe(0);
    expect(Array.from(zero.subarray(2))).toEqual(Array.from(iv.subarray(2, 12)));

    const max = buildChunkNonce(iv, 65535);
    expect(readU16BE(max, 0)).toBe(65535);
    expect(Array.from(max.subarray(2))).toEqual(Array.from(iv.subarray(2, 12)));
  });

  it("throws instead of wrapping at 65536", () => {
    const iv = testIv();
    const wrapped = buildChunkNonce(iv, 0);
    expect(() => buildChunkNonce(iv, 65536)).toThrow("vmess chunk nonce counter overflow");
    expect(() => buildChunkNonce(iv, 65537)).toThrow("vmess chunk nonce counter overflow");
    expect(() => buildChunkNonce(iv, 131072)).toThrow("vmess chunk nonce counter overflow");
    expect(wrapped.length).toBe(12);
  });

  it("rejects negative and non-integer counters", () => {
    const iv = testIv();
    expect(() => buildChunkNonce(iv, -1)).toThrow("vmess chunk nonce counter overflow");
    expect(() => buildChunkNonce(iv, 1.5)).toThrow("vmess chunk nonce counter overflow");
    expect(() => buildChunkNonce(iv, Number.NaN)).toThrow("vmess chunk nonce counter overflow");
  });
});
