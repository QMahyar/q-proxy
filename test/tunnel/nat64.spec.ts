import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIpv4, synthesizeNat64Address } from "../../src/tunnel/nat64";
import { clearResolverCache } from "../../src/tunnel/resolver";
import { writeU16BE } from "../../src/utils/bytes";
import { isIPv6 } from "../../src/utils/net";

afterEach(() => {
  vi.unstubAllGlobals();
  clearResolverCache();
});

function buildDnsResponse(name: string, qtype: number, rdata: Uint8Array): Uint8Array {
  const labels = name.split(".");
  let qlen = 1;
  for (const l of labels) qlen += l.length + 1;
  const answerLen = 2 + 10 + rdata.length;
  const out = new Uint8Array(12 + qlen + 4 + answerLen);
  out[2] = 0x81;
  out[3] = 0x80;
  out[5] = 1;
  out[7] = 1;
  let off = 12;
  for (const l of labels) {
    out[off++] = l.length;
    for (let i = 0; i < l.length; i++) out[off++] = l.charCodeAt(i);
  }
  out[off++] = 0;
  writeU16BE(out, off, qtype);
  writeU16BE(out, off + 2, 1);
  off += 4;
  out[off++] = 0xc0;
  out[off++] = 0x0c;
  writeU16BE(out, off, qtype);
  writeU16BE(out, off + 8, rdata.length);
  off += 10;
  out.set(rdata, off);
  return out;
}

describe("synthesizeNat64Address", () => {
  it("appends the IPv4 address as hex groups after the /96 prefix", () => {
    expect(synthesizeNat64Address("[2602:fc59:b0:64::]", "1.2.3.4")).toBe(
      "2602:fc59:b0:64::102:304",
    );
  });

  it("handles the well-known 64:ff9b prefix without brackets", () => {
    expect(synthesizeNat64Address("64:ff9b::", "93.184.216.34")).toBe(
      "64:ff9b::5db8:d822",
    );
  });

  it("pads short prefixes with zero groups up to 96 bits", () => {
    const result = synthesizeNat64Address("2a02:898:146:64::", "255.254.253.252");
    expect(result).toBe("2a02:898:146:64::fffe:fdfc");
  });

  it("accepts explicit /96 length suffixes", () => {
    expect(synthesizeNat64Address("[2602:fc59:b0:64::/96]", "1.2.3.4")).toBe(
      "2602:fc59:b0:64::102:304",
    );
  });

  it("rejects prefix lengths other than exactly 96", () => {
    expect(synthesizeNat64Address("[2602:fc59:b0:64::/64]", "1.2.3.4")).toBeNull();
    expect(synthesizeNat64Address("[2602:fc59:b0:64::/128]", "1.2.3.4")).toBeNull();
    expect(synthesizeNat64Address("64:ff9b::/95", "1.2.3.4")).toBeNull();
    expect(synthesizeNat64Address("[2602:fc59:b0:64::/abc]", "1.2.3.4")).toBeNull();
  });

  it("rejects invalid prefixes and addresses", () => {
    expect(synthesizeNat64Address("999::zz::1", "1.2.3.4")).toBeNull();
    expect(synthesizeNat64Address("2602:fc59:b0:64::", "not-an-ip")).toBeNull();
    expect(synthesizeNat64Address("", "1.2.3.4")).toBeNull();
  });

  it("produces valid IPv6 output usable for dialing", () => {
    const result = synthesizeNat64Address("[2602:fc59:11:64::]", "8.8.4.4")!;
    expect(isIPv6(result)).toBe(true);
  });
});

describe("resolveIpv4", () => {
  it("passes literal IPv4 through without DNS", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await resolveIpv4("9.9.9.9", "https://dns.example/dns-query")).toBe("9.9.9.9");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves domains to their first A record over DoH", async () => {
    const response = buildDnsResponse("dest.example", 1, new Uint8Array([104, 16, 132, 229]));
    const fetchMock = vi.fn(async (_url: unknown) => new Response(response as unknown as BodyInit));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveIpv4("dest.example.", "https://dns.example/dns-query")).toBe("104.16.132.229");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://dns.example/dns-query");
  });

  it("refuses IPv6 literals and local names", async () => {
    expect(await resolveIpv4("2606:4700::1111", "https://dns.example")).toBeNull();
    expect(await resolveIpv4("box.local", "https://dns.example")).toBeNull();
    expect(await resolveIpv4("localhost", "https://dns.example")).toBeNull();
  });
});

describe("nat64 strategy synthesis chain", () => {
  it("synthesizes distinct candidates per configured prefix", async () => {
    const prefixes = ["[2a02:898:146:64::]", "[2602:fc59:b0:64::]", "[2602:fc59:11:64::]"];
    const hosts = prefixes
      .map((p) => synthesizeNat64Address(p, "1.1.1.1"))
      .filter((h): h is string => h !== null);
    expect(hosts).toHaveLength(3);
    expect(new Set(hosts).size).toBe(3);
    for (const host of hosts) expect(isIPv6(host)).toBe(true);
  });
});
