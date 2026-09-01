import { describe, expect, it } from "vitest";
import { parseUuid } from "../../src/utils/uuid";

describe("parseUuid", () => {
  it("parses dashed and compact forms into 16 bytes", () => {
    expect(Array.from(parseUuid("00010203-0405-0607-0809-0a0b0c0d0e0f")!)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
    expect(parseUuid("000102030405060708090a0b0c0d0e0f")).toEqual(parseUuid("00010203-0405-0607-0809-0a0b0c0d0e0f"));
    expect(parseUuid("00010203-0405-0607-0809-0A0B0C0D0E0F")).not.toBeNull();
  });

  it("rejects wrong lengths and non-hex input", () => {
    expect(parseUuid("")).toBeNull();
    expect(parseUuid("00010203-0405-0607-0809-0a0b0c0d0e0")).toBeNull();
    expect(parseUuid("00010203-0405-0607-0809-0a0b0c0d0e0ff")).toBeNull();
    expect(parseUuid("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz")).toBeNull();
    expect(parseUuid("not-a-uuid")).toBeNull();
  });
});
