import { describe, expect, it } from "vitest";
import { crc32, zipStore } from "../../src/warp/zip";

describe("crc32", () => {
  it("matches the standard check value", () => {
    const data = new TextEncoder().encode("123456789");
    expect(crc32(data)).toBe(0xcbf43926);
  });

  it("is zero for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("zipStore", () => {
  it("produces a structurally valid store-only zip", () => {
    const files = { "a.conf": "hello world\n", "b-dir/c.conf": "second entry" };
    const zip = zipStore(files);
    expect(zip.length).toBeGreaterThan(0);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const endSig = 0x06054b50;
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0 && i < zip.length; i--) {
      if (view.getUint32(i, true) === endSig) {
        eocd = i;
        break;
      }
    }
    expect(eocd).toBeGreaterThan(0);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    const cdOffset = view.getUint32(eocd + 16, true);
    expect(view.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(view.getUint16(cdOffset + 10, true)).toBe(0);
  });

  it("round-trips content via CRC + local header layout", () => {
    const content = "PrivateKey = abc\n";
    const zip = zipStore({ "x.conf": content });
    const view = new DataView(zip.buffer);
    const nameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    const size = view.getUint32(18, true);
    const dataStart = 30 + nameLen + extraLen;
    const data = zip.slice(dataStart, dataStart + size);
    expect(new TextDecoder().decode(data)).toBe(content);
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode(content)));
  });
});
