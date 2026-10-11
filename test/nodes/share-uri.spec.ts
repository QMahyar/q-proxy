import { describe, expect, it } from "vitest";
import type { ProxyNode, ShadowsocksNode, TrojanNode, VlessNode } from "../../src/types/node";
import {
  buildShareUri,
  buildShareUris,
  buildShadowsocksShareUri,
  buildTrojanShareUri,
  buildVlessShareUri,
} from "../../src/nodes/share-uri";

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

describe("buildShareUri dispatch", () => {
  it("routes vless and maps lists in order", () => {
    const vless = vlessTls();
    const nodes: ProxyNode[] = [vless, { ...vless, name: "V2" }];
    const uris = buildShareUris(nodes);
    expect(uris[0]).toBe(buildShareUri(vless));
    expect(uris[0]!.startsWith("vless://")).toBe(true);
    expect(uris).toHaveLength(2);
  });
});

describe("trojan/ss share URIs (B5)", () => {
  function trojanTls(): TrojanNode {
    return {
      kind: "trojan",
      name: "TJ-TLS",
      address: "example.com",
      port: 443,
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "/tj/abcd1234",
      earlyData: 0,
      fingerprint: "chrome",
      alpn: ["http/1.1"],
      ech: null,
      variant: "normal",
      tags: [],
      password: "s3cret",
    };
  }

  function ssTls(): ShadowsocksNode {
    return {
      kind: "shadowsocks",
      name: "SS-TLS",
      address: "example.com",
      port: 443,
      security: "tls",
      sni: "example.com",
      host: "example.com",
      path: "/vl/abcd1234",
      earlyData: 0,
      fingerprint: "chrome",
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      method: "aes-128-gcm",
      password: "d342d11e-d424-4583-b36e-524ab1f0afa4",
      tls: false,
    };
  }

  it("builds trojan:// with ws params on tls", () => {
    expect(buildTrojanShareUri(trojanTls())).toBe(
      "trojan://s3cret@example.com:443" +
        "?security=tls&sni=example.com&fp=chrome&alpn=http%2F1.1" +
        "&type=ws&host=example.com&path=%2Ftj%2Fabcd1234#TJ-TLS",
    );
  });

  it("builds trojan:// with security=none and no sni on plain", () => {
    const uri = buildTrojanShareUri({ ...trojanTls(), security: "none", sni: null, port: 80, name: "TJ" });
    expect(uri).toBe("trojan://s3cret@example.com:80?security=none&type=ws&host=example.com&path=%2Ftj%2Fabcd1234#TJ");
  });

  it("builds ss:// as base64(method:password) with tls marker when securing", () => {
    // method:password = "aes-128-gcm:d342d11e-..." base64.
    const uri = buildShadowsocksShareUri(ssTls());
    expect(uri.startsWith("ss://")).toBe(true);
    expect(uri).toContain("@example.com:443");
    expect(uri).toContain("?tls=1&sni=example.com");
    expect(uri.endsWith("#SS-TLS")).toBe(true);
    const userinfo = uri.slice("ss://".length, uri.indexOf("@"));
    expect(Buffer.from(userinfo, "base64").toString()).toBe("aes-128-gcm:d342d11e-d424-4583-b36e-524ab1f0afa4");
  });

  it("omits the tls marker for plain ss nodes", () => {
    const uri = buildShadowsocksShareUri({ ...ssTls(), security: "none", sni: null, port: 80, tls: false, name: "SS" });
    expect(uri).not.toContain("tls=1");
    expect(uri.endsWith("#SS")).toBe(true);
  });

  it("dispatches all three kinds through buildShareUri(s)", () => {
    const nodes: ProxyNode[] = [vlessTls(), trojanTls(), ssTls()];
    const uris = buildShareUris(nodes);
    expect(uris[0]!.startsWith("vless://")).toBe(true);
    expect(uris[1]!.startsWith("trojan://")).toBe(true);
    expect(uris[2]!.startsWith("ss://")).toBe(true);
  });
});
