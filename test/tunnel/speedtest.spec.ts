import { describe, expect, it } from "vitest";
import { matchesSpeedtestHost, speedtestResponseBytes } from "../../src/tunnel/speedtest";
import { utf8Decode } from "../../src/utils/bytes";

describe("matchesSpeedtestHost", () => {
  it("matches both canonical hosts", () => {
    expect(matchesSpeedtestHost("speed.cloudflare.com")).toBe(true);
    expect(matchesSpeedtestHost("cp.cloudflare.com")).toBe(true);
  });

  it("is case-insensitive and strips trailing dots", () => {
    expect(matchesSpeedtestHost("SPEED.Cloudflare.COM.")).toBe(true);
    expect(matchesSpeedtestHost("CP.cloudflare.com...")).toBe(true);
  });

  it("rejects lookalikes and other hosts", () => {
    expect(matchesSpeedtestHost("speed.cloudflare.com.evil.test")).toBe(false);
    expect(matchesSpeedtestHost("sub.speed.cloudflare.com")).toBe(false);
    expect(matchesSpeedtestHost("cloudflare.com")).toBe(false);
    expect(matchesSpeedtestHost("")).toBe(false);
  });
});

describe("speedtestResponseBytes", () => {
  it("is a minimal valid HTTP/1.1 204 response", () => {
    const text = utf8Decode(speedtestResponseBytes());
    expect(text.startsWith("HTTP/1.1 204 No Content\r\n")).toBe(true);
    expect(text).toContain("Content-Length: 0\r\n");
    expect(text.endsWith("\r\n\r\n")).toBe(true);
  });

  it("returns identical bytes across calls", () => {
    const a = speedtestResponseBytes();
    const b = speedtestResponseBytes();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
