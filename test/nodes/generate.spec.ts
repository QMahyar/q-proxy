import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import type { Settings } from "../../src/types/settings";
import { generateNodes } from "../../src/nodes/generate";
import type { NodeBuilderContext } from "../../src/types/context";

const HOST = "worker.example.workers.dev";

function settings(): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    securePath: "sp12345678",
    sessionSecret: "x".repeat(64),
    vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
    randomizeSniCase: false,
  };
}

function ctx(s: Settings, url = `https://${HOST}/sub`, cf?: Record<string, unknown>): NodeBuilderContext {
  const req = new Request(url);
  if (cf) Object.defineProperty(req, "cf", { value: cf });
  return { settings: s, hostname: HOST, request: req };
}

describe("generateNodes port/security pairing", () => {
  it("emits one vless node on the default port for a bare hostname", () => {
    const nodes = generateNodes(ctx(settings()));
    expect(nodes.length).toBe(1);
    expect(nodes.every((n) => n.port === 443 && n.security === "tls")).toBe(true);
    expect(new Set(nodes.map((n) => n.address))).toEqual(new Set([HOST]));
    expect(nodes.every((n) => n.tags.includes("workers-dev"))).toBe(true);
  });

  it("uses the default port for bare lines and respects an explicit port", () => {
    const s = settings();
    s.customEndpoints = ["1.2.3.4", "5.6.7.8:2052"];
    const nodes = generateNodes(ctx(s));
    const a = nodes.filter((n) => n.address === "1.2.3.4");
    expect(a.length).toBe(1);
    expect(new Set(a.map((n) => n.port))).toEqual(new Set([443]));
    expect(a.every((n) => n.security === "tls")).toBe(true);
    const b = nodes.filter((n) => n.address === "5.6.7.8");
    expect(new Set(b.map((n) => n.port))).toEqual(new Set([2052]));
    expect(b.every((n) => n.security === "none" && n.sni === null)).toBe(true);
  });

  it("parses an inline ip:port in the custom line", () => {
    const s = settings();
    s.customEndpoints = ["5.6.7.8:2053"];
    const nodes = generateNodes(ctx(s));
    expect(new Set(nodes.map((n) => n.port))).toEqual(new Set([2053]));
    expect(nodes.every((n) => n.security === "tls")).toBe(true);
  });

  it("defaults to 443 when defaultPort is set to a CF TLS port", () => {
    const s = settings();
    s.defaultPort = 8443;
    s.customEndpoints = ["1.2.3.4"];
    const nodes = generateNodes(ctx(s));
    expect(new Set(nodes.map((n) => n.port))).toEqual(new Set([8443]));
  });

  it("drops a pinned port outside both CF port families", () => {
    const s = settings();
    s.customEndpoints = ["1.2.3.4:9999"];
    const nodes = generateNodes(ctx(s)).filter((n) => n.address === "1.2.3.4");
    expect(nodes.length).toBe(0);
  });

  it("emits only ticked presets and skips unticked ones", () => {
    const s = settings();
    s.cdnPresets = ["cf-443-a"];
    const nodes = generateNodes(ctx(s));
    expect(nodes.some((n) => n.address === "104.17.0.0")).toBe(true);
    expect(nodes.some((n) => n.address === "104.18.0.0")).toBe(false);
  });
});

describe("generateNodes paths and early data", () => {
  it("uses /{prefix}/{suffix} with ed param", () => {
    const nodes = generateNodes(ctx(settings()));
    expect(nodes.length).toBe(1);
    const vless = nodes.find((n) => n.kind === "vless")!;
    expect(vless.path.startsWith("/vl/")).toBe(true);
    const suffix = vless.path.split("/")[2]!.split("?")[0]!;
    expect(suffix).toMatch(/^[A-Za-z0-9]{8,16}$/);
    expect(vless.path).toContain("ed=2048");
    expect(vless.earlyData).toBe(2048);
  });

  it("drops the ed param when early data disabled", () => {
    const s = settings();
    s.earlyDataEnabled = false;
    expect(generateNodes(ctx(s)).every((n) => !n.path.includes("ed="))).toBe(true);
  });
});

