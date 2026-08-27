import { describe, expect, it, vi, afterEach } from "vitest";
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
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    remoteSubUrls: [],
  };
}

function node(variant: "normal" | "fragment", kind: ProxyNode["kind"]): ProxyNode {
  const base = {
    name: `${kind} ${variant}`,
    address: "w.test",
    port: 443,
    security: "tls" as const,
    sni: "w.test",
    host: "w.test",
    path: "/p",
    earlyData: 0,
    fingerprint: null,
    alpn: [],
    ech: null,
    variant,
    tags: [] as ProxyNode["tags"],
  };
  if (kind === "vless") return { ...base, kind, uuid: "d342d11e-d424-4583-b36e-524ab1f0afa4" };
  if (kind === "vmess")
    return { ...base, kind, uuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd", cipher: "auto" as const, alterId: 0 as const };
  if (kind === "trojan") return { ...base, kind, password: "pass123456" };
  return { ...base, kind, method: "aes-128-gcm" as const, password: "sspass12345" };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selectVariantNodes", () => {
  it("keeps only the requested variant", () => {
    const all = [node("normal", "vless"), node("fragment", "vless")];
    expect(selectVariantNodes(all, "normal").map((n) => n.variant)).toEqual(["normal"]);
    expect(selectVariantNodes(all, "fragment").map((n) => n.variant)).toEqual(["fragment"]);
  });

  it("falls back to all nodes when fragment filter is empty", () => {
    const all = [node("normal", "trojan"), node("normal", "ss")];
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
      format: "clash" as const,
      isFragmentMode: true,
      subscriptionUrl: "https://w.test/sub?target=clash",
    };
    const opts = emitterOptions(input);
    expect(opts.isFragment).toBe(true);
    expect(opts.remoteDns).toBe(s.remoteDns);
    expect(opts.updateIntervalHours).toBe(s.subUpdateIntervalHours);
    expect(opts.rules?.bypassDomains).toEqual(["a.test"]);
    opts.rules!.bypassDomains.push("mutated.test");
    expect(s.routingRules.customBypass).toEqual(["a.test"]);
  });
});

describe("renderSubscriptionBody", () => {
  it("renders non-base64 formats through the emitter registry", async () => {
    const body = await renderSubscriptionBody({
      settings: settings(),
      nodes: [node("normal", "trojan")],
      format: "surge",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sub?target=surge",
    });
    expect(body).toContain("#!MANAGED-CONFIG https://w.test/sub?target=surge");
  });

  it("base64 body merges own share URIs with fetched remote lines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(btoa("ss://remote@203.0.113.9:1#R"), { status: 200 })),
    );
    const s = settings();
    s.remoteSubUrls = ["https://r/sub"];
    const body = await renderSubscriptionBody({
      settings: s,
      nodes: [node("normal", "vless")],
      format: "base64",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sub?target=base64",
    });
    const decoded = decodeBase64(body);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(decoded.value);
    expect(text.split("\n")[0]!.startsWith("vless://")).toBe(true);
    expect(text).toContain("ss://remote@203.0.113.9:1");
  });
});

describe("SUB_CONTENT_TYPES", () => {
  it("covers every subscription format", () => {
    expect(Object.keys(SUB_CONTENT_TYPES).sort()).toEqual(["base64", "clash", "loon", "singbox", "surge"]);
  });
});
