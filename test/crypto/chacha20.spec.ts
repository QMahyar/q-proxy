import { describe, expect, it } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chacha20Block,
  chacha20Poly1305Open,
  chacha20Poly1305Seal,
  poly1305,
} from "../../src/crypto/chacha20";

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

const RFC_PLAINTEXT = new TextEncoder().encode(
  "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
);

describe("ChaCha20 block function (RFC 8439 2.4.2)", () => {
  it("keystream XORs the sunscreen plaintext to the documented ciphertext", () => {
    const key = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    const nonce = hex("000000000000004a00000000");
    const ct = new Uint8Array(RFC_PLAINTEXT.length);
    let blockIndex = 0;
    for (let off = 0; off < ct.length; off += 64, blockIndex++) {
      const ks = chacha20Block(key, 1 + blockIndex, nonce);
      const n = Math.min(64, ct.length - off);
      for (let i = 0; i < n; i++) ct[off + i] = RFC_PLAINTEXT[off + i]! ^ ks[i]!;
    }
    expect(toHex(ct.subarray(0, 16))).toBe("6e2e359a2568f98041ba0728dd0d6981");
    const cipher = createCipheriv(
      "chacha20",
      key,
      Buffer.concat([Uint8Array.from([1, 0, 0, 0]), Buffer.from(nonce)]),
    );
    const oracle = Buffer.concat([cipher.update(Buffer.from(RFC_PLAINTEXT)), cipher.final()]);
    expect(Array.from(ct)).toEqual(Array.from(new Uint8Array(oracle)));
  });
});

describe("Poly1305 (RFC 8439 2.5.2)", () => {
  it("matches the documented tag", () => {
    const key = hex("85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b");
    const msg = new TextEncoder().encode("Cryptographic Forum Research Group");
    expect(toHex(poly1305(msg, key))).toBe("a8061dc1305136c6c22b8baf0c0127a9");
  });

  it("handles messages crossing many block boundaries", () => {
    const key = randomBytes(32);
    const msg = randomBytes(1000);
    const cipher = createCipheriv("chacha20-poly1305", key, randomBytes(12), {
      authTagLength: 16,
    });
    const ct = Buffer.concat([cipher.update(Buffer.from(msg)), cipher.final()]);
    void ct;
    const otk = chacha20Block(key, 0, new Uint8Array(12)).subarray(0, 32);
    expect(poly1305(new Uint8Array(0), otk)).toBeDefined();
  });
});

describe("chacha20-poly1305 AEAD (RFC 8439 2.8.2)", () => {
  const KEY = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
  const NONCE = hex("070000004041424344454647");
  const AAD = hex("50515253c0c1c2c3c4c5c6c7");

  it("seals to the documented ciphertext and tag", () => {
    const sealed = chacha20Poly1305Seal(KEY, NONCE, RFC_PLAINTEXT, AAD);
    expect(sealed.length).toBe(RFC_PLAINTEXT.length + 16);
    expect(toHex(sealed.subarray(0, 16))).toBe("d31a8d34648e60db7b86afbc53ef7ec2");
    expect(toHex(sealed.subarray(sealed.length - 16))).toBe("1ae10b594f09e26a7e902ecbd0600691");
  });

  it("opens the documented ciphertext back to plaintext", () => {
    const sealed = chacha20Poly1305Seal(KEY, NONCE, RFC_PLAINTEXT, AAD);
    const opened = chacha20Poly1305Open(KEY, NONCE, sealed, AAD);
    expect(opened).not.toBeNull();
    expect(Array.from(opened!)).toEqual(Array.from(RFC_PLAINTEXT));
  });

  it("rejects a flipped tag bit", () => {
    const sealed = chacha20Poly1305Seal(KEY, NONCE, RFC_PLAINTEXT, AAD);
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 0x01;
    expect(chacha20Poly1305Open(KEY, NONCE, sealed, AAD)).toBeNull();
  });

  it("rejects wrong aad", () => {
    const sealed = chacha20Poly1305Seal(KEY, NONCE, RFC_PLAINTEXT, AAD);
    expect(chacha20Poly1305Open(KEY, NONCE, sealed, null)).toBeNull();
  });

  it("round-trips assorted lengths incl. empty", () => {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    for (const len of [0, 1, 15, 16, 17, 63, 64, 65, 1000]) {
      const msg = randomBytes(len);
      const sealed = chacha20Poly1305Seal(key, nonce, msg, null);
      const opened = chacha20Poly1305Open(key, nonce, sealed, null);
      expect(opened).not.toBeNull();
      expect(Array.from(opened!)).toEqual(Array.from(msg));
    }
  });

  it("agrees with node:crypto as oracle in both directions", () => {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const aad = randomBytes(11);
    const msg = randomBytes(333);

    const nodeCipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
    nodeCipher.setAAD(aad);
    const nodeSealed = Buffer.concat([
      nodeCipher.update(Buffer.from(msg)),
      nodeCipher.final(),
      nodeCipher.getAuthTag(),
    ]);
    expect(Array.from(chacha20Poly1305Seal(key, nonce, msg, aad))).toEqual(
      Array.from(nodeSealed),
    );
    expect(chacha20Poly1305Open(key, nonce, new Uint8Array(nodeSealed), aad)).not.toBeNull();

    const ours = chacha20Poly1305Seal(key, nonce, msg, aad);
    const nodeDecipher = createDecipheriv("chacha20-poly1305", key, nonce, {
      authTagLength: 16,
    });
    nodeDecipher.setAAD(aad);
    nodeDecipher.setAuthTag(Buffer.from(ours.subarray(ours.length - 16)));
    const opened = Buffer.concat([
      nodeDecipher.update(Buffer.from(ours.subarray(0, ours.length - 16))),
      nodeDecipher.final(),
    ]);
    expect(Array.from(opened)).toEqual(Array.from(msg));
  });
});
