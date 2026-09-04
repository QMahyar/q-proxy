import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import type { Settings } from "../../src/types/settings";
import { generateNodes } from "../../src/nodes/generate";
import type { NodeBuilderContext } from "../../src/types/context";
import type { ProxyNode } from "../../src/types/node";

const HOST = "worker.example.workers.dev";

function settings(): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    securePath: "sp12345678",
    sessionSecret: "x".repeat(64),
    vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
    vmessUuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
    trojanPassword: "secretpass123",
    ssPassword: "sspass12345",
    randomizeSniCase: false,
  };
}

function ctx(s: Settings, url = `https://${HOST}/sub`, cf?: Record<string, unknown>): NodeBuilderContext {
  const req = new Request(url);
  if (cf) Object.defineProperty(req, "cf", { value: cf });
  return { settings: s, hostname: HOST, request: req };
}

describe("generateNodes port/security pairing", () => {
  it("emits one node per enabled protocol on the default port for a bare hostname", () => {
    const nodes = generateNodes(ctx(settings()));
    expect(nodes.length).toBe(4);
    expect(nodes.every((n) => n.port === 443 && n.security === "tls")).toBe(true);
    expect(new Set(nodes.map((n) => n.address))).toEqual(new Set([HOST]));
    expect(nodes.every((n) => n.tags.includes("workers-dev"))).toBe(true);
  });

  it("uses the default port for bare addresses and respects an explicit port", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4" }, { address: "5.6.7.8", port: 2052 }];
    const nodes = generateNodes(ctx(s));
    const a = nodes.filter((n) => n.address === "1.2.3.4");
    expect(a.length).toBe(4);
    expect(new Set(a.map((n) => n.port))).toEqual(new Set([443]));
    expect(a.every((n) => n.security === "tls")).toBe(true);
    const b = nodes.filter((n) => n.address === "5.6.7.8");
    expect(new Set(b.map((n) => n.port))).toEqual(new Set([2052]));
    expect(b.every((n) => n.security === "none" && n.sni === null)).toBe(true);
  });

  it("parses an inline ip:port in the address field", () => {
    const s = settings();
    s.addresses = [{ address: "5.6.7.8:2053" }];
    const nodes = generateNodes(ctx(s));
    expect(new Set(nodes.map((n) => n.port))).toEqual(new Set([2053]));
    expect(nodes.every((n) => n.security === "tls")).toBe(true);
  });

  it("defaults to 443 when defaultPort is set to a CF TLS port", () => {
    const s = settings();
    s.defaultPort = 8443;
    s.addresses = [{ address: "1.2.3.4" }];
    const nodes = generateNodes(ctx(s));
    expect(new Set(nodes.map((n) => n.port))).toEqual(new Set([8443]));
  });

  it("drops a pinned port outside both CF port families", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4", port: 9999 }];
    const nodes = generateNodes(ctx(s)).filter((n) => n.address === "1.2.3.4");
    expect(nodes.length).toBe(0);
  });

  it("skips address entries that are disabled", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4" }, { address: "5.6.7.8", enabled: false }];
    const nodes = generateNodes(ctx(s));
    expect(nodes.some((n) => n.address === "1.2.3.4")).toBe(true);
    expect(nodes.some((n) => n.address === "5.6.7.8")).toBe(false);
  });
});

describe("generateNodes paths and early data", () => {
  it("uses /{prefix}/{suffix} with ed param and disables early data for ss", () => {
    const nodes = generateNodes(ctx(settings()));
    const vless = nodes.find((n) => n.kind === "vless")!;
    expect(vless.path.startsWith("/vl/")).toBe(true);
    const suffix = vless.path.split("/")[2]!.split("?")[0]!;
    expect(suffix).toMatch(/^[A-Za-z0-9]{8,16}$/);
    expect(vless.path).toContain("ed=2048");
    expect(vless.earlyData).toBe(2048);
    const ss = nodes.find((n) => n.kind === "ss")!;
    expect(ss.path.startsWith("/ss/")).toBe(true);
    expect(ss.path.includes("?ed=")).toBe(false);
    expect(ss.earlyData).toBe(0);
    expect(nodes.find((n) => n.kind === "trojan")!.path.startsWith("/tr/")).toBe(true);
    expect(nodes.find((n) => n.kind === "vmess")!.path.startsWith("/vm/")).toBe(true);
  });

  it("drops the ed param when early data disabled", () => {
    const s = settings();
    s.earlyDataEnabled = false;
    expect(generateNodes(ctx(s)).filter((n) => n.kind !== "ss").every((n) => !n.path.includes("ed="))).toBe(true);
  });
});

