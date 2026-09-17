import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { fillIdentity, hasIdentity } from "../../src/settings/seed";

const FIXED_UUID = "00000000-1111-2222-3333-444444444444";

function stubDeterministicCrypto(): void {
  const fake = {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < view.length; i++) {
        view[i] = (i * 31 + 7) & 0xff;
      }
      return array;
    },
    randomUUID(): string {
      return FIXED_UUID;
    },
  };
  vi.stubGlobal("crypto", fake);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fillIdentity", () => {
  it("is deterministic under a mocked randomness source", () => {
    stubDeterministicCrypto();
    const a = fillIdentity(structuredClone(DEFAULT_SETTINGS));
    const b = fillIdentity(structuredClone(DEFAULT_SETTINGS));
    expect(a.securePath).toBe(b.securePath);
    expect(a.vlessUuid).toBe(b.vlessUuid);
    expect(a.sessionSecret).toBe(b.sessionSecret);
  });

  it("fills every identity field with the documented shapes", () => {
    stubDeterministicCrypto();
    const s = fillIdentity(structuredClone(DEFAULT_SETTINGS));
    expect(hasIdentity(s)).toBe(true);
    expect(s.securePath).toMatch(/^[0-9a-f]{24}$/);
    expect(s.vlessUuid).toBe(FIXED_UUID);
    expect(s.sessionSecret).toMatch(/^[0-9a-f]{128}$/);
  });

  it("no longer knows removed identity fields", () => {
    for (const key of ["vmessUuid", "trojanPassword", "ssPassword"]) {
      expect(key in DEFAULT_SETTINGS).toBe(false);
    }
  });

  it("preserves already-present identity fields", () => {
    stubDeterministicCrypto();
    const base = structuredClone(DEFAULT_SETTINGS);
    base.securePath = "existingpath123";
    base.vlessUuid = "kept-uuid";
    const s = fillIdentity(base);
    expect(s.securePath).toBe("existingpath123");
    expect(s.vlessUuid).toBe("kept-uuid");
    expect(s.sessionSecret).toMatch(/^[0-9a-f]{128}$/);
  });
});

describe("hasIdentity", () => {
  it("detects missing fields", () => {
    expect(hasIdentity(structuredClone(DEFAULT_SETTINGS))).toBe(false);
    const partial = structuredClone(DEFAULT_SETTINGS);
    partial.securePath = "x";
    partial.vlessUuid = "u";
    partial.sessionSecret = "";
    expect(hasIdentity(partial)).toBe(false);
  });
});
