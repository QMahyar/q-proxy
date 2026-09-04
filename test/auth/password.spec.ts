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
    expect(await verifyPassword(password, legacyHash, salt)).toEqual({ ok: true, tier: "legacy" });
  });

  it("produces hex hash (32 bytes) and salt (16 bytes)", async () => {
    const { hash, salt } = await hashPassword("hunter2hunter2");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("verifies the correct password and rejects wrong ones", async () => {
    const pepper = "9f".repeat(32);
    const { hash, salt } = await hashPassword("correct horse battery staple", pepper);
    expect(await verifyPassword("correct horse battery staple", hash, salt, pepper)).toEqual({
      ok: true,
      tier: "current",
    });
    expect(await verifyPassword("correct horse battery staplx", hash, salt, pepper)).toEqual({
      ok: false,
      tier: "current",
    });
    expect(await verifyPassword("", hash, salt, pepper)).toEqual({ ok: false, tier: "current" });
  });

  it("salts every hash uniquely", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword("same-password", a.hash, b.salt)).toEqual({
      ok: false,
      tier: "current",
    });
  });

  it("fails closed on malformed inputs without throwing", async () => {
    const { hash, salt } = await hashPassword("some-password");
    expect(await verifyPassword("some-password", "zz", salt)).toEqual({ ok: false, tier: "current" });
    expect(await verifyPassword("some-password", hash, "xyz!")).toEqual({ ok: false, tier: "current" });
    expect(await verifyPassword("some-password", "", "")).toEqual({ ok: false, tier: "current" });
  });

  it("rejects peppered hashes when the pepper is missing or tampered", async () => {
    const pepper = "9f".repeat(32);
    const { hash, salt } = await hashPassword("kv-theft-probe", pepper);
    expect(await verifyPassword("kv-theft-probe", hash, salt)).toEqual({
      ok: false,
      tier: "current",
    });
    expect(await verifyPassword("kv-theft-probe", hash, salt, "00".repeat(32))).toEqual({
      ok: false,
      tier: "current",
    });
  });

  it("upgrades unpeppered 100k hashes to peppered", async () => {
    const pepper = "9f".repeat(32);
    const password = "upgrade-me-100k";
    const { hash, salt } = await hashPassword(password);
    expect(await verifyPassword(password, hash, salt, pepper)).toEqual({
      ok: true,
      tier: "legacy",
    });
    const upgraded = await hashPassword(password, pepper);
    expect(upgraded.hash).not.toBe(hash);
    expect(await verifyPassword(password, upgraded.hash, upgraded.salt, pepper)).toEqual({
      ok: true,
      tier: "current",
    });
    expect(await verifyPassword(password, upgraded.hash, upgraded.salt)).toEqual({
      ok: false,
      tier: "current",
    });
  });

  it("upgrades unpeppered 15k legacy hashes to peppered", async () => {
    const pepper = "9f".repeat(32);
    const password = "upgrade-me-15k";
    const salt = "b".repeat(32);
    const mod = await import("../../src/auth/password");
    const { hexToBytes, bytesToHex, utf8Encode } = await import("../../src/utils/bytes");
    const saltBytes = hexToBytes(salt)!;
    const key = await crypto.subtle.importKey("raw", utf8Encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: mod.PBKDF2_HASH, salt: saltBytes, iterations: mod.LEGACY_PBKDF2_ITERATIONS }, key, 256);
    const legacyHash = bytesToHex(new Uint8Array(bits));
    expect(await verifyPassword(password, legacyHash, salt, pepper)).toEqual({
      ok: true,
      tier: "legacy",
    });
    expect(await verifyPassword(password, legacyHash, salt, "00".repeat(32))).toEqual({
      ok: true,
      tier: "legacy",
    });
    const upgraded = await hashPassword(password, pepper);
    expect(await verifyPassword(password, upgraded.hash, upgraded.salt, pepper)).toEqual({
      ok: true,
      tier: "current",
    });
    expect(await verifyPassword("wrong-password", upgraded.hash, upgraded.salt, pepper)).toEqual({
      ok: false,
      tier: "current",
    });
  });
});