describe("generateNodes address axis and tags", () => {
  it("tags an IP connect as clean-ip and uses the worker hostname as host/sni", () => {
    const s = settings();
    s.addresses = [{ address: "1.0.0.1" }];
    const nodes = generateNodes(ctx(s));
    const clean = nodes.filter((n) => n.address === "1.0.0.1");
    expect(clean.length).toBe(4);
    expect(clean[0]!.tags).toContain("clean-ip");
    expect(clean[0]!.host).toBe(HOST);
    expect(clean[0]!.sni).toBe(HOST);
  });

  it("tags a domain connect as custom-domain and uses the domain as host/sni", () => {
    const s = settings();
    s.addresses = [{ address: "alt.example.net" }];
    const nodes = generateNodes(ctx(s));
    const d = nodes.filter((n) => n.address === "alt.example.net");
    expect(d[0]!.tags).toContain("custom-domain");
    expect(d[0]!.host).toBe("alt.example.net");
    expect(d[0]!.sni).toBe("alt.example.net");
  });

  it("masks an IP connect with a per-address host/sni override", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4", host: "cdn.example.net", sni: "cdn.example.net" }];
    const nodes = generateNodes(ctx(s));
    expect(nodes.every((n) => n.host === "cdn.example.net" && n.sni === "cdn.example.net")).toBe(true);
  });
});

describe("generateNodes fragment variants", () => {
  it("adds a fragment variant for every TLS address when enabled", () => {
    const s = settings();
    s.fragment.mode = "medium";
    s.addresses = [{ address: "1.0.0.1" }];
    const nodes = generateNodes(ctx(s));
    const frags = nodes.filter((n) => n.variant === "fragment");
    expect(frags.length).toBe(4);
    expect(frags.every((n) => n.security === "tls" && n.tags.includes("fragment"))).toBe(true);
    const fv = frags.find((n) => n.kind === "vless")!;
    expect(fv.path).toContain("ed=2048&frag=medium");
  });

  it("omits fragment variants when mode is off", () => {
    expect(generateNodes(ctx(settings())).every((n) => n.variant === "normal")).toBe(true);
  });
});

describe("generateNodes address composition guarantee", () => {
  it("emits only the worker hostname when addresses is empty", () => {
    expect(new Set(generateNodes(ctx(settings())).map((n) => n.address))).toEqual(new Set([HOST]));
  });

  it("never introduces addresses beyond the configured addresses", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4", port: 2053 }, { address: "5.6.7.8" }];
    const allowed = new Set(["1.2.3.4", "5.6.7.8"]);
    for (const n of generateNodes(ctx(s))) expect(allowed.has(n.address), `unexpected address ${n.address}`).toBe(true);
  });
});

describe("generateNodes caps and toggles", () => {
  it("caps output at maxNodesPerFormat", () => {
    const s = settings();
    s.maxNodesPerFormat = 3;
    expect(generateNodes(ctx(s)).length).toBe(3);
    s.maxNodesPerFormat = 0;
    expect(generateNodes(ctx(s))).toEqual([]);
  });

  it("skips disabled protocols and protocols with empty credentials", () => {
    const s = settings();
    s.vmessEnabled = false;
    s.trojanPassword = "";
    const nodes = generateNodes(ctx(s));
    expect(nodes.every((n) => n.kind === "vless" || n.kind === "ss")).toBe(true);
    expect(nodes.length).toBe(2);
  });
});

describe("generateNodes fair cap rotation", () => {
  it("round-robins across protocol kinds under the cap", () => {
    const s = settings();
    s.maxNodesPerFormat = 6;
    const nodes = generateNodes(ctx(s));
    expect(nodes.map((n) => n.name)).toEqual([
      `VLESS ${HOST} 443 Workers-Dev`,
      `VMESS ${HOST} 443 Workers-Dev`,
      `TROJAN ${HOST} 443 Workers-Dev`,
      `SS ${HOST} 443 Workers-Dev`,
    ]);
  });

  it("spreads the cap evenly across remaining kinds when one is disabled", () => {
    const s = settings();
    s.ssEnabled = false;
    s.maxNodesPerFormat = 30;
    const nodes = generateNodes(ctx(s));
    const count = (k: ProxyNode["kind"]): number => nodes.filter((n) => n.kind === k).length;
    expect(count("vless")).toBe(1);
    expect(count("vmess")).toBe(1);
    expect(count("trojan")).toBe(1);
  });
});

