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
    const clashBody = await renderSubscriptionBody({
      settings: settings(),
      nodes: [node("normal")],
      format: "clash",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sub?target=clash",
    });
    expect(clashBody).toContain("type: vless");
    expect(clashBody).toContain("MATCH,PROXY");
  });

  it("renders xray through the emitter registry", async () => {
    const body = await renderSubscriptionBody({
      settings: settings(),
      nodes: [node("normal")],
      format: "xray",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sub?target=xray",
    });
    expect(body).toContain('"protocol": "vless"');
    expect(body).toContain("leastPing");
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
    expect(Object.keys(SUB_CONTENT_TYPES).sort()).toEqual([
      "base64",
      "clash",
      "loon",
      "quanx",
      "singbox",
      "surge",
      "xray",
    ]);
  });

  it("serves converter targets as plain text", () => {
    expect(SUB_CONTENT_TYPES.surge).toContain("text/plain");
    expect(SUB_CONTENT_TYPES.quanx).toContain("text/plain");
    expect(SUB_CONTENT_TYPES.loon).toContain("text/plain");
  });
});

describe("renderSubscriptionBody converter targets", () => {
  const mixedUrl = "https://w.test/sp/sub?target=mixed";

  function converterSettings(): Settings {
    const s = settings();
    s.subConverter.api = "https://sub.example.com";
    s.subConverter.config = "https://example.com/rules.ini";
    return s;
  }

  it("fetches loon through the converter wrapping the mixed URL", async () => {
    let seen = "";
    const fetchFn = (async (url: unknown) => {
      seen = String(url);
      return new Response("proxies:\n  - name: A", { status: 200 });
    }) as typeof fetch;
    const body = await renderSubscriptionBody({
      settings: converterSettings(),
      nodes: [node("normal")],
      format: "loon",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sp/sub?target=loon",
      mixedUrl,
      fetchFn,
    });
    expect(body).toBe("proxies:\n  - name: A");
    const u = new URL(seen);
    expect(`${u.origin}${u.pathname}`).toBe("https://sub.example.com/sub");
    expect(u.searchParams.get("target")).toBe("loon");
    expect(u.searchParams.get("url")).toBe(mixedUrl);
  });

  it("hot-patches surge output with the managed-config line", async () => {
    const fetchFn = (async () => new Response("# rules\n[Proxy]", { status: 200 })) as typeof fetch;
    const body = await renderSubscriptionBody({
      settings: converterSettings(),
      nodes: [node("normal")],
      format: "surge",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sp/sub?target=surge",
      mixedUrl,
      fetchFn,
    });
    expect(body.split("\n")[0]).toBe(
      "#!MANAGED-CONFIG https://w.test/sp/sub?target=surge interval=43200 strict=false",
    );
    expect(body).toContain("[Proxy]");
  });

  it("rejects converter targets when no converter api is configured", async () => {
    const fetchFn = (async () => new Response("x", { status: 200 })) as typeof fetch;
    await expect(
      renderSubscriptionBody({
        settings: settings(),
        nodes: [node("normal")],
        format: "surge",
        isFragmentMode: false,
        subscriptionUrl: "https://w.test/sp/sub?target=surge",
        mixedUrl,
        fetchFn,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("maps converter upstream failures to 502 without leaking the URL", async () => {
    const fetchFn = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
    const err = await renderSubscriptionBody({
      settings: converterSettings(),
      nodes: [node("normal")],
      format: "quanx",
      isFragmentMode: false,
      subscriptionUrl: "https://w.test/sp/sub?target=quanx",
      mixedUrl,
      fetchFn,
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: "UPSTREAM" });
    expect(String((err as Error).message)).not.toContain("sub.example.com");
  });
});
