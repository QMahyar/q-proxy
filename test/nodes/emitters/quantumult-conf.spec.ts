import { describe, expect, it } from "vitest";
import { emitQuantumultConf } from "../../../src/nodes/emitters/quantumult-conf";
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
    password: "sspassword123",
  };
}

describe("emitQuantumultConf golden", () => {
  it("emits exact config for vless+vmess+trojan+ss", () => {
    const nodes: ProxyNode[] = [vless(), vmess(), trojan(), ss()];
    const expected = [
      "[general]",
      "server_check_url = https://www.gstatic.com/generate_204",
      "",
      "[server_local]",
      "vless = example.com:443, password=d342d11e-d424-4583-b36e-524ab1f0afa4, obfs=wss, obfs-uri=/vl/abcd1234?ed=2048, obfs-host=example.com, tls-verification=true, tls-host=example.com, tag=VLESS example.com 443",
      "vmess = example.com:443, method=none, password=1386f85e-657b-4d6e-9d56-78badb75e1fd, obfs=wss, obfs-uri=/vm/abcd1234?ed=2048, obfs-host=example.com, tls-verification=true, tls-host=example.com, aead=true, tag=VMESS example.com 443",
      "trojan = example.com:443, password=secretpass123, over-tls=true, tls-verification=true, tls-host=example.com, tag=TROJAN example.com 443",
      "shadowsocks = example.com:443, method=aes-128-gcm, password=sspassword123, obfs=wss, obfs-host=example.com, obfs-uri=/ss/abcd1234, tag=SS example.com 443",
      "",
      "[policy]",
      "static = PROXY, VLESS example.com 443, VMESS example.com 443, TROJAN example.com 443, SS example.com 443",
      "",
      "[filter_local]",
      "final, PROXY",
      "",
    ].join("\n");
    expect(emitQuantumultConf(nodes, OPTS)).toBe(expected);
  });

  it("emits vless with uuid password and wss transport params but no cipher keys", () => {
    const out = emitQuantumultConf([vless()], OPTS);
    const line = out.split("\n").find((l) => l.startsWith("vless ="))!;
    expect(line).toContain("password=d342d11e-d424-4583-b36e-524ab1f0afa4");
    expect(line).toContain("obfs=wss");
    expect(line).toContain("obfs-uri=/vl/abcd1234?ed=2048");
    expect(line).toContain("obfs-host=example.com");
    expect(line).toContain("tls-verification=true");
    expect(line).toContain("tls-host=example.com");
    expect(line).not.toContain("method=");
    expect(line).not.toContain("aead=");
  });

  it("maps auto vmess cipher to none and passes explicit ciphers through", () => {
    const auto = emitQuantumultConf([vmess()], OPTS)
      .split("\n")
      .find((l) => l.startsWith("vmess ="))!;
    expect(auto).toContain("method=none");
    const explicit = emitQuantumultConf(
      [{ ...vmess(), name: "N", cipher: "chacha20-poly1305" }],
      OPTS,
    )
      .split("\n")
      .find((l) => l.startsWith("vmess ="))!;
    expect(explicit).toContain("method=chacha20-poly1305");
  });

  it("emits trojan with over-tls and no transport params", () => {
    const out = emitQuantumultConf([trojan()], OPTS);
    const line = out.split("\n").find((l) => l.startsWith("trojan ="))!;
    expect(line).toContain("password=secretpass123");
    expect(line).toContain("over-tls=true");
    expect(line).toContain("tls-verification=true");
    expect(line).toContain("tls-host=example.com");
    expect(line).not.toContain("obfs=");
  });

  it("emits tls and plain Shadowsocks with wss/ws obfs transport", () => {
    const plain: SSNode = { ...ss(), port: 80, security: "none", sni: null, name: "SS example.com 80" };
    const out = emitQuantumultConf([ss(), plain], OPTS);
    expect(out).toContain(
      "shadowsocks = example.com:443, method=aes-128-gcm, password=sspassword123, obfs=wss, obfs-host=example.com, obfs-uri=/ss/abcd1234, tag=SS example.com 443",
    );
    expect(out).toContain(
      "shadowsocks = example.com:80, method=aes-128-gcm, password=sspassword123, obfs=ws, obfs-host=example.com, obfs-uri=/ss/abcd1234, tag=SS example.com 80",
    );
    expect(out).not.toContain("tls-host=");
  });

  it("skips plain-security vless and trojan but keeps plain vmess without tls keys", () => {
    const plainVl: VlessNode = { ...vless(), port: 80, security: "none", sni: null, name: "PLAINVL" };
    const plainTr: TrojanNode = { ...trojan(), port: 80, security: "none", sni: null, name: "PLAINTR" };
    const plainVm: VMessNode = { ...vmess(), port: 80, security: "none", sni: null, name: "PLAINVM" };
    const out = emitQuantumultConf([plainVl, plainTr, plainVm], OPTS);
    expect(out).not.toContain("PLAINVL");
    expect(out).not.toContain("PLAINTR");
    const line = out.split("\n").find((l) => l.includes("tag=PLAINVM"))!;
    expect(line).toContain("obfs=ws");
    expect(line).not.toContain("tls-verification");
    expect(line).not.toContain("tls-host");
  });

  it("hides fragment nodes unless isFragment is set", () => {
    const fragVl: VlessNode = { ...vless(), variant: "fragment", tags: ["fragment"], name: "FRAGVL" };
    const fragSs: SSNode = { ...ss(), variant: "fragment", tags: ["fragment"], name: "FRAGSS" };
    const hidden = emitQuantumultConf([fragVl, fragSs], OPTS);
    expect(hidden).not.toContain("FRAGVL");
    expect(hidden).not.toContain("FRAGSS");
    const shown = emitQuantumultConf([fragVl, fragSs], { ...OPTS, isFragment: true });
    expect(shown).toContain("tag=FRAGVL");
    expect(shown).toContain("tag=FRAGSS");
  });

  it("brackets IPv6 server hosts for every protocol", () => {
    const nodes: ProxyNode[] = [
      { ...vless(), address: "[2606:4700::1]", name: "V6VLESS" },
      { ...vmess(), address: "[2606:4700::1]", name: "V6VMESS" },
      { ...trojan(), address: "[2606:4700::1]", name: "V6TROJAN" },
      { ...ss(), address: "[2606:4700::1]", name: "V6SS" },
    ];
    const out = emitQuantumultConf(nodes, OPTS);
    expect(out).toContain("vless = [2606:4700::1]:443, password=");
    expect(out).toContain("vmess = [2606:4700::1]:443, method=");
    expect(out).toContain("trojan = [2606:4700::1]:443, password=");
    expect(out).toContain("shadowsocks = [2606:4700::1]:443, method=");
  });

  it("percent-encodes tag and password delimiters without breaking comma split", () => {
    const trickyName = "My,=Weird\nName";
    const trickyPass = "p,=a\nb";
    const node: TrojanNode = { ...trojan(), name: trickyName, password: trickyPass };
    const out = emitQuantumultConf([node], OPTS);
    expect(out).toContain("tag=My%2C%3DWeird%0AName");
    expect(out).toContain("password=p%2C%3Da%0Ab");
    const line = out.split("\n").find((l) => l.startsWith("trojan ="))!;
    const fields = line.split(", ");
    const pwField = fields.find((f) => f.startsWith("password="))!;
    expect(decodeURIComponent(pwField.slice("password=".length))).toBe(trickyPass);
    const tagField = fields.find((f) => f.startsWith("tag="))!;
    expect(decodeURIComponent(tagField.slice("tag=".length))).toBe(trickyName);
    expect(out).toContain("static = PROXY, My%2C%3DWeird%0AName");
  });

  it("uses a single-node static group and falls back to direct when empty", () => {
    const one = emitQuantumultConf([vmess()], OPTS);
    expect(one).toContain("[policy]\nstatic = PROXY, VMESS example.com 443");
    const empty = emitQuantumultConf([], OPTS);
    expect(empty).toContain("[server_local]\n\n[policy]");
    expect(empty).toContain("static = PROXY, direct");
  });
});
