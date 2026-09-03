import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../../src/utils/hmac";

describe("hmacSha256Hex — RFC 4231 known-answer vectors", () => {
  it("matches test case 1 (20-byte 0x0b key, 'Hi There')", async () => {
    const key = "\u000b".repeat(20);
    expect(await hmacSha256Hex("Hi There", key)).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it("matches test case 2 ('Jefe' key)", async () => {
    expect(await hmacSha256Hex("what do ya want for nothing?", "Jefe")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("matches the RFC 4231 TC1 key with an empty message", async () => {
    const key = "\u000b".repeat(20);
    expect(await hmacSha256Hex("", key)).toBe(
      "999a901219f032cd497cadb5e6051e97b6a29ab297bd6ae722bd6062a2f59542",
    );
  });

  it("rejects a zero-length key (WebCrypto importKey constraint)", async () => {
    await expect(hmacSha256Hex("payload", "")).rejects.toThrow();
  });

  it("hashes a longer-than-block key with a multi-byte UTF-8 message", async () => {
    const key = "\u00e9".repeat(80);
    expect(await hmacSha256Hex("π-zip", key)).toBe(
      "e8a772f955e756692b39371ba58b82b9e4577e2f1fdce39e668065d0ae8dcc99",
    );
  });

  it("is deterministic and hex-encoded", async () => {
    const a = await hmacSha256Hex("payload", "secret");
    const b = await hmacSha256Hex("payload", "secret");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different signatures for different secrets and messages", async () => {
    const base = await hmacSha256Hex("payload", "secret-a");
    expect(await hmacSha256Hex("payload", "secret-b")).not.toBe(base);
    expect(await hmacSha256Hex("payload2", "secret-a")).not.toBe(base);
  });
});
