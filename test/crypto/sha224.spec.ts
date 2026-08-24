import { describe, expect, it } from "vitest";
import { sha224, sha224Hex } from "../../src/crypto/sha224";
import { bytesToHex } from "../../src/utils/bytes";

describe("sha224", () => {
  const VECTORS: [string, string][] = [
    ["", "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f"],
    ["abc", "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "75388b16512776cc5dba5da1fd890150b0c6455cb4f58b1952522525",
    ],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "bff72b4fcb7d75e5632900ac5f90d219e05e97a7bde72e740db393d9",
    ],
    ["a".repeat(1000000), "20794655980c91d8bbb4c1ea97618a4bf03f42581948b2ee4ee7ad67"],
  ];

  it.each(VECTORS)("official vector %#", (input, expected) => {
    expect(sha224Hex(input)).toBe(expected);
  });

  const BOUNDARY: [number, string][] = [
    [55, "fb0bd626a70c28541dfa781bb5cc4d7d7f56622a58f01a0b1ddd646f"],
    [56, "d40854fc9caf172067136f2e29e1380b14626bf6f0dd06779f820dcd"],
    [64, "a88cd5cde6d6fe9136a4e58b49167461ea95d388ca2bdb7afdc3cbf4"],
  ];

  it.each(BOUNDARY)("padding boundary length %i (OpenSSL-pinned)", (len, expected) => {
    const data = new Uint8Array(len).fill(0x61);
    expect(bytesToHex(sha224(data))).toBe(expected);
  });
});
