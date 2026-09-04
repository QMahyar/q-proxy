import { describe, expect, it } from "vitest";
import type { ProxyNode, SSNode, TrojanNode, VMessNode, VlessNode } from "../../src/types/node";
import {
  buildSSShareUri,
  buildShareUri,
  buildShareUris,
  buildTrojanShareUri,
  buildVMessShareUri,
  buildVlessShareUri,
} from "../../src/nodes/share-uri";
import { decodeBase64 } from "../../src/utils/base64";

function vlessTls(): VlessNode {
  return {
    kind: "vless",
    name: "CF-WS-TLS",
    address: "example.com",
    port: 443,
    security: "tls",
    sni: "example.com",
    host: "example.com",
    path: "/vl?ed=2560",
    earlyData: 2560,
    fingerprint: "chrome",
    alpn: ["http/1.1"],
    ech: null,
    variant: "normal",
    tags: [],
    uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
  };
}

describe("buildVlessShareUri", () => {
  it("matches the R4 grammar example exactly", () => {
    expect(buildVlessShareUri(vlessTls())).toBe(
      "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@example.com:443" +
        "?encryption=none&security=tls&sni=example.com&fp=chrome&alpn=http%2F1.1" +
        "&type=ws&host=example.com&path=%2Fvl%3Fed%3D2560#CF-WS-TLS",
    );
  });

  it("omits sni/fp/alpn for security none and never emits flow", () => {
    const node: VlessNode = {
      ...vlessTls(),
      port: 80,
      security: "none",
      sni: null,
      fingerprint: null,
      alpn: [],
      ech: null,
      path: "/vl/x",
      earlyData: 0,
      name: "N",
    };
    const uri = buildVlessShareUri(node);
    expect(uri).toBe(
      "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@example.com:80" +
        "?encryption=none&security=none&type=ws&host=example.com&path=%2Fvl%2Fx#N",
    );
    expect(uri).not.toContain("flow");
  });

  it("appends flow= after the transport params when set", () => {
    const node = { ...vlessTls(), flow: "xtls-rprx-vision" };
    expect(buildVlessShareUri(node)).toBe(
      "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@example.com:443" +
        "?encryption=none&security=tls&sni=example.com&fp=chrome&alpn=http%2F1.1" +
        "&type=ws&host=example.com&path=%2Fvl%3Fed%3D2560&flow=xtls-rprx-vision#CF-WS-TLS",
    );
  });

  it("emits byte-identical legacy output when flow is null", () => {
    expect(buildVlessShareUri({ ...vlessTls(), flow: null })).toBe(buildVlessShareUri(vlessTls()));
  });

  it("brackets ipv6 hosts", () => {
    const node = { ...vlessTls(), address: "2001:db8::1", name: "V6" };
    expect(buildVlessShareUri(node)).toContain("@[2001:db8::1]:443?");
  });

  it("emits type=ws as the first transport param", () => {
    const uri = buildVlessShareUri(vlessTls());
    expect(uri).toContain("type=ws&host=");
    expect(uri.indexOf("type=ws")).toBeLessThan(uri.indexOf("host="));
    expect(uri.indexOf("type=ws")).toBeLessThan(uri.indexOf("path="));
  });
});

describe("buildVMessShareUri", () => {
  it("emits v2 base64-JSON with string port and aid 0", () => {
    const node: VMessNode = {
      kind: "vmess",
      name: "CF-VMESS",
      address: "example.com",
      port: 443,
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "/vm?ed=2560",
      earlyData: 2560,
      fingerprint: "chrome",
      alpn: ["http/1.1"],
      ech: null,
      variant: "normal",
      tags: [],
      uuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
      cipher: "auto",
      alterId: 0,
    };
    const uri = buildVMessShareUri(node);
    expect(uri.startsWith("vmess://")).toBe(true);
    const payload = uri.slice("vmess://".length);
    const decoded = decodeBase64(payload);
    expect(decoded.ok).toBe(true);
    const json = JSON.parse(new TextDecoder().decode(decoded.ok ? decoded.value : new Uint8Array())) as Record<
      string,
      unknown
    >;
    expect(json).toEqual({
      v: "2",
      ps: "CF-VMESS",
      add: "example.com",
      port: "443",
      id: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
      aid: "0",
      scy: "auto",
      net: "ws",
      type: "none",
      host: "example.com",
      path: "/vm?ed=2560",
      tls: "tls",
      sni: "example.com",
      alpn: "http/1.1",
      fp: "chrome",
    });
  });

  it("uses empty tls field for plain nodes", () => {
    const node: VMessNode = {
      kind: "vmess",
      name: "P",
      address: "example.com",
      port: 80,
      security: "none",
      sni: null,
      host: "example.com",
      path: "/vm",
      earlyData: 0,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: ["no-tls"],
      uuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
      cipher: "auto",
      alterId: 0,
    };
    const uri = buildVMessShareUri(node);
    const b64 = uri.slice("vmess://".length);
    const r = decodeBase64(b64);
    const json = JSON.parse(new TextDecoder().decode(r.ok ? r.value : new Uint8Array())) as Record<string, unknown>;
    expect(json.tls).toBe("");
    expect(json.sni).toBe("");
  });
});