describe("generateNodes naming enrichment", () => {
  it("prefixes the country flag from request.cf", () => {
    const nodes = generateNodes(ctx(settings(), undefined, { country: "DE" }));
    expect(nodes[0]!.name.startsWith("\u{1F1E9}\u{1F1EA} ")).toBe(true);
  });

  it("keeps names flag-free without request.cf", () => {
    expect(generateNodes(ctx(settings()))[0]!.name).toMatch(/^VLESS /);
  });

  it("scrambles sni case deterministically when randomizeSniCase is on", () => {
    const s = settings();
    s.randomizeSniCase = true;
    const a = generateNodes(ctx(s));
    const b = generateNodes(ctx(s));
    const sa = a.filter((n) => n.sni !== null).map((n) => n.sni);
    const sb = b.filter((n) => n.sni !== null).map((n) => n.sni);
    expect(sa).toEqual(sb);
    expect(sa[0]).toMatch(/^[A-Za-z.]+$/);
    expect(sa[0]!.toLowerCase()).toBe(HOST.toLowerCase());
  });

  it("a per-address label overrides the node name", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4", label: "US-Blue" }];
    const nodes = generateNodes(ctx(s));
    expect(nodes[0]!.name).toBe("US-Blue");
    expect(nodes.every((n) => n.name.startsWith("US-Blue"))).toBe(true);
  });

  it("a per-address label overrides the name template", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4", label: "NY" }];
    s.nameTemplate = "{IP}";
    const nodes = generateNodes(ctx(s));
    expect(nodes[0]!.name).toBe("NY");
    expect(nodes.every((n) => n.name.startsWith("NY"))).toBe(true);
  });

  it("name template expands placeholders when no label", () => {
    const s = settings();
    s.addresses = [{ address: "1.2.3.4" }];
    s.nameTemplate = "{FLAG}{PROTOCOL_LABEL} {IP}:{PORT}";
    const nodes = generateNodes(ctx(s, undefined, { country: "US" }));
    expect(nodes.find((n) => n.kind === "vless")!.name).toBe("\u{1F1FA}\u{1F1F8}VLESS 1.2.3.4:443");
  });

  it("encodes variant and tag tokens when no label or template", () => {
    const s = settings();
    s.addresses = [{ address: "1.0.0.1", port: 2052 }];
    const name = generateNodes(ctx(s)).find((n) => n.security === "none")!.name;
    expect(name).toContain("Plain");
    expect(name).toContain("Workers-Dev");
    expect(name).toContain("Clean-IP");
    const s2 = settings();
    s2.addresses = [{ address: "1.0.0.1" }];
    expect(generateNodes(ctx(s2)).find((n) => n.security === "tls")!.name).toContain("Clean-IP");
  });
});

describe("generateNodes ECH wiring", () => {
  it("emits null ech when ECH is disabled", () => {
    const nodes = generateNodes(ctx(settings()));
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => n.ech === null)).toBe(true);
  });

  it("emits the manual server name on TLS nodes when set", () => {
    const s = settings();
    s.echEnabled = true;
    s.echServerName = "ech.example.com";
    const nodes = generateNodes(ctx(s));
    const tls = nodes.filter((n) => n.security === "tls");
    expect(tls.length).toBeGreaterThan(0);
    expect(tls.every((n) => n.ech === "ech.example.com")).toBe(true);
  });

  it("falls back to the SNI without echAuto (legacy behavior)", () => {
    const s = settings();
    s.echEnabled = true;
    s.echAuto = false;
    const nodes = generateNodes(ctx(s));
    const tls = nodes.filter((n) => n.security === "tls");
    expect(tls.length).toBeGreaterThan(0);
    expect(tls.every((n) => n.ech === HOST)).toBe(true);
  });

  it("derives the ECH name from the SNI with echAuto", () => {
    const s = settings();
    s.echEnabled = true;
    s.echAuto = true;
    const nodes = generateNodes(ctx(s));
    const tls = nodes.filter((n) => n.security === "tls");
    expect(tls.length).toBeGreaterThan(0);
    expect(tls.every((n) => n.ech === HOST)).toBe(true);
  });

  it("emits null ech on non-TLS nodes even when ECH is enabled", () => {
    const s = settings();
    s.echEnabled = true;
    s.echAuto = true;
    s.addresses = [{ address: "5.6.7.8", port: 2052 }];
    const nodes = generateNodes(ctx(s));
    const plain = nodes.filter((n) => n.security === "none");
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((n) => n.ech === null)).toBe(true);
  });
});
