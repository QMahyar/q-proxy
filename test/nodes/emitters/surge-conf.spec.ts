import { describe, expect, it } from "vitest";
import { emitSurgeConf } from "../../../src/nodes/emitters/surge-conf";
import type { EmitOptions } from "../../../src/nodes/emitters/registry";
import type { ProxyNode, SSNode, TrojanNode, VlessNode, VMessNode } from "../../../src/types/node";

const OPTS: EmitOptions = {
  remoteDns: "https://8.8.8.8/dns-query",
  urlTestIntervalSec: 300,
  isFragment: false,
};

function vmess(): VMessNode {
  return {
    kind: "vmess",
    name: "VMESS example.com 443",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/vm/abcd1234?ed=2048",
    earlyData: 2048,
    fingerprint: "chrome",
    alpn: ["http/1.1"],
    ech: null,
    variant: "normal",
    tags: [],
    uuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
    cipher: "auto",
    alterId: 0,
  };
}

function trojan(): TrojanNode {
  return {
    kind: "trojan",
    name: "TROJAN example.com 443",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/tr/abcd1234?ed=2048",
    earlyData: 2048,
    fingerprint: "chrome",
    alpn: [],
    ech: null,
    variant: "normal",
    tags: [],
    password: "secretpass123",
  };
}

function vless(): VlessNode {
  return {
    ...vmess(),
    kind: "vless",
    name: "VLESS example.com 443",
    path: "/vl/abcd1234?ed=2048",
    uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
  };
}

function ss(): SSNode {
  return {
    kind: "ss",
    name: "SS example.com 443",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/ss/abcd1234",
    earlyData: 0,
    fingerprint: "chrome",
    alpn: [],
    ech: null,
    variant: "normal",
    tags: [],
    method: "aes-128-gcm",
    password: "sspass123",
  };
}

