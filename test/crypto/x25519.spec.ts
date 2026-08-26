import { describe, expect, it } from "vitest";
import {
  generateKeypair,
  isBase64Key32,
  publicKeyFromPrivate,
  sharedSecret,
  x25519,
} from "../../src/crypto/x25519";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64ToHex(b64: string): string {
  return bytesToHex(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

describe("x25519", () => {
  it("matches RFC 7748 vector 1", () => {
    const k = hexToBytes("a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4");
    const u = hexToBytes("e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c");
    expect(bytesToHex(x25519(k, u))).toBe(
      "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552",
    );
  });

  it("matches RFC 7748 vector 2", () => {
    const k = hexToBytes("4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d");
    const u = hexToBytes("e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493");
    expect(bytesToHex(x25519(k, u))).toBe(
      "95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957",
    );
  });

  it("derives the RFC 7748 Diffie-Hellman shared secret", () => {
    const alicePriv = hexToBytes("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
    const bobPriv = hexToBytes("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
    const alicePub = x25519(alicePriv, Uint8Array.from([9, ...new Array(31).fill(0)]));
    const bobPub = x25519(bobPriv, Uint8Array.from([9, ...new Array(31).fill(0)]));
    expect(bytesToHex(alicePub)).toBe("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
    expect(bytesToHex(bobPub)).toBe("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
    expect(bytesToHex(x25519(alicePriv, bobPub))).toBe(
      "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
    );
    expect(bytesToHex(x25519(bobPriv, alicePub))).toBe(
      "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
    );
  });

  it("generates keypairs whose public key derives from the private key", () => {
    const { privateKey, publicKey } = generateKeypair();
    expect(isBase64Key32(privateKey)).toBe(true);
    expect(isBase64Key32(publicKey)).toBe(true);
    expect(publicKeyFromPrivate(privateKey)).toBe(publicKey);
  });

  it("computes the same shared secret from b64 keys", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    expect(sharedSecret(a.privateKey, b.publicKey)).toBe(sharedSecret(b.privateKey, a.publicKey));
  });

  it("rejects malformed base64 keys", () => {
    expect(isBase64Key32("not-a-key")).toBe(false);
    expect(isBase64Key32(btoa("short"))).toBe(false);
    expect(isBase64Key32("AAAA" + "A".repeat(39) + "==")).toBe(false);
  });

  it("matches the known WARP test keypair derivation", () => {
    const priv = btoa(
      String.fromCharCode(...hexToBytes("e8f19f92aa1a2e8a3d0c0b0a0b0c0d0e0f00112233445566778899aabbccddee")),
    );
    const pub = publicKeyFromPrivate(priv);
    expect(isBase64Key32(pub)).toBe(true);
  });
});
