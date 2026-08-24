import { describe, expect, it } from "vitest";
import { parseTraceIp } from "../../src/handlers/myip";

describe("parseTraceIp", () => {
  it("extracts the ip line from a cdn-cgi/trace payload", () => {
    const trace = "fl=123\nh=www.cloudflare.com\nip=203.0.113.7\nts=1700000000\nloc=DE\ncolo=FRA";
    expect(parseTraceIp(trace)).toBe("203.0.113.7");
  });

  it("handles ipv6 egress addresses", () => {
    expect(parseTraceIp("ip=2606:4700:4700::1111\n")).toBe("2606:4700:4700::1111");
  });

  it("returns null when the ip line is missing or empty", () => {
    expect(parseTraceIp("fl=1\nloc=US")).toBeNull();
    expect(parseTraceIp("ip=\n")).toBeNull();
    expect(parseTraceIp("")).toBeNull();
  });
});
