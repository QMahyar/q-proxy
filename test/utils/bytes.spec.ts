import { describe, expect, it } from "vitest";
import {
  bytesToHex,
  concatBytes,
  equalsBytes,
  hexToBytes,
  readU16BE,
  readU32BE,
  u16be,
  u32be,
  utf8Decode,
  utf8Encode,
  writeU16BE,
  writeU32BE,
} from "../../src/utils/bytes";

describe("concatBytes", () => {
  it("concats and handles empty", () => {
    expect(concatBytes().length).toBe(0);
    const a = utf8Encode("ab");
    const b = utf8Encode("cd");
    expect(utf8Decode(concatBytes(a, b))).toBe("abcd");
  });
});

describe("hex", () => {
  it("round-trips", () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0x7f]);
    expect(bytesToHex(bytes)).toBe("000fff7f");
    const back = hexToBytes("000fff7f");
    expect(back).not.toBeNull();
    expect(equalsBytes(back!, bytes)).toBe(true);
  });

  it("rejects bad hex", () => {
    expect(hexToBytes("abc")).toBeNull();
    expect(hexToBytes("zz")).toBeNull();
    expect(hexToBytes("")).toBeNull();
  });
});

describe("u16/u32 BE", () => {
  it("writes and reads", () => {
    expect(Array.from(u16be(0x1234))).toEqual([0x12, 0x34]);
    expect(readU16BE(u16be(0xabcd), 0)).toBe(0xabcd);
    expect(readU32BE(u32be(0xdeadbeef), 0)).toBe(0xdeadbeef);
    const buf = new Uint8Array(6);
    writeU16BE(buf, 4, 300);
    writeU32BE(buf, 0, 100000);
    expect(readU32BE(buf, 0)).toBe(100000);
    expect(readU16BE(buf, 4)).toBe(300);
  });
});

describe("equalsBytes", () => {
  it("length-sensitive and content-sensitive", () => {
    expect(equalsBytes(utf8Encode("aa"), utf8Encode("aa"))).toBe(true);
    expect(equalsBytes(utf8Encode("aa"), utf8Encode("aaa"))).toBe(false);
    expect(equalsBytes(utf8Encode("ab"), utf8Encode("ba"))).toBe(false);
  });
});
