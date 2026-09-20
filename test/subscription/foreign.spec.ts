import { describe, expect, it } from "vitest";
import { MAX_FOREIGN_LINES, MAX_FOREIGN_SOURCES, parseForeignLists } from "../../src/subscription/foreign";

const VLESS_A = "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@203.0.113.10:443?security=tls&type=ws#one";
const VLESS_B = "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@example.com:8443?security=tls&type=ws#two";

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

describe("parseForeignLists", () => {
  it("extracts host:port endpoints from vless URIs in one source", () => {
    const out = parseForeignLists(`${VLESS_A}\n${VLESS_B}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.tag).toBe("Source 1");
    expect(out[0]!.endpoints).toEqual(["203.0.113.10:443", "example.com:8443"]);
    expect(out[0]!.invalid).toEqual([]);
  });

  it("splits blank-line-separated blocks into tagged per-source previews", () => {
    const out = parseForeignLists(`${VLESS_A}\n\n${VLESS_B}\n\nnot a line at all!!!`);
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.tag)).toEqual(["Source 1", "Source 2", "Source 3"]);
    expect(out[0]!.endpoints).toEqual(["203.0.113.10:443"]);
    expect(out[2]!.endpoints).toEqual([]);
    expect(out[2]!.invalid).toHaveLength(1);
    expect(out[2]!.invalid[0]!.line).toBe(1);
  });

  it("accepts bare host:port lines with a 443 default for bare hosts", () => {
    const out = parseForeignLists("203.0.113.20:8443\nexample.org");
    expect(out[0]!.endpoints).toEqual(["203.0.113.20:8443", "example.org:443"]);
  });

  it("expands a base64 blob of vless lines", () => {
    const out = parseForeignLists(b64(`${VLESS_A}\n${VLESS_B}`));
    expect(out[0]!.endpoints).toEqual(["203.0.113.10:443", "example.com:8443"]);
  });

  it("rejects non-vless schemes instead of guessing", () => {
    const out = parseForeignLists("vmess://eyJhZGRyZXNzIjoiMS4yLjMuNCJ9\ntrojan://pass@1.2.3.4:443\nss://YWVzLTI1Ni1nY206cGFzc0AxLjIuMy40OjgzODg=");
    expect(out[0]!.endpoints).toEqual([]);
    expect(out[0]!.invalid).toHaveLength(3);
    expect(out[0]!.invalid.every((e) => e.reason.includes("vless"))).toBe(true);
  });

  it("returns no sources for empty input and never throws on garbage", () => {
    expect(parseForeignLists("")).toEqual([]);
    expect(parseForeignLists("   \n\n  ")).toEqual([]);
    expect(() => parseForeignLists("\0\0\0\n\xff\xfe binary \x01 junk")).not.toThrow();
  });

  it("caps sources and lines per source", () => {
    const many = Array.from({ length: MAX_FOREIGN_SOURCES + 5 }, (_, i) => `203.0.113.1:${(i % 1000) + 1}`).join("\n\n");
    expect(parseForeignLists(many)).toHaveLength(MAX_FOREIGN_SOURCES);
    const long = Array.from({ length: MAX_FOREIGN_LINES + 10 }, (_, i) => `203.0.113.${(i % 250) + 1}:443`).join("\n");
    const out = parseForeignLists(long);
    expect(out).toHaveLength(1);
    expect(out[0]!.endpoints.length).toBeLessThanOrEqual(MAX_FOREIGN_LINES);
  });
});