describe("buildTrojanShareUri", () => {
  it("percent-encodes the password and omits allowInsecure", () => {
    const node: TrojanNode = {
      kind: "trojan",
      name: "T",
      address: "example.com",
      port: 443,
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "/tr",
      earlyData: 0,
      fingerprint: "chrome",
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      password: "p@ss w:rd",
    };
    const uri = buildTrojanShareUri(node);
    expect(uri).toBe(
      "trojan://p%40ss%20w%3Ard@example.com:443" +
        "?security=tls&sni=example.com&fp=chrome&type=ws&host=example.com&path=%2Ftr#T",
    );
    expect(uri.toLowerCase()).not.toContain("allowinsecure");
  });

  it("omits tls-only params for security none", () => {
    const node: TrojanNode = {
      kind: "trojan",
      name: "TP",
      address: "2001:db8::25",
      port: 8080,
      security: "none",
      sni: null,
      host: "worker.test",
      path: "/tr/p",
      earlyData: 0,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      password: "abc",
    };
    const uri = buildTrojanShareUri(node);
    expect(uri).toBe(
      "trojan://abc@[2001:db8::25]:8080?security=none&type=ws&host=worker.test&path=%2Ftr%2Fp#TP",
    );
  });

  it("emits type=ws as the first transport param", () => {
    const node: TrojanNode = {
      kind: "trojan",
      name: "T",
      address: "example.com",
      port: 443,
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "/tr",
      earlyData: 0,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      password: "p",
    };
    const uri = buildTrojanShareUri(node);
    expect(uri).toContain("type=ws&host=");
    expect(uri.indexOf("type=ws")).toBeLessThan(uri.indexOf("host="));
    expect(uri.indexOf("type=ws")).toBeLessThan(uri.indexOf("path="));
  });
});

describe("buildSSShareUri", () => {
  it("emits SIP002 websafe-b64 userinfo and escaped v2ray-plugin args", () => {
    const node: SSNode = {
      kind: "ss",
      name: "SS Node",
      address: "203.0.113.10",
      port: 8388,
      security: "tls",
      sni: null,
      host: "example.com",
      path: "/ss/abc?ed=2048",
      earlyData: 2048,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      method: "aes-128-gcm",
      password: "ss:pass=w;rd",
    };
    const uri = buildSSShareUri(node);
    const userinfo = "aes-128-gcm:ss:pass=w;rd";
    const expectedUserinfo = Buffer.from(userinfo, "utf8").toString("base64url");
    const plugin =
      "v2ray-plugin%5C%3Bmode%5C%3Dwebsocket%5C%3Btls%5C%3Bhost%5C%3Dexample.com%5C%3Bpath%5C%3D%2Fss%2Fabc%3Fed%5C%3D2048";
    expect(uri).toBe(`ss://${expectedUserinfo}@203.0.113.10:8388/?plugin=${plugin}#SS%20Node`);
    const r = decodeBase64(expectedUserinfo);
    expect(r.ok).toBe(true);
    expect(new TextDecoder().decode(r.ok ? r.value : new Uint8Array())).toBe(userinfo);
  });

  it("emits a plain ss:// URI without any plugin when direct", () => {
    const node: SSNode = {
      kind: "ss",
      name: "SS Direct",
      address: "203.0.113.10",
      port: 8388,
      security: "tls",
      sni: null,
      host: "example.com",
      path: "/ss/abc?ed=2048",
      earlyData: 2048,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      method: "aes-128-gcm",
      password: "ss:pass=w;rd",
      direct: true,
    };
    const userinfo = Buffer.from("aes-128-gcm:ss:pass=w;rd", "utf8").toString("base64url");
    expect(buildSSShareUri(node)).toBe(`ss://${userinfo}@203.0.113.10:8388#SS%20Direct`);
    expect(buildSSShareUri(node)).not.toContain("plugin");
  });

  it("omits the tls flag on plain ports", () => {
    const node: SSNode = {
      kind: "ss",
      name: "S",
      address: "203.0.113.10",
      port: 80,
      security: "none",
      sni: null,
      host: "w.test",
      path: "/ss/p",
      earlyData: 0,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      method: "aes-256-gcm",
      password: "k",
      direct: false,
    };
    const uri = buildSSShareUri(node);
    expect(uri).not.toContain("%3Btls%3B");
    expect(uri).toContain("/?plugin=");
  });
});

describe("buildShareUri dispatch", () => {
  it("routes by kind and maps lists in order", () => {
    const vless = vlessTls();
    const trojan: TrojanNode = {
      kind: "trojan",
      name: "T2",
      address: "example.com",
      port: 443,
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "/tr",
      earlyData: 0,
      fingerprint: null,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      password: "p",
    };
    const nodes: ProxyNode[] = [vless, trojan];
    const uris = buildShareUris(nodes);
    expect(uris[0]).toBe(buildShareUri(vless));
    expect(uris[1]).toBe(buildShareUri(trojan));
    expect(uris[0]!.startsWith("vless://")).toBe(true);
    expect(uris[1]!.startsWith("trojan://")).toBe(true);
  });
});
