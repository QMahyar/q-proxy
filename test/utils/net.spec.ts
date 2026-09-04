import { describe, expect, it } from "vitest";
import {
  bracketIpv6,
  cidrContains,
  isBlockedEgressHost,
  isCloudflareIp,
  isIPv4,
  isIPv6,
  isLocalOrPrivateTarget,
  parseHostPort,
} from "../../src/utils/net";

describe("isIPv4", () => {
  it("accepts valid", () => {
    expect(isIPv4("0.0.0.0")).toBe(true);
    expect(isIPv4("192.168.1.1")).toBe(true);
    expect(isIPv4("255.255.255.255")).toBe(true);
  });
  it("rejects invalid", () => {
    expect(isIPv4("256.1.1.1")).toBe(false);
    expect(isIPv4("1.2.3")).toBe(false);
    expect(isIPv4("a.b.c.d")).toBe(false);
    expect(isIPv4("")).toBe(false);
  });
});

describe("isIPv6", () => {
  it("accepts valid forms", () => {
    for (const s of [
      "::",
      "::1",
      "2001:db8::1",
      "2001:db8:0:0:0:0:0:1",
      "fe80::1%eth0",
      "::ffff:192.168.1.1",
      "0:0:0:0:0:ffff:192.168.1.1",
      "1:2:3:4:5:6:1.2.3.4",
      "1::2.3.4.5",
      "2a02:898:146:64::",
      "2602:fc59:b0:64::",
    ]) {
      expect(isIPv6(s), s).toBe(true);
    }
  });
  it("rejects invalid forms", () => {
    for (const s of [
      ":::",
      "2001:db8:::1",
      "12345::",
      "1.2.3.4",
      ":",
      "2001:db8:0:0:0:0:0:1:2",
      "1.2.3.4::1",
      "1.2.3.4::5.6.7.8",
      "1::2.3.4.5:6",
    ]) {
      expect(isIPv6(s), s).toBe(false);
    }
  });
});

describe("parseHostPort", () => {
  it("parses ipv4 host:port", () => {
    expect(parseHostPort("1.2.3.4:8080")).toEqual({ host: "1.2.3.4", port: 8080 });
  });
  it("parses domain with default port", () => {
    expect(parseHostPort("example.com", 443)).toEqual({ host: "example.com", port: 443 });
  });
  it("parses bracketed ipv6", () => {
    expect(parseHostPort("[2001:db8::1]:443")).toEqual({ host: "2001:db8::1", port: 443 });
    expect(parseHostPort("[::1]")).toEqual({ host: "::1", port: 80 });
  });
  it("treats bare ipv6 without brackets as host", () => {
    expect(parseHostPort("2001:db8::1")).toEqual({ host: "2001:db8::1", port: 80 });
  });
  it("returns null on garbage", () => {
    expect(parseHostPort("host:99999")).toBeNull();
    expect(parseHostPort("host:-1")).toBeNull();
    expect(parseHostPort(":80")).toBeNull();
    expect(parseHostPort("[bad]:80")).toBeNull();
  });
});

