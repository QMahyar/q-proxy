import { describe, expect, it } from "vitest";
import { EMITTERS } from "../../../src/nodes/emitters/registry";
import { emitBase64List } from "../../../src/nodes/emitters/base64-list";
import type { ProxyNode } from "../../../src/types/node";
import { decodeBase64 } from "../../../src/utils/base64";

const OPTS = { remoteDns: "https://8.8.8.8/dns-query", urlTestIntervalSec: 300, isFragment: false };

function vless(): ProxyNode {
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
    fingerprint: null,
    alpn: [],
    ech: null,
    variant: "normal",
    tags: [],
    uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
  };
}

describe("EMITTERS registry", () => {
  it("covers exactly the five SubFormats", () => {
    expect(Object.keys(EMITTERS).sort()).toEqual(["base64", "clash", "loon", "singbox", "surge"]);
  });

  it("each emitter returns a string for the same input", () => {
    const nodes = [vless()];
    for (const emitter of Object.values(EMITTERS)) {
      expect(typeof emitter(nodes, OPTS)).toBe("string");
    }
  });
});

describe("emitBase64List", () => {
  it("produces padded standard base64 of newline-joined URIs", () => {
    const out = emitBase64List([vless()], OPTS);
    expect(out.endsWith("=")).toBe(true);
    expect(out.includes("-")).toBe(false);
    expect(out.includes("_")).toBe(false);
    const r = decodeBase64(out);
    expect(r.ok).toBe(true);
    const text = new TextDecoder().decode(r.ok ? r.value : new Uint8Array());
    expect(text.split("\n")).toEqual([
      "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fvl%2Fabcd1234%3Fed%3D2048#V",
    ]);
  });

  it("drops fragment nodes unless opts.isFragment", () => {
    const frag: ProxyNode = { ...vless(), variant: "fragment", tags: ["fragment"] };
    const rOff = decodeBase64(emitBase64List([frag], OPTS));
    expect(new TextDecoder().decode(rOff.ok ? rOff.value : new Uint8Array())).toBe("");
    const rOn = decodeBase64(emitBase64List([frag], { ...OPTS, isFragment: true }));
    expect(new TextDecoder().decode(rOn.ok ? rOn.value : new Uint8Array()).startsWith("vless://")).toBe(true);
  });
});
