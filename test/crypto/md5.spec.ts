import { describe, expect, it } from "vitest";
import { md5, md5Utf8 } from "../../src/crypto/md5";
import { bytesToHex, utf8Encode } from "../../src/utils/bytes";

describe("md5", () => {
  const RFC1321: [string, string][] = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ];

  it.each(RFC1321)("RFC 1321 vector %#", (input, expected) => {
    expect(bytesToHex(md5Utf8(input))).toBe(expected);
  });

  const BOUNDARY: [number, string][] = [
    [55, "07be93c8d206e16b64469e97c3587951"],
    [56, "9d555cfe0b8ae686838fbe4c5067f494"],
    [57, "542eb2ad9912857953231cb06f02cb2c"],
    [63, "3a5a0e910bbb3736b1156774a444a8b8"],
    [64, "5bb6f6136cad3c71da7caae9a81b6492"],
    [65, "f8a1e899d5636d0a18afe718664a5ff3"],
    [127, "bd03a6edc96732bf48cd11fc7a6d2e15"],
    [128, "745aba4a32bb14875786154650fd4606"],
  ];

  it.each(BOUNDARY)("padding boundary length %i (OpenSSL-pinned)", (len, expected) => {
    const data = new Uint8Array(len).fill(0xab);
    expect(bytesToHex(md5(data))).toBe(expected);
  });

  it("encodes multibyte utf8 consistently with raw digest", () => {
    expect(bytesToHex(md5Utf8("héllo"))).toBe(
      bytesToHex(md5(utf8Encode("héllo"))),
    );
  });
});
