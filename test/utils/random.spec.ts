import { describe, expect, it } from "vitest";
import {
  ALNUM_CHARSET,
  constantTimeEqual,
  randomHex,
  randomInt,
  randomString,
} from "../../src/utils/random";

describe("randomHex", () => {
  it("produces correct length and charset", () => {
    const h = randomHex(16);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(1)).toMatch(/^[0-9a-f]{2}$/);
  });
});

describe("randomString", () => {
  it("uses given alphabet", () => {
    const s = randomString(1000, "ab");
    expect(s.length).toBe(1000);
    expect(/^[ab]+$/.test(s)).toBe(true);
    expect(new Set(s.split("")).size).toBe(2);
  });

  it("default alphabet is alnum", () => {
    for (let i = 0; i < 50; i++) {
      const s = randomString(24);
      for (const ch of s) expect(ALNUM_CHARSET.includes(ch)).toBe(true);
    }
  });
});

describe("randomInt", () => {
  it("stays in range", () => {
    for (let i = 0; i < 500; i++) {
      const v = randomInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });
});

describe("constantTimeEqual", () => {
  it("matches only identical strings", () => {
    expect(constantTimeEqual("secret123", "secret123")).toBe(true);
    expect(constantTimeEqual("secret123", "secret124")).toBe(false);
    expect(constantTimeEqual("secret123", "secret1234")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("a", "")).toBe(false);
  });
});