describe("bracketIpv6", () => {
  it("brackets only ipv6", () => {
    expect(bracketIpv6("2001:db8::1")).toBe("[2001:db8::1]");
    expect(bracketIpv6("example.com")).toBe("example.com");
    expect(bracketIpv6("1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("cidrContains", () => {
  it("v4 containment", () => {
    expect(cidrContains("104.16.0.1", "104.16.0.0/13")).toBe(true);
    expect(cidrContains("104.24.0.1", "104.16.0.0/13")).toBe(false);
    expect(cidrContains("10.0.0.5", "10.0.0.0/8")).toBe(true);
  });
  it("v6 containment", () => {
    expect(cidrContains("2400:cb00::1", "2400:cb00::/32")).toBe(true);
    expect(cidrContains("2606:4700::1", "2400:cb00::/32")).toBe(false);
  });
  it("refuses family mismatch", () => {
    expect(cidrContains("1.2.3.4", "::/0")).toBe(false);
  });
});

describe("isCloudflareIp", () => {
  it("detects cf ranges", () => {
    expect(isCloudflareIp("104.16.132.229")).toBe(true);
    expect(isCloudflareIp("172.64.0.1")).toBe(true);
    expect(isCloudflareIp("2606:4700:4700::1111")).toBe(true);
    expect(isCloudflareIp("8.8.8.8")).toBe(false);
  });
  it("handles 104.16.0.0/13 edges", () => {
    expect(isCloudflareIp("104.16.0.0")).toBe(true);
    expect(isCloudflareIp("104.23.255.255")).toBe(true);
    expect(isCloudflareIp("104.15.255.255")).toBe(false);
    expect(isCloudflareIp("104.24.0.0")).toBe(true);
    expect(isCloudflareIp("104.27.255.255")).toBe(true);
    expect(isCloudflareIp("104.28.0.0")).toBe(false);
  });
  it("handles ipv6 edges", () => {
    expect(isCloudflareIp("2400:cb00::")).toBe(true);
    expect(isCloudflareIp("2400:cb00:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    expect(isCloudflareIp("2400:cb01::")).toBe(false);
    expect(isCloudflareIp("2606:4700::")).toBe(true);
    expect(isCloudflareIp("2606:4700:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    expect(isCloudflareIp("2606:4701::")).toBe(false);
    expect(isCloudflareIp("2a06:98c0::1")).toBe(true);
    expect(isCloudflareIp("2a06:98c7:ffff::1")).toBe(true);
    expect(isCloudflareIp("2a06:98c8::1")).toBe(false);
    expect(isCloudflareIp("2c0f:f248::1")).toBe(true);
    expect(isCloudflareIp("2c0f:f249::1")).toBe(false);
    expect(isCloudflareIp("not-an-ip")).toBe(false);
    expect(isCloudflareIp("")).toBe(false);
  });
});

describe("isLocalOrPrivateTarget", () => {
  it("flags localhost and private ranges", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.5", "::1", "fc00::1", "fe80::1", "[::1]", "foo.local"]) {
      expect(isLocalOrPrivateTarget(h), h).toBe(true);
    }
  });
  it("allows public targets", () => {
    for (const h of ["example.com", "8.8.8.8", "104.16.0.1", "2606:4700::1111"]) {
      expect(isLocalOrPrivateTarget(h), h).toBe(false);
    }
  });
});

describe("isLocalOrPrivateTarget metadata denylist", () => {
  it("blocks cloud metadata literal ips", () => {
    for (const h of [
      "169.254.169.254",
      "169.254.169.253",
      "100.100.100.200",
      "fd00:ec2::254",
      "fd00:ec2::253",
      "FD00:EC2::254",
      "[fd00:ec2::254]",
      "fd00:ec2:0:0:0:0:0:254",
      "fd00:ec2::254%eth0",
    ]) {
      expect(isLocalOrPrivateTarget(h), h).toBe(true);
    }
  });
  it("blocks cloud metadata hostnames", () => {
    for (const h of [
      "metadata.google.internal",
      "metadata.goog",
      "instance-data.compute.internal",
      "instance-data",
      "rancher-metadata",
      "metadata",
      "METADATA.GOOGLE.INTERNAL",
      "metadata.google.internal.",
      "metadata.goog.",
      "db.internal",
      "a.b.internal",
    ]) {
      expect(isLocalOrPrivateTarget(h), h).toBe(true);
    }
  });
  it("still allows public targets and non-metadata single-label test hosts", () => {
    for (const h of [
      "example.com",
      "dns.google",
      "cloudflare-dns.com",
      "8.8.8.8",
      "1.1.1.1",
      "9.9.9.9",
      "100.100.100.201",
      "2001:db8::1",
      "2606:4700:4700::1111",
      "r",
    ]) {
      expect(isLocalOrPrivateTarget(h), h).toBe(false);
    }
  });
});

describe("isBlockedEgressHost", () => {
  it("blocks private, metadata, and cloudflare targets", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "::1",
      "[::1]",
      "169.254.169.254",
      "100.100.100.200",
      "fd00:ec2::254",
      "[fd00:ec2::254]",
      "metadata.google.internal",
      "metadata.goog",
      "instance-data.compute.internal",
      "rancher-metadata",
      "db.internal",
      "104.16.132.229",
      "172.64.0.1",
      "2606:4700:4700::1111",
    ]) {
      expect(isBlockedEgressHost(h), h).toBe(true);
    }
  });
  it("allows public targets", () => {
    for (const h of [
      "example.com",
      "dns.google",
      "8.8.8.8",
      "1.1.1.1",
      "9.9.9.9",
      "2001:db8::1",
    ]) {
      expect(isBlockedEgressHost(h), h).toBe(false);
    }
  });
});
