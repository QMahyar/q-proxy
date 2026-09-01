import { describe, expect, it } from "vitest";
import { extractEarlyData, isUpgradeRequest } from "../../src/tunnel/websocket";
import { encodeBase64Url } from "../../src/utils/base64";

describe("isUpgradeRequest", () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request("https://example.com/tun", { headers });
  }

  it("matches websocket upgrades case-insensitively", () => {
    expect(isUpgradeRequest(reqWith({ Upgrade: "websocket" }))).toBe(true);
    expect(isUpgradeRequest(reqWith({ Upgrade: "WebSocket" }))).toBe(true);
    expect(isUpgradeRequest(reqWith({ Upgrade: "WEBSOCKET" }))).toBe(true);
  });

  it("rejects missing or non-websocket upgrade headers", () => {
    expect(isUpgradeRequest(reqWith({}))).toBe(false);
    expect(isUpgradeRequest(reqWith({ Upgrade: "h2c" }))).toBe(false);
  });
});

describe("extractEarlyData", () => {
  it("decodes the first protocol entry as base64url", () => {
    const payload = new Uint8Array([1, 2, 3, 255, 0, 7]);
    const header = `${encodeBase64Url(payload)}, other-proto`;
    const out = extractEarlyData(header, 4096);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([1, 2, 3, 255, 0, 7]);
  });

  it("returns null for missing, empty or whitespace-only headers", () => {
    expect(extractEarlyData(null, 4096)).toBeNull();
    expect(extractEarlyData("", 4096)).toBeNull();
    expect(extractEarlyData("   ,  ,", 4096)).toBeNull();
  });

  it("returns null on invalid base64url payloads", () => {
    expect(extractEarlyData("!!!", 4096)).toBeNull();
    expect(extractEarlyData("not base64!!", 4096)).toBeNull();
  });

  it("drops payloads larger than the per-request cap", () => {
    const payload = new Uint8Array(64);
    expect(extractEarlyData(encodeBase64Url(payload), 32)).toBeNull();
    expect(extractEarlyData(encodeBase64Url(payload), 64)).not.toBeNull();
  });

  it("clamps the cap to the absolute 8192-byte maximum", () => {
    const payload = new Uint8Array(8193);
    expect(extractEarlyData(encodeBase64Url(payload), 1_000_000)).toBeNull();
    const exact = new Uint8Array(8192);
    expect(extractEarlyData(encodeBase64Url(exact), 1_000_000)).not.toBeNull();
  });

  it("clamps a zero or negative cap up to one byte", () => {
    const one = new Uint8Array(1);
    expect(extractEarlyData(encodeBase64Url(one), 0)).not.toBeNull();
    const two = new Uint8Array(2);
    expect(extractEarlyData(encodeBase64Url(two), 0)).toBeNull();
    expect(extractEarlyData(encodeBase64Url(one), -5)).not.toBeNull();
  });
});