describe("generateNodes address axis and tags", () => {
  it("tags an IP connect as clean-ip and uses the worker hostname as host/sni", () => {
    const s = settings();
    s.customEndpoints = ["1.0.0.1"];
    const nodes = generateNodes(ctx(s));
    const clean = nodes.filter((n) => n.address === "1.0.0.1");
    expect(clean.length).toBe(1);
    expect(clean[0]!.tags).toContain("clean-ip");
    expect(clean[0]!.host).toBe(HOST);
    expect(clean[0]!.sni).toBe(HOST);
  });

  it("tags a domain connect as custom-domain and uses the domain as host/sni", () => {
    const s = settings();
    s.customEndpoints = ["alt.example.net"];
    const nodes = generateNodes(ctx(s));
    const d = nodes.filter((n) => n.address === "alt.example.net");
    expect(d[0]!.tags).toContain("custom-domain");
    expect(d[0]!.host).toBe("alt.example.net");
    expect(d[0]!.sni).toBe("alt.example.net");
  });
});

describe("generateNodes fragment variants", () => {
  it("adds a fragment variant for every TLS address when enabled", () => {
    const s = settings();
    s.fragment.mode = "medium";
    s.customEndpoints = ["1.0.0.1"];
    const nodes = generateNodes(ctx(s));
    const frags = nodes.filter((n) => n.variant === "fragment");
    expect(frags.length).toBe(1);
    expect(frags.every((n) => n.security === "tls" && n.tags.includes("fragment"))).toBe(true);
    const fv = frags.find((n) => n.kind === "vless")!;
    expect(fv.path).toContain("ed=2048&frag=medium");
  });

  it("gives preset CDN endpoints fragment variants like any TLS address", () => {
    const s = settings();
    s.fragment.mode = "medium";
    s.cdnPresets = ["cf-443-a", "cf-80-a"];
    const nodes = generateNodes(ctx(s));
    const tlsFrags = nodes.filter((n) => n.address === "104.17.0.0" && n.port === 443 && n.variant === "fragment");
    expect(tlsFrags.length).toBe(1);
    expect(tlsFrags[0]!.path).toContain("frag=medium");
    expect(nodes.some((n) => n.address === "104.17.0.0" && n.port === 80 && n.variant === "fragment")).toBe(false);
  });

  it("omits fragment variants when mode is off", () => {
    expect(generateNodes(ctx(settings())).every((n) => n.variant === "normal")).toBe(true);
  });
});

describe("generateNodes address composition guarantee (presets + custom + hostname only)", () => {
  it("emits only the worker hostname when nothing is selected", () => {
    expect(new Set(generateNodes(ctx(settings())).map((n) => n.address))).toEqual(new Set([HOST]));
  });

  it("never introduces addresses beyond presets, custom lines, and hostname", () => {
    const s = settings();
    s.cdnPresets = ["cf-443-a"];
    s.customEndpoints = ["1.2.3.4:2053", "5.6.7.8"];
    const allowed = new Set(["104.17.0.0", "1.2.3.4", "5.6.7.8"]);
    for (const n of generateNodes(ctx(s))) expect(allowed.has(n.address), `unexpected address ${n.address}`).toBe(true);
  });

  it("ignores unknown preset ids and pre-cut addresses data", () => {
    const s = settings();
    s.cdnPresets = ["cf-443-a", "retired-preset"];
    (s as unknown as Record<string, unknown>).addresses = [{ address: "9.9.9.9" }];
    const addrs = new Set(generateNodes(ctx(s)).map((n) => n.address));
    expect(addrs).toEqual(new Set(["104.17.0.0"]));
  });

  it("dedupes preset/custom/hostname overlaps by host and port", () => {
    const s = settings();
    s.cdnPresets = ["cf-443-a"];
    s.customEndpoints = ["104.17.0.0:443", "104.17.0.0:8443"];
    const nodes = generateNodes(ctx(s));
    expect(nodes.filter((n) => n.address === "104.17.0.0" && n.port === 443)).toHaveLength(1);
    expect(nodes.filter((n) => n.address === "104.17.0.0" && n.port === 8443)).toHaveLength(1);
  });
});

