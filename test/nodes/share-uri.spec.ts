import { describe, expect, it } from "vitest";
import type { ProxyNode, VlessNode } from "../../src/types/node";
import {
  buildShareUri,
  buildShareUris,
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
