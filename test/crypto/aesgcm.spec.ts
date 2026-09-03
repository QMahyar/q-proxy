import { beforeEach, describe, expect, it } from "vitest";
import {
  aesGcmKeyFor,
  aesGcmOpenWith,
  aesGcmSealWith,
  aesGcmKeyImportsForTests,
  resetAesGcmKeyCacheForTests,
} from "../../src/crypto/aesgcm";

function randomKey(len = 16): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

describe("aesgcm key cache", () => {
  beforeEach(() => resetAesGcmKeyCacheForTests());

  it("imports each distinct session key exactly once across many frames", async () => {
    const key = randomKey();
    const nonce = new Uint8Array(12);
    const ck = await aesGcmKeyFor(key, "encrypt");
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 25; i++) {
      frames.push(await aesGcmSealWith(ck, nonce, new TextEncoder().encode(`frame-${i}`), null));
    }
    expect(aesGcmKeyImportsForTests()).toBe(1);

    const dk = await aesGcmKeyFor(key, "decrypt");
    for (let i = 0; i < 25; i++) {
      const pt = await aesGcmOpenWith(dk, nonce, frames[i]!, null);
      expect(new TextDecoder().decode(pt!)).toBe(`frame-${i}`);
    }
    expect(aesGcmKeyImportsForTests()).toBe(2);
  });

  it("keeps encrypt and decrypt key handles in separate slots", async () => {
    const key = randomKey();
    await aesGcmKeyFor(key, "encrypt");
    await aesGcmKeyFor(key, "encrypt");
    await aesGcmKeyFor(key, "decrypt");
    expect(aesGcmKeyImportsForTests()).toBe(2);
  });

  it("distinguishes distinct key material", async () => {
    await aesGcmKeyFor(randomKey(), "encrypt");
    await aesGcmKeyFor(randomKey(), "encrypt");
    expect(aesGcmKeyImportsForTests()).toBe(2);
  });

  it("round-trips aad and rejects tampering", async () => {
    const key = randomKey(32);
    const nonce = randomKey(12);
    const aad = new TextEncoder().encode("header");
    const pt = new TextEncoder().encode("payload body");
    const sealed = await aesGcmSealWith(await aesGcmKeyFor(key, "encrypt"), nonce, pt, aad);
    const opened = await aesGcmOpenWith(await aesGcmKeyFor(key, "decrypt"), nonce, sealed, aad);
    expect(Array.from(opened!)).toEqual(Array.from(pt));
    const bad = await aesGcmOpenWith(await aesGcmKeyFor(key, "decrypt"), nonce, sealed, new TextEncoder().encode("headrX"));
    expect(bad).toBeNull();
  });
});
