import { describe, expect, it } from "vitest";
import {
  BODY_BUFFER_CAP,
  ByteAccumulator,
  HANDSHAKE_CAP,
  appendChunk,
  dropChunks,
  parseAddress,
  parseAddressValue,
  peekFlat,
} from "../../src/protocols/common";
import { concatBytes, u16be, utf8Encode } from "../../src/utils/bytes";

function ipv4Bytes(): Uint8Array {
  return new Uint8Array([8, 8, 8, 8]);
}

function ipv6Bytes(): Uint8Array {
  return new Uint8Array([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
}

function domainBytes(host: string): Uint8Array {
  const raw = utf8Encode(host);
  return concatBytes(new Uint8Array([raw.length]), raw);
}

describe("ByteAccumulator", () => {
  it("starts empty and tracks appended length", () => {
    const acc = new ByteAccumulator();
    expect(acc.length).toBe(0);
    expect(acc.append(utf8Encode("hello"))).toBe(true);
    expect(acc.length).toBe(5);
    expect(acc.append(utf8Encode("!"))).toBe(true);
    expect(acc.length).toBe(6);
  });

  it("drains chunks concatenated in order and resets", () => {
    const acc = new ByteAccumulator();
    acc.append(utf8Encode("foo"));
    acc.append(utf8Encode("bar"));
    expect(Array.from(acc.drain())).toEqual(Array.from(utf8Encode("foobar")));
    expect(acc.length).toBe(0);
    expect(acc.drain().length).toBe(0);
  });

  it("accepts appends up to the handshake cap exactly", () => {
    const acc = new ByteAccumulator();
    expect(acc.append(new Uint8Array(HANDSHAKE_CAP))).toBe(true);
    expect(acc.length).toBe(HANDSHAKE_CAP);
  });

  it("rejects appends that would exceed the cap without growing", () => {
    const acc = new ByteAccumulator();
    expect(acc.append(new Uint8Array(HANDSHAKE_CAP - 4))).toBe(true);
    expect(acc.append(new Uint8Array(5))).toBe(false);
    expect(acc.length).toBe(HANDSHAKE_CAP - 4);
    expect(acc.append(new Uint8Array(4))).toBe(true);
    expect(acc.append(new Uint8Array(1))).toBe(false);
  });

  it("rejects a single chunk larger than the cap", () => {
    const acc = new ByteAccumulator();
    expect(acc.append(new Uint8Array(HANDSHAKE_CAP + 1))).toBe(false);
    expect(acc.length).toBe(0);
  });
});

describe("appendChunk / peekFlat / dropChunks", () => {
  it("appends while under the body buffer cap", () => {
    const buffer: Uint8Array[] = [];
    expect(appendChunk(buffer, new Uint8Array(100))).toBe(true);
    expect(appendChunk(buffer, new Uint8Array(BODY_BUFFER_CAP - 100))).toBe(true);
    expect(buffer.length).toBe(2);
  });

  it("rejects appends past the cap without mutating the buffer", () => {
    const buffer: Uint8Array[] = [new Uint8Array(BODY_BUFFER_CAP)];
    expect(appendChunk(buffer, new Uint8Array(1))).toBe(false);
    expect(buffer.length).toBe(1);
    expect(buffer[0]!.length).toBe(BODY_BUFFER_CAP);
  });

  it("peeks across chunk boundaries and returns null when short", () => {
    const buffer: Uint8Array[] = [utf8Encode("ab"), utf8Encode("cde")];
    expect(peekFlat(buffer, 6)).toBeNull();
    expect(Array.from(peekFlat(buffer, 5)!)).toEqual(Array.from(utf8Encode("abcde")));
    expect(Array.from(peekFlat(buffer, 3)!)).toEqual(Array.from(utf8Encode("abc")));
  });

  it("drops whole and partial chunks", () => {
    const buffer: Uint8Array[] = [utf8Encode("ab"), utf8Encode("cde")];
    dropChunks(buffer, 3);
    expect(buffer.length).toBe(1);
    expect(Array.from(peekFlat(buffer, 2)!)).toEqual(Array.from(utf8Encode("de")));
    dropChunks(buffer, 10);
    expect(buffer).toEqual([]);
    expect(peekFlat(buffer, 1)).toBeNull();
  });
});

describe("parseAddressValue with vless numbering", () => {
  it("parses ipv4 atype 1", () => {
    const buf = concatBytes(ipv4Bytes(), new Uint8Array([0]));
    const res = parseAddressValue(1, buf, 0);
    expect(res).toEqual({ ok: true, value: { host: "8.8.8.8", nextOffset: 4 } });
  });

  it("parses a domain atype 2 and lowercases it", () => {
    const buf = concatBytes(domainBytes("Example.COM"), new Uint8Array([0]));
    const res = parseAddressValue(2, buf, 0);
    expect(res).toEqual({ ok: true, value: { host: "example.com", nextOffset: 12 } });
  });

  it("parses ipv6 atype 3", () => {
    const res = parseAddressValue(3, ipv6Bytes(), 0);
    expect(res).toEqual({ ok: true, value: { host: "2001:db8:0:0:0:0:0:1", nextOffset: 16 } });
  });

  it("defaults to vless numbering when omitted", () => {
    const buf = domainBytes("example.org");
    expect(parseAddressValue(2, buf, 0)).toEqual({
      ok: true,
      value: { host: "example.org", nextOffset: 12 },
    });
    expect(parseAddressValue(3, buf, 0).ok).toBe(false);
  });

  it("rejects truncated ipv4 and ipv6", () => {
    expect(parseAddressValue(1, new Uint8Array([1, 2, 3]), 0)).toEqual({
      ok: false,
      reason: "truncated ipv4 address",
    });
    expect(parseAddressValue(3, new Uint8Array(15), 0)).toEqual({
      ok: false,
      reason: "truncated ipv6 address",
    });
  });

  it("rejects truncated, empty, and nul-containing domains", () => {
    expect(parseAddressValue(2, new Uint8Array(0), 0)).toEqual({
      ok: false,
      reason: "truncated domain length",
    });
    expect(parseAddressValue(2, new Uint8Array([0]), 0)).toEqual({ ok: false, reason: "empty domain" });
    expect(parseAddressValue(2, new Uint8Array([5, 97, 98]), 0)).toEqual({
      ok: false,
      reason: "truncated domain",
    });
    const withNul = concatBytes(new Uint8Array([3]), new Uint8Array([97, 0, 98]));
    expect(parseAddressValue(2, withNul, 0)).toEqual({ ok: false, reason: "invalid domain byte" });
  });

  it("rejects unknown address types", () => {
    expect(parseAddressValue(9, new Uint8Array([1, 2, 3, 4]), 0)).toEqual({
      ok: false,
      reason: "invalid address type 9",
    });
  });
});

describe("parseAddressValue with socks numbering", () => {
  it("parses a domain atype 3", () => {
    const buf = domainBytes("socks.example");
    const res = parseAddressValue(3, buf, 0, "socks");
    expect(res).toEqual({ ok: true, value: { host: "socks.example", nextOffset: 14 } });
  });

  it("parses ipv6 atype 4", () => {
    const res = parseAddressValue(4, ipv6Bytes(), 0, "socks");
    expect(res).toEqual({ ok: true, value: { host: "2001:db8:0:0:0:0:0:1", nextOffset: 16 } });
  });

  it("still parses ipv4 atype 1", () => {
    expect(parseAddressValue(1, ipv4Bytes(), 0, "socks")).toEqual({
      ok: true,
      value: { host: "8.8.8.8", nextOffset: 4 },
    });
  });

  it("treats vless-only types as invalid", () => {
    expect(parseAddressValue(2, domainBytes("x.io"), 0, "socks")).toEqual({
      ok: false,
      reason: "invalid address type 2",
    });
  });

  it("treats socks-only types as invalid under vless numbering", () => {
    expect(parseAddressValue(4, ipv6Bytes(), 0, "vless")).toEqual({
      ok: false,
      reason: "invalid address type 4",
    });
  });
});

describe("parseAddress", () => {
  it("parses an ipv4 host with port", () => {
    const buf = concatBytes(ipv4Bytes(), u16be(443));
    expect(parseAddress(1, buf, 0)).toEqual({
      ok: true,
      value: { host: "8.8.8.8", port: 443, nextOffset: 6 },
    });
  });

  it("parses a domain host with port", () => {
    const buf = concatBytes(domainBytes("example.com"), u16be(80));
    expect(parseAddress(3, buf, 0)).toEqual({
      ok: true,
      value: { host: "example.com", port: 80, nextOffset: 14 },
    });
  });

  it("rejects a truncated port", () => {
    const buf = concatBytes(ipv4Bytes(), new Uint8Array([1]));
    expect(parseAddress(1, buf, 0)).toEqual({ ok: false, reason: "truncated port" });
  });

  it("rejects port 0", () => {
    const buf = concatBytes(ipv4Bytes(), u16be(0));
    expect(parseAddress(1, buf, 0)).toEqual({ ok: false, reason: "invalid port 0" });
  });

  it("propagates address errors", () => {
    expect(parseAddress(9, new Uint8Array([1, 2, 3, 4]), 0)).toEqual({
      ok: false,
      reason: "invalid address type 9",
    });
  });
});