describe("generateNodes caps and toggles", () => {
  it("caps output at maxNodesPerFormat", () => {
    const s = settings();
    s.customEndpoints = ["1.2.3.4", "5.6.7.8"];
    s.maxNodesPerFormat = 1;
    expect(generateNodes(ctx(s)).length).toBe(1);
    s.maxNodesPerFormat = 0;
    expect(generateNodes(ctx(s))).toEqual([]);
  });

  it("skips vless when disabled or credential is empty", () => {
    const s = settings();
    s.vlessEnabled = false;
    expect(generateNodes(ctx(s))).toEqual([]);
    const s2 = settings();
    s2.vlessUuid = "";
    expect(generateNodes(ctx(s2))).toEqual([]);
    const s3 = settings();
    s3.vlessEnabled = false;
    s3.vlessUuid = "";
    expect(generateNodes(ctx(s3))).toEqual([]);
    expect(generateNodes(ctx(settings())).every((n) => n.kind === "vless")).toBe(true);
  });
});

describe("generateNodes single-kind cap", () => {
  it("emits at most one node per address under the cap", () => {
    const s = settings();
    s.customEndpoints = ["1.2.3.4", "5.6.7.8"];
    s.maxNodesPerFormat = 6;
    const nodes = generateNodes(ctx(s));
    expect(nodes.map((n) => n.name)).toEqual([
      `VLESS 1.2.3.4 443 Clean-IP-Workers-Dev`,
      `VLESS 5.6.7.8 443 Clean-IP-Workers-Dev`,
    ]);
  });

  it("caps output across addresses", () => {
    const s = settings();
    s.customEndpoints = ["1.2.3.4", "5.6.7.8"];
    s.maxNodesPerFormat = 1;
    expect(generateNodes(ctx(s)).length).toBe(1);
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

  it("name template expands placeholders", () => {
    const s = settings();
    s.customEndpoints = ["1.2.3.4"];
    s.nameTemplate = "{FLAG}{PROTOCOL_LABEL} {IP}:{PORT}";
    const nodes = generateNodes(ctx(s, undefined, { country: "US" }));
    expect(nodes.find((n) => n.kind === "vless")!.name).toBe("\u{1F1FA}\u{1F1F8}VLESS 1.2.3.4:443");
  });

  it("encodes variant and tag tokens", () => {
    const s = settings();
    s.customEndpoints = ["1.0.0.1:2052"];
    const name = generateNodes(ctx(s)).find((n) => n.security === "none")!.name;
    expect(name).toContain("Plain");
    expect(name).toContain("Workers-Dev");
    expect(name).toContain("Clean-IP");
    const s2 = settings();
    s2.customEndpoints = ["1.0.0.1"];
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
    s.customEndpoints = ["5.6.7.8:2052"];
    const nodes = generateNodes(ctx(s));
    const plain = nodes.filter((n) => n.security === "none");
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((n) => n.ech === null)).toBe(true);
  });
});

describe("generateNodes vlessFlow stamping", () => {
  it("defaults vless flow to null", () => {
    for (const n of generateNodes(ctx(settings()))) {
      if (n.kind === "vless") expect(n.flow).toBeNull();
    }
  });

  it("stamps the configured flow onto TLS vless nodes only", () => {
    const s = settings();
    s.vlessFlow = "xtls-rprx-vision";
    s.customEndpoints = ["1.2.3.4", "5.6.7.8:2052"];
    const nodes = generateNodes(ctx(s));
    const tls = nodes.filter((n) => n.kind === "vless" && n.security === "tls");
    const plain = nodes.filter((n) => n.kind === "vless" && n.security === "none");
    expect(tls.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    expect(tls.every((n) => n.kind === "vless" && n.flow === "xtls-rprx-vision")).toBe(true);
    expect(plain.every((n) => n.kind === "vless" && n.flow === null)).toBe(true);
  });
});

