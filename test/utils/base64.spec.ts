import { describe, expect, it } from "vitest";
import {
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  utf8FromBase64,
} from "../../src/utils/base64";

describe("encode/decodeBase64", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    expect(decodeBase64(encodeBase64(bytes))).toEqual({ ok: true, value: bytes });
  });

  it("encodes known vectors", () => {
    expect(utf8FromBase64(encodeBase64(new TextEncoder().encode("hello")))).toMatchObject({
      ok: true,
      text: "hello",
    });
    expect(utf8FromBase64("aGVsbG8=")).toMatchObject({ ok: true, text: "hello" });
  });
});

describe("decodeBase64 tolerance", () => {
  it("accepts unpadded and urlsafe alphabets", () => {
    expect(utf8FromBase64("aGVsbG8")).toEqual(expect.objectContaining({ ok: true, text: "hello" }));
    expect(utf8FromBase64("aGVsbG8u")).toEqual(expect.objectContaining({ ok: true, text: "hello." }));
    expect(utf8FromBase64("-_8")).toEqual(expect.objectContaining({ ok: true }));
  });

  it("strips whitespace", () => {
    expect(utf8FromBase64("aGVs\nbG8=\n")).toEqual(expect.objectContaining({ ok: true, text: "hello" }));
  });

  it("rejects garbage", () => {
    expect(decodeBase64("!!!!").ok).toBe(false);
    expect(decodeBase64("abcde").ok).toBe(false);
    expect(decodeBase64("").ok).toBe(false);
  });
});

describe("base64url", () => {
  it("is unpadded and url-safe", () => {
    const out = encodeBase64Url(new Uint8Array([251, 255, 190]));
    expect(out).not.toContain("+");
    expect(out).not.toContain("/");
    expect(out).not.toContain("=");
    expect(decodeBase64Url(out)).toEqual({ ok: true, value: new Uint8Array([251, 255, 190]) });
  });

  it("encodes strings directly", () => {
    expect(encodeBase64Url("hello")).toBe("aGVsbG8");
    expect(utf8FromBase64(encodeBase64Url("hello"))).toMatchObject({ ok: true, text: "hello" });
  });
});
