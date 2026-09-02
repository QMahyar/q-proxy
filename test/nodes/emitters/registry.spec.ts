import { describe, expect, it } from "vitest";
import { EMITTERS } from "../../../src/nodes/emitters/registry";
import { renderSubscriptionBody } from "../../../src/subscription/render";
import { DEFAULT_SETTINGS } from "../../../src/types/settings";
import type { ProxyNode } from "../../../src/types/node";
import { decodeBase64 } from "../../../src/utils/base64";

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

async function base64Body(nodes: ProxyNode[], isFragmentMode = false): Promise<string> {
  return renderSubscriptionBody({
    settings: { ...structuredClone(DEFAULT_SETTINGS), remoteSubUrls: [] },
    nodes,
    format: "base64",
    isFragmentMode,
    subscriptionUrl: "https://w.test/sub?target=base64",
  });
}

function decodeBody(body: string): string {
  const decoded = decodeBase64(body);
  return new TextDecoder().decode(decoded.ok ? decoded.value : new Uint8Array());
}

describe("EMITTERS registry", () => {
  it("covers exactly the four sync SubFormats (base64 renders async via renderSubscriptionBody)", () => {
    expect(Object.keys(EMITTERS).sort()).toEqual(["clash", "loon", "singbox", "surge"]);
  });
});

describe("base64 subscription body", () => {
  it("produces padded standard base64 of newline-joined URIs", async () => {
    const out = await base64Body([vless()]);
    expect(out.endsWith("=")).toBe(true);
    expect(out.includes("-")).toBe(false);
    expect(out.includes("_")).toBe(false);
    const lines = decodeBody(out).split("\n");
    expect(lines).toEqual([
      "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fvl%2Fabcd1234%3Fed%3D2048#V",
    ]);
  });

  it("drops fragment nodes unless isFragmentMode", async () => {
    const frag: ProxyNode = { ...vless(), variant: "fragment", tags: ["fragment"] };
    expect(decodeBody(await base64Body([frag]))).toBe("");
    expect(decodeBody(await base64Body([frag], true)).startsWith("vless://")).toBe(true);
  });

  it("drops ss and plain-security vless/trojan nodes for base64 clients", async () => {
    const ss = ssNode();
    const plainVless: ProxyNode = { ...vless(), name: "PV", port: 80, security: "none", sni: null, fingerprint: null, alpn: [], path: "/vl/a" };
    const text = decodeBody(await base64Body([vless(), ss, plainVless]));
    const lines = text.split("\n");
    expect(lines.some((l) => l.startsWith("ss://"))).toBe(false);
    expect(lines.some((l) => l.includes("security=none"))).toBe(false);
    expect(lines.some((l) => l.startsWith("vless://"))).toBe(true);
  });

  it("keeps ss nodes when the scope has no other kinds (per-user ss-only subscriptions)", async () => {
    const text = decodeBody(await base64Body([ssNode()]));
    expect(text.startsWith("ss://")).toBe(true);
  });
});

function ssNode(): ProxyNode {
  return {
    kind: "ss",
    name: "SS",
    address: "203.0.113.10",
    port: 8388,
    security: "tls",
    sni: null,
    host: "example.com",
    path: "/ss/abc",
    earlyData: 0,
    fingerprint: null,
    alpn: [],
    ech: null,
    variant: "normal",
    tags: [],
    method: "aes-128-gcm",
    password: "p",
  };
}
