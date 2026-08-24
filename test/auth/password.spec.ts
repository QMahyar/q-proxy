import { describe, expect, it } from "vitest";
import { PBKDF2_ITERATIONS, hashPassword, verifyPassword } from "../../src/auth/password";

describe("password hashing", () => {
  it("uses the documented PBKDF2-SHA256 iteration compromise", () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
  });

  it("still verifies legacy 15k hashes", async () => {
    const salt = "a".repeat(32);
    const password = "legacy-check";
    const legacyHash = await (async () => {
      const mod = await import("../../src/auth/password");
      const { LEGACY_PBKDF2_ITERATIONS, PBKDF2_HASH } = mod;
      const { hexToBytes, bytesToHex, utf8Encode } = await import("../../src/utils/bytes");
      const saltBytes = hexToBytes(salt)!;
      const key = await crypto.subtle.importKey("raw", utf8Encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: PBKDF2_HASH, salt: saltBytes, iterations: LEGACY_PBKDF2_ITERATIONS }, key, 256);
      return bytesToHex(new Uint8Array(bits));
    })();
    expect(await verifyPassword(password, legacyHash, salt)).toBe(true);
  });

  it("produces hex hash (32 bytes) and salt (16 bytes)", async () => {
    const { hash, salt } = await hashPassword("hunter2hunter2");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("verifies the correct password and rejects wrong ones", async () => {
    const { hash, salt } = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash, salt)).toBe(true);
    expect(await verifyPassword("correct horse battery staplx", hash, salt)).toBe(false);
    expect(await verifyPassword("", hash, salt)).toBe(false);
  });

  it("salts every hash uniquely", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword("same-password", a.hash, b.salt)).toBe(false);
  });

  it("fails closed on malformed inputs without throwing", async () => {
    const { hash, salt } = await hashPassword("some-password");
    expect(await verifyPassword("some-password", "zz", salt)).toBe(false);
    expect(await verifyPassword("some-password", hash, "xyz!")).toBe(false);
    expect(await verifyPassword("some-password", "", "")).toBe(false);
  });
});
