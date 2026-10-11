import { describe, expect, it } from "vitest";
import {
  expandWildcard,
  parsePreferredLine,
  parsePreferredList,
  preferredProxyIpCandidates,
  type PreferredEntry,
} from "../../src/nodes/preferred";

function valid(line: string): PreferredEntry {
  const r = parsePreferredLine(line);
  expect(r.ok, line).toBe(true);
  return (r as { ok: true; value: PreferredEntry }).value;
}

function invalid(line: string): string {
  const r = parsePreferredLine(line);
  expect(r.ok, line).toBe(false);
  return (r as { ok: false; reason: string }).reason;
}

describe("parsePreferredLine direct entries", () => {
  it("parses a bare host and an ip:port pair", () => {
    expect(valid("1.2.3.4")).toMatchObject({ kind: "direct", host: "1.2.3.4", port: null, proxyIp: false });
    expect(valid("1.2.3.4:443")).toMatchObject({ kind: "direct", host: "1.2.3.4", port: 443 });
    expect(valid("alt.example.net")).toMatchObject({ kind: "direct", host: "alt.example.net", port: null });
    expect(valid("  5.6.7.8:2053  ")).toMatchObject({ host: "5.6.7.8", port: 2053 });
  });

  it("splits a #remark label without consuming it as host", () => {
    expect(valid("1.2.3.4:443#Tehran HP")).toMatchObject({
      kind: "direct",
      host: "1.2.3.4",
      port: 443,
      remark: "Tehran HP",
      chain: null,
    });
    expect(valid("1.2.3.4#bare remark")).toMatchObject({ host: "1.2.3.4", port: null, remark: "bare remark" });
  });

  it("parses a $proto:// chain suffix out of the remark", () => {
    const v = valid("1.2.3.4:443#via$socks5://user:pass@9.9.9.9:1080");
    expect(v.remark).toBe("via");
    expect(v.chain).toBe("socks5://user:pass@9.9.9.9:1080");
    for (const scheme of ["http", "https", "turn", "sstp"]) {
      expect(valid(`1.2.3.4:443#r$${scheme}://x:1`).chain).toBe(`${scheme}://x:1`);
    }
  });

  it("accepts ?proxyip=true on direct lines", () => {
    expect(valid("1.2.3.4:443?proxyip=true")).toMatchObject({ proxyIp: true, remark: "" });
    expect(valid("1.2.3.4:443#r?proxyip=true")).toMatchObject({ proxyIp: true, remark: "r" });
  });

  it("keeps wildcard segments literal and flags them", () => {
    const v = valid("192.168.*.*:443#wild");
    expect(v.wildcard).toBe(true);
    expect(v.host).toBe("192.168.*.*");
    expect(valid("10.0.0.1:443").wildcard).toBe(false);
  });
});

describe("parsePreferredLine sub:// entries", () => {
  it("parses sub://host:port with remark and proxyip flag", () => {
    expect(valid("sub://1.2.3.4:443#home?proxyip=true")).toMatchObject({
      kind: "sub",
      host: "1.2.3.4",
      port: 443,
      remark: "home",
      proxyIp: true,
    });
    expect(valid("SUB://5.6.7.8")).toMatchObject({ kind: "sub", host: "5.6.7.8", port: null, proxyIp: false });
  });
});

describe("parsePreferredLine https entries", () => {
  it("accepts an https remote-list URL as-is", () => {
    const v = valid("https://example.com/add.txt");
    expect(v).toMatchObject({ kind: "https", url: "https://example.com/add.txt" });
  });

  it("rejects non-https remote URLs", () => {
    expect(invalid("http://example.com/add.txt")).toMatch(/https/);
    expect(invalid("ftp://example.com/add.txt")).toMatch(/https/);
    expect(invalid("https://")).toBeTruthy();
  });
});

describe("parsePreferredLine invalid lines", () => {
  it("reports invalid lines with reasons and never throws", () => {
    expect(invalid("")).toBeTruthy();
    expect(invalid("1.2.3.4:99999")).toMatch(/port/);
    expect(invalid("1.2.3.4:443#r$wireguard://x")).toMatch(/chain/);
    expect(invalid("1.2.3.4:443?other=1")).toMatch(/query/);
    expect(invalid("not a host!!:443")).toBeTruthy();
    expect(invalid("a".repeat(254))).toMatch(/too long/);
    expect(() => parsePreferredLine("1.2.3.4:443")).not.toThrow();
  });
});

describe("parsePreferredList", () => {
  it("groups valid and invalid lines, skipping blanks", () => {
    const { valid: ok, invalid: bad } = parsePreferredList("1.2.3.4:443#r\n\njunk line here!\nsub://5.6.7.8?proxyip=true\n");
    expect(ok.map((e) => e.raw)).toEqual(["1.2.3.4:443#r", "sub://5.6.7.8?proxyip=true"]);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.line).toBe("junk line here!");
    expect(bad[0]!.reason.length).toBeGreaterThan(0);
  });
});

describe("expandWildcard", () => {
  it("replaces every star deterministically from the injected rand", () => {
    expect(expandWildcard("192.168.*.*", () => 0.5)).toBe("192.168.128.128");
    expect(expandWildcard("10.0.0.1", () => 0.5)).toBe("10.0.0.1");
    expect(expandWildcard("*.*.*.*", () => 0)).toBe("0.0.0.0");
  });
});

describe("preferredProxyIpCandidates", () => {
  it("collects host:port for proxyIp direct/sub entries only", () => {
    const out = preferredProxyIpCandidates(
      ["1.2.3.4:443?proxyip=true", "5.6.7.8:8443", "sub://9.9.9.9:2053#r?proxyip=true", "https://example.com/a.txt", "bad line!!", "1.2.3.4:443?proxyip=true"],
      443,
    );
    expect(out).toEqual(["1.2.3.4:443", "9.9.9.9:2053"]);
  });

  it("uses the fallback port when the entry has none and skips wildcards", () => {
    expect(preferredProxyIpCandidates(["sub://9.9.9.9?proxyip=true", "1.0.*.*:443?proxyip=true"], 2053)).toEqual([
      "9.9.9.9:2053",
    ]);
  });
});
