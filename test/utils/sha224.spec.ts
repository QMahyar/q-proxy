import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha224, sha224Hex } from "../../src/utils/sha224";

function oracleHex(input: string): string {
  // The repo's node:crypto typings resolve to the WebCrypto flavor; cast
  // past them — runtime behavior is what this oracle checks.
  const h = createHash("sha224") as unknown as { update(d: string): { digest(e: string): string } };
  return h.update(input).digest("hex");
}

describe("sha224", () => {
  it("matches node:crypto on vectors and strings", () => {
    expect(sha224Hex("")).toBe(oracleHex(""));
    expect(sha224Hex("abc")).toBe(oracleHex("abc"));
    expect(sha224Hex("s3cret-trojan")).toBe(oracleHex("s3cret-trojan"));
    expect(sha224Hex("x".repeat(200))).toBe(oracleHex("x".repeat(200)));
  });

  it("returns 28 bytes and lowercase hex", () => {
    const out = sha224(new TextEncoder().encode("abc"));
    expect(out.byteLength).toBe(28);
    expect(sha224Hex("abc")).toMatch(/^[0-9a-f]{56}$/);
  });
});