describe("emitSurgeConf golden", () => {
  it("emits exact INI for vless+vmess+trojan+ss", () => {
    const nodes: ProxyNode[] = [vless(), vmess(), trojan(), ss()];
    const expected = [
      "[General]",
      "loglevel = notify",
      "",
      "[Proxy]",
      "VLESS example.com 443 = vless, example.com, 443, username=d342d11e-d424-4583-b36e-524ab1f0afa4, tls=true, ws=true, ws-path=/vl/abcd1234?ed=2048, ws-headers=Host:example.com, sni=example.com",
      "VMESS example.com 443 = vmess, example.com, 443, username=1386f85e-657b-4d6e-9d56-78badb75e1fd, tls=true, vmess-aead=true, ws=true, ws-path=/vm/abcd1234?ed=2048, ws-headers=Host:example.com, sni=example.com",
      "TROJAN example.com 443 = trojan, example.com, 443, password=secretpass123, tls=true, ws=true, ws-path=/tr/abcd1234?ed=2048, ws-headers=Host:example.com, sni=example.com",
      "SS example.com 443 = ss, example.com, 443, encrypt-method=aes-128-gcm, password=sspass123, tls=true, ws=true, ws-path=/ss/abcd1234, ws-headers=Host:example.com, sni=example.com",
      "",
      "[Proxy Group]",
      "PROXY = url-test, VLESS example.com 443, VMESS example.com 443, TROJAN example.com 443, SS example.com 443, url=https://www.gstatic.com/generate_204, interval=300, tolerance=50",
      "",
      "[Rule]",
      "FINAL,PROXY",
      "",
    ].join("\n");
    expect(emitSurgeConf(nodes, OPTS)).toBe(expected);
  });

  it("emits vless line with ws transport params including tls sni host path and early-data", () => {
    const out = emitSurgeConf([vless()], OPTS);
    const line = out.split("\n").find((l) => l.includes(" = vless, "))!;
    expect(line).toContain("username=d342d11e-d424-4583-b36e-524ab1f0afa4");
    expect(line).toContain("tls=true");
    expect(line).toContain("ws=true");
    expect(line).toContain("ws-path=/vl/abcd1234?ed=2048");
    expect(line).toContain("ws-headers=Host:example.com");
    expect(line).toContain("sni=example.com");
    expect(line).not.toContain("vmess-aead");
  });

  it("emits ss line with method password and ws transport params", () => {
    const out = emitSurgeConf([ss()], OPTS);
    const line = out.split("\n").find((l) => l.includes(" = ss, "))!;
    expect(line).toContain("encrypt-method=aes-128-gcm");
    expect(line).toContain("password=sspass123");
    expect(line).toContain("tls=true");
    expect(line).toContain("ws=true");
    expect(line).toContain("ws-path=/ss/abcd1234");
    expect(line).toContain("ws-headers=Host:example.com");
    expect(line).toContain("sni=example.com");
  });

  it("skips plain-security vless but keeps plain ss with tls=false and no sni", () => {
    const plainVl: VlessNode = { ...vless(), port: 80, security: "none", sni: null, name: "PLAINVL" };
    const plainSs: SSNode = { ...ss(), port: 80, security: "none", sni: null, name: "PLAINSS" };
    const out = emitSurgeConf([plainVl, plainSs], OPTS);
    expect(out).not.toContain("PLAINVL");
    expect(out).toContain("PLAINSS = ss, example.com, 80, encrypt-method=aes-128-gcm, password=sspass123, tls=false, ws=true");
    expect(out).not.toContain("sni=");
  });

  it("hides fragment vless and ss unless isFragment is set", () => {
    const fragVl: VlessNode = { ...vless(), variant: "fragment", tags: ["fragment"], name: "FRAGVL" };
    const fragSs: SSNode = { ...ss(), variant: "fragment", tags: ["fragment"], name: "FRAGSS" };
    const hidden = emitSurgeConf([fragVl, fragSs], OPTS);
    expect(hidden).not.toContain("FRAGVL");
    expect(hidden).not.toContain("FRAGSS");
    const shown = emitSurgeConf([fragVl, fragSs], { ...OPTS, isFragment: true });
    expect(shown).toContain("FRAGVL = vless");
    expect(shown).toContain("FRAGSS = ss");
  });

  it("strips brackets from IPv6 server field for vless and ss", () => {
    const ipv6Vl: VlessNode = { ...vless(), address: "[2606:4700::1]", name: "VLESS [2606:4700::1] 443" };
    const ipv6Ss: SSNode = { ...ss(), address: "[2606:4700::1]", name: "SS [2606:4700::1] 443" };
    const out = emitSurgeConf([ipv6Vl, ipv6Ss], OPTS);
    expect(out).toContain("VLESS [2606:4700::1] 443 = vless, 2606:4700::1, 443, username=");
    expect(out).toContain("SS [2606:4700::1] 443 = ss, 2606:4700::1, 443, encrypt-method=");
    expect(out).not.toContain(", [2606");
  });

  it("percent-encodes special characters in ss password without breaking comma split", () => {
    const trickyPass = "p,=a\nb";
    const node: SSNode = { ...ss(), password: trickyPass };
    const out = emitSurgeConf([node], OPTS);
    expect(out).toContain("password=p%2C%3Da%0Ab");
    const line = out.split("\n").find((l) => l.includes("password="))!;
    const pwField = line.split(", ").find((f) => f.startsWith("password="))!;
    expect(decodeURIComponent(pwField.slice("password=".length))).toBe(trickyPass);
  });

  it("prepends a managed-config header when subscriptionUrl is provided", () => {
    const out = emitSurgeConf([vmess()], {
      ...OPTS,
      subscriptionUrl: "https://w.test/sp/sub?target=surge",
      updateIntervalHours: 12,
    });
    expect(out.startsWith(
      "#!MANAGED-CONFIG https://w.test/sp/sub?target=surge interval=43200 strict=true\n",
    )).toBe(true);
  });

  it("selects single node and falls back to DIRECT group when nothing is emittable", () => {
    const one = emitSurgeConf([vmess()], OPTS);
    expect(one).toContain("[Proxy Group]\nPROXY = select, VMESS example.com 443");
    const empty = emitSurgeConf([], OPTS);
    expect(empty).toContain("[Proxy]\n\n[Proxy Group]");
    expect(empty).toContain("PROXY = select, DIRECT");
  });

  it("skips plain-security trojan but keeps plain vmess", () => {
    const plainVm: VMessNode = { ...vmess(), port: 80, security: "none", sni: null, name: "PLAINVM" };
    const plainTr: TrojanNode = { ...trojan(), port: 80, security: "none", name: "PLAINTR" };
    const out = emitSurgeConf([plainVm, plainTr], OPTS);
    expect(out).toContain("PLAINVM = vmess");
    expect(out).toContain("tls=false");
    expect(out).not.toContain("PLAINTR");
  });

  it("strips brackets from IPv6 server field", () => {
    const ipv6: TrojanNode = { ...trojan(), address: "[2606:4700::1]", name: "TROJAN [2606:4700::1] 443" };
    const out = emitSurgeConf([ipv6], OPTS);
    expect(out).toContain("TROJAN [2606:4700::1] 443 = trojan, 2606:4700::1, 443, password=");
    expect(out).not.toContain(", [2606");
  });

  it("percent-encodes special characters in name and password without breaking comma split", () => {
    const trickyName = "My,=Weird\nName";
    const trickyPass = "p,=a\nb";
    const node: TrojanNode = { ...trojan(), name: trickyName, password: trickyPass };
    const out = emitSurgeConf([node], OPTS);
    expect(out).not.toContain("My,=Weird");
    expect(out).toContain("My%2C%3DWeird%0AName = trojan");
    expect(out).toContain("password=p%2C%3Da%0Ab");
    const proxyLine = out.split("\n").find((l) => l.includes("password="))!;
    const fields = proxyLine.split(", ");
    const pwField = fields.find((f) => f.startsWith("password="))!;
    const encoded = pwField.slice("password=".length);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(trickyPass);
    const namePart = proxyLine.slice(0, proxyLine.indexOf(" ="));
    expect(decodeURIComponent(namePart)).toBe(trickyName);
  });

  it("round-trips password containing all Surge delimiters", () => {
    const pwd = 'a,b=c\nd\re';
    const node: TrojanNode = { ...trojan(), password: pwd };
    const out = emitSurgeConf([node], OPTS);
    const line = out.split("\n").find((l) => l.includes("password="))!;
    const pwField = line.split(", ").find((f) => f.startsWith("password="))!;
    expect(decodeURIComponent(pwField.slice("password=".length))).toBe(pwd);
  });
});
