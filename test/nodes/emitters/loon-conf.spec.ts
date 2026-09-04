import { describe, expect, it } from "vitest";
import { emitLoonConf } from "../../../src/nodes/emitters/loon-conf";
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
  return { ...vmess(), kind: "vless", name: "VLESS example.com 443", uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4" };
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
    password: "sspassword123",
  };
}

describe("emitLoonConf golden", () => {
  it("emits exact INI for vless+vmess+trojan with loon parameter style", () => {
    const nodes: ProxyNode[] = [vless(), vmess(), trojan()];
    const expected = [
      "[General]",
      "loglevel = notify",
      "",
      "[Proxy]",
      'VLESS example.com 443 = vless, example.com, 443, "d342d11e-d424-4583-b36e-524ab1f0afa4", udp=true, over-tls=true, tls-name=example.com, tls-profile=chrome, transport=ws, path=/vm/abcd1234?ed=2048, host=example.com',
      'VMESS example.com 443 = vmess, example.com, 443, auto, "1386f85e-657b-4d6e-9d56-78badb75e1fd", alterId=0, udp=true, over-tls=true, tls-name=example.com, tls-profile=chrome, transport=ws, path=/vm/abcd1234?ed=2048, host=example.com',
      'TROJAN example.com 443 = trojan, example.com, 443, "secretpass123", udp=true, tls-name=example.com, over-tls=true, tls-profile=chrome, transport=ws, path=/tr/abcd1234?ed=2048, host=example.com',
      "",
      "[Proxy Group]",
      "PROXY = url-test, VLESS example.com 443, VMESS example.com 443, TROJAN example.com 443, url=https://www.gstatic.com/generate_204, interval=300, tolerance=50, timeout=5",
      "",
      "[Rule]",
      "FINAL,PROXY",
      "",
    ].join("\n");
    expect(emitLoonConf(nodes, OPTS)).toBe(expected);
  });

  it("emits vless and falls back to DIRECT group when empty", () => {
    const out = emitLoonConf([vless()], OPTS);
    expect(out).toContain("VLESS example.com 443 = vless");
    expect(out).not.toContain("PROXY = select, DIRECT");
    const empty = emitLoonConf([], OPTS);
    expect(empty).toContain("PROXY = select, DIRECT");
  });

  it("skips plain-security trojan but keeps plain vmess without sni", () => {
    const plainVm: VMessNode = { ...vmess(), port: 80, security: "none", sni: null, name: "PLAINVM" };
    const plainTr: TrojanNode = { ...trojan(), port: 80, security: "none", name: "PLAINTR" };
    const out = emitLoonConf([plainVm, plainTr], OPTS);
    expect(out).toContain(
      'PLAINVM = vmess, example.com, 80, auto, "1386f85e-657b-4d6e-9d56-78badb75e1fd", alterId=0, udp=true, over-tls=false, transport=ws, path=/vm/abcd1234?ed=2048, host=example.com',
    );
    expect(out).not.toContain("PLAINTR");
  });

  it("strips brackets from IPv6 server field", () => {
    const ipv6: TrojanNode = { ...trojan(), address: "[2606:4700::1]", name: "TROJAN [2606:4700::1] 443" };
    const out = emitLoonConf([ipv6], OPTS);
    expect(out).toContain("TROJAN [2606:4700::1] 443 = trojan, 2606:4700::1, 443,");
    expect(out).not.toContain(", [2606");
  });

  it("escapes quotes, backslashes and newlines in quoted password and name", () => {
    const trickyName = 'My "weird\nName\\test';
    const trickyPass = 'p"ass\\word\nnext\rmore';
    const node: TrojanNode = { ...trojan(), name: trickyName, password: trickyPass };
    const out = emitLoonConf([node], OPTS);
    expect(out).toContain('\\"');
    expect(out).toContain("\\\\");
    expect(out).toContain("\\n");
    expect(out).toContain("\\r");
    const baseline = emitLoonConf([{ ...trojan(), name: "CLEAN NODE", password: "cleanpass" }], OPTS);
    expect(out.split("\n").length).toBe(baseline.split("\n").length);
    const line = out.split("\n").find((l) => l.includes("password") || l.includes("trojan"))!;
    expect(line).toContain('"p\\"ass\\\\word\\nnext\\rmore"');
  });

  it("round-trips password containing all Loon delimiters", () => {
    const pwd = 'a"b\\c\nd\re';
    const node: TrojanNode = { ...trojan(), password: pwd };
    const out = emitLoonConf([node], OPTS);
    const line = out.split("\n").find((l) => l.includes("trojan"))!;
    const m = line.match(/"((?:\\.|[^"])*)"/);
    expect(m).not.toBeNull();
    const inner = m![1]!;
    const unescaped = inner.replace(/\\\\/g, "\u0000").replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\u0000/g, "\\");
    expect(unescaped).toBe(pwd);
  });

  it("emits exact INI for tls+plain Shadowsocks with v2ray-plugin WS transport", () => {
    const plain: SSNode = { ...ss(), port: 80, security: "none", sni: null, name: "SS example.com 80" };
    const expected = [
      "[General]",
      "loglevel = notify",
      "",
      "[Proxy]",
      'SS example.com 443 = Shadowsocks, example.com, 443, aes-128-gcm, "sspassword123", plugin=v2ray-plugin, plugin-opts="mode=websocket;tls;host=example.com;path=/ss/abcd1234", udp=true',
      'SS example.com 80 = Shadowsocks, example.com, 80, aes-128-gcm, "sspassword123", plugin=v2ray-plugin, plugin-opts="mode=websocket;host=example.com;path=/ss/abcd1234", udp=true',
      "",
      "[Proxy Group]",
      "PROXY = url-test, SS example.com 443, SS example.com 80, url=https://www.gstatic.com/generate_204, interval=300, tolerance=50, timeout=5",
      "",
      "[Rule]",
      "FINAL,PROXY",
      "",
    ].join("\n");
    expect(emitLoonConf([ss(), plain], OPTS)).toBe(expected);
  });

  it("maps known UTLS fingerprints to tls-profile and omits the rest", () => {
    const line = (fingerprint: VMessNode["fingerprint"]): string =>
      emitLoonConf([{ ...vmess(), name: "N", fingerprint }], OPTS)
        .split("\n")
        .find((l) => l.startsWith("N ="))!;
    expect(line("chrome")).toContain(", tls-profile=chrome,");
    expect(line("safari")).toContain(", tls-profile=safari,");
    expect(line("ios")).toContain(", tls-profile=ios26,");
    expect(line("firefox")).not.toContain("tls-profile");
    expect(line("android")).not.toContain("tls-profile");
    expect(line("random")).not.toContain("tls-profile");
    expect(line(null)).not.toContain("tls-profile");
  });

  it("emits ech only on TLS lines where it is set", () => {
    const withEch = emitLoonConf([{ ...vless(), name: "E", ech: "ech.example.com" }], OPTS)
      .split("\n")
      .find((l) => l.startsWith("E ="))!;
    expect(withEch).toContain(", tls-profile=chrome, ech=ech.example.com, transport=ws,");
    expect(emitLoonConf([vless()], OPTS)).not.toContain("ech=");
    const plain = emitLoonConf([{ ...vmess(), name: "P", security: "none", sni: null, ech: "ech.example.com" }], OPTS)
      .split("\n")
      .find((l) => l.startsWith("P ="))!;
    expect(plain).not.toContain("ech=");
    expect(plain).not.toContain("tls-profile");
  });

  it("never emits tls-profile or ech on Shadowsocks lines", () => {
    const out = emitLoonConf([{ ...ss(), ech: "ech.example.com" }], OPTS);
    const line = out.split("\n").find((l) => l.includes("Shadowsocks"))!;
    expect(line).toContain('plugin-opts="mode=websocket;tls;host=example.com;path=/ss/abcd1234"');
    expect(line).not.toContain("tls-profile");
    expect(line).not.toContain("ech=");
  });

  it("escapes quotes in Shadowsocks password", () => {
    const node: SSNode = { ...ss(), password: 'p"ass\\word' };
    const out = emitLoonConf([node], OPTS);
    expect(out).toContain('"p\\"ass\\\\word"');
  });
});
