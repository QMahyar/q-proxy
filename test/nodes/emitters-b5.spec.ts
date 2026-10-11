import { describe, expect, it } from "vitest";
import { emitSingBoxJson } from "../../src/nodes/emitters/singbox-json";
import { emitClashYaml } from "../../src/nodes/emitters/clash-yaml";
import { emitXrayJson } from "../../src/nodes/emitters/xray-json";
import type { EmitOptions } from "../../src/nodes/emitters/registry";
import type { ShadowsocksNode, TrojanNode, VlessNode } from "../../src/types/node";

const OPTS: EmitOptions = { isFragment: false };

function vless(): VlessNode {
  return {
    kind: "vless",
    name: "V",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/vl/abcd1234?ed=2048",
    earlyData: 2048,
    fingerprint: "chrome",
    alpn: ["http/1.1"],
    ech: null,
    variant: "normal",
    tags: [],
    uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
  };
}

function trojan(): TrojanNode {
  return { ...vless(), kind: "trojan", name: "T", password: "s3cret" } as TrojanNode;
}

function ss(): ShadowsocksNode {
  return {
    ...vless(),
    kind: "shadowsocks",
    name: "S",
    method: "aes-128-gcm",
    password: "d342d11e-d424-4583-b36e-524ab1f0afa4",
    tls: false,
  } as ShadowsocksNode;
}

describe("B5 additive emitters", () => {
  it("sing-box emits trojan and shadowsocks outbounds", () => {
    const doc = JSON.parse(emitSingBoxJson([vless(), trojan(), ss()], OPTS)) as {
      outbounds: Array<{ type: string; tag: string }>;
    };
    const types = doc.outbounds.map((o) => `${o.type}:${o.tag}`);
    expect(types).toContain("vless:V");
    expect(types).toContain("trojan:T");
    expect(types).toContain("shadowsocks:S");
    const tj = doc.outbounds.find((o) => o.tag === "T") as unknown as Record<string, unknown>;
    expect(tj.password).toBe("s3cret");
    const shadows = doc.outbounds.find((o) => o.tag === "S") as unknown as Record<string, unknown>;
    expect(shadows.method).toBe("aes-128-gcm");
  });

  it("sing-box adds tls fragment only when the preset is on", () => {
    const off = JSON.parse(emitSingBoxJson([vless()], OPTS)) as { outbounds: Array<{ tls?: Record<string, unknown> }> };
    expect(off.outbounds[0]!.tls).not.toHaveProperty("fragment");
    const on = JSON.parse(
      emitSingBoxJson([vless()], { ...OPTS, tlsFragment: "shadowrocket" }),
    ) as { outbounds: Array<{ tls?: Record<string, unknown> }> };
    expect(on.outbounds[0]!.tls).toMatchObject({ fragment: true });
  });

  it("clash emits trojan and ss proxies", () => {
    const yaml = emitClashYaml([vless(), trojan(), ss()], OPTS);
    expect(yaml).toContain("type: trojan");
    expect(yaml).toContain("password: s3cret");
    expect(yaml).toContain("type: ss");
    expect(yaml).toContain("cipher: aes-128-gcm");
  });

  it("xray emits trojan and shadowsocks outbounds plus fragment sockopt", () => {
    const doc = JSON.parse(emitXrayJson([vless(), trojan(), ss()], OPTS)) as {
      outbounds: Array<{ protocol: string; tag: string }>;
    };
    expect(doc.outbounds.map((o) => o.protocol)).toContain("trojan");
    expect(doc.outbounds.map((o) => o.protocol)).toContain("shadowsocks");
    const frag = JSON.parse(emitXrayJson([vless()], { ...OPTS, tlsFragment: "happ" })) as {
      outbounds: Array<{ streamSettings?: { sockopt?: unknown } }>;
    };
    expect(JSON.stringify(frag.outbounds[0])).toContain("tcpFragment");
    const plain = emitXrayJson([vless()], OPTS);
    expect(plain).not.toContain("tcpFragment");
  });

  it("fragment opts do not alter vless-only default output", () => {
    expect(emitSingBoxJson([vless()], OPTS)).toBe(emitSingBoxJson([vless()], { ...OPTS, tlsFragment: "off" }));
  });
});
