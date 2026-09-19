import { describe, expect, it } from "vitest";
import {
  emitterOptions,
  renderSubscriptionBody,
  selectVariantNodes,
  SUB_CONTENT_TYPES,
} from "../../src/subscription/render";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import type { Settings } from "../../src/types/settings";
import type { ProxyNode } from "../../src/types/node";
import { decodeBase64 } from "../../src/utils/base64";

function settings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

function node(variant: "normal" | "fragment"): ProxyNode {
  return {
    kind: "vless",
    name: `vless ${variant}`,
    address: "w.test",
    port: 443,
    security: "tls",
    sni: "w.test",
    host: "w.test",
    path: "/p",
    earlyData: 0,
    fingerprint: null,
    alpn: [],
    ech: null,
    variant,
    tags: [],
    uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
  };
}

describe("selectVariantNodes", () => {
  it("keeps only the requested variant", () => {
    const all = [node("normal"), node("fragment")];
    expect(selectVariantNodes(all, "normal").map((n) => n.variant)).toEqual(["normal"]);
    expect(selectVariantNodes(all, "fragment").map((n) => n.variant)).toEqual(["fragment"]);
  });

  it("falls back to all nodes when fragment filter is empty", () => {
    const all = [node("normal"), node("normal")];
    const picked = selectVariantNodes(all, "fragment");
    expect(picked).toHaveLength(2);
  });

  it("does not fall back for an empty normal selection", () => {
    expect(selectVariantNodes([], "normal")).toHaveLength(0);
  });
});

describe("emitterOptions", () => {
  it("maps settings and routing rules into emit options without aliasing arrays", () => {
    const s = settings();
    s.routingRules.customBypass = ["a.test"];
    const input = {
      settings: s,
      nodes: [],
      format: "singbox" as const,
      isFragmentMode: true,
      subscriptionUrl: "https://w.test/sub?target=singbox",
    };
    const opts = emitterOptions(input);
    expect(opts.isFragment).toBe(true);
    expect(opts.updateIntervalHours).toBe(s.subUpdateIntervalHours);
    expect(opts.rules?.bypassDomains).toEqual(["a.test"]);
    opts.rules!.bypassDomains.push("mutated.test");
    expect(s.routingRules.customBypass).toEqual(["a.test"]);
  });
});

describe("renderSubscriptionBody", () => {
  it("renders singbox through the emitter registry", async () => {
    const body = await renderSubscriptionBody({
      settings: settings(),
      nodes: [node("normal")],
      format: "singbox",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sub?target=singbox",
    });
    expect(body).toContain('"type": "vless"');
  });

  it("renders clash through the emitter registry", async () => {
    const body = await renderSubscriptionBody({
      settings: settings(),
      nodes: [node("normal")],
      format: "clash",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sub?target=clash",
    });
    expect(body).toContain("type: vless");
    expect(body).toContain("MATCH,PROXY");
  });

  it("base64 body contains own share URIs only (remote merge removed)", async () => {
    const body = await renderSubscriptionBody({
      settings: settings(),
      nodes: [node("normal")],
      format: "base64",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sub?target=base64",
    });
    const decoded = decodeBase64(body);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(decoded.value);
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith("vless://")).toBe(true);
  });
});

describe("SUB_CONTENT_TYPES", () => {
  it("covers every surviving subscription format", () => {
    expect(Object.keys(SUB_CONTENT_TYPES).sort()).toEqual(["base64", "clash", "singbox"]);
  });
});
