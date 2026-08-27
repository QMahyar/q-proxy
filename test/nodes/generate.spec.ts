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

const TLS_PORTS = new Set(DEFAULT_SETTINGS.tlsPorts);
const PLAIN_PORTS = new Set(DEFAULT_SETTINGS.plainPorts);

describe("generateNodes port/security pairing", () => {
  it("expands all enabled protocols across both port families on workers.dev", () => {
    const nodes = generateNodes(ctx(settings()));
    expect(nodes.length).toBe(4 * (6 + 7));
    for (const n of nodes) {
      if (n.security === "tls") expect(TLS_PORTS.has(n.port)).toBe(true);
      else expect(PLAIN_PORTS.has(n.port)).toBe(true);
      expect(n.tags).toContain("workers-dev");
    }
  });

  it("keeps every tls node on the tls family and plain on the plain family", () => {
    const nodes = generateNodes(ctx(settings()));
    const mismatch = nodes.filter((n) => TLS_PORTS.has(n.port) !== (n.security === "tls"));
    expect(mismatch).toEqual([]);
  });

  it("honors plainPortPolicy never", () => {
    const s = settings();
    s.plainPortPolicy = "never";
    const nodes = generateNodes(ctx(s));
    expect(nodes.length).toBe(4 * 6);
    expect(nodes.every((n) => n.security === "tls")).toBe(true);
  });

  it("workers-dev policy suppresses plain ports off workers.dev", () => {
    const s = settings();
    const c = ctx(s, "https://panel.example.com/sub");
    c.hostname = "panel.example.com";
    const nodes = generateNodes(c);
    expect(nodes.length).toBe(4 * 6);
    s.plainPortPolicy = "always";
    const withPlain = generateNodes({ ...c, settings: s });
    expect(withPlain.some((n) => n.security === "none")).toBe(true);
  });
});

describe("generateNodes paths and early data", () => {
  it("uses /{prefix}/{suffix} with ed param and disables early data for ss", () => {
    const nodes = generateNodes(ctx(settings()));
    const byKind = (k: ProxyNode["kind"]): ProxyNode[] => nodes.filter((n) => n.kind === k);
    const vless = byKind("vless");
    for (const n of vless) {
      expect(n.path.startsWith("/vl/")).toBe(true);
      const suffix = n.path.split("/")[2]!.split("?")[0]!;
      expect(suffix).toMatch(/^[A-Za-z0-9]{8,16}$/);
      expect(n.path).toContain("ed=2048");
      expect(n.earlyData).toBe(2048);
    }
    for (const n of byKind("ss")) {
      expect(n.path.startsWith("/ss/")).toBe(true);
      expect(n.path.includes("?ed=")).toBe(false);
      expect(n.earlyData).toBe(0);
    }
    for (const n of byKind("trojan")) expect(n.path.startsWith("/tr/")).toBe(true);
    for (const n of byKind("vmess")) expect(n.path.startsWith("/vm/")).toBe(true);
  });

  it("drops the ed param when early data disabled", () => {
    const s = settings();
    s.earlyDataEnabled = false;
    const nodes = generateNodes(ctx(s));
    expect(nodes.filter((n) => n.kind !== "ss").every((n) => !n.path.includes("ed="))).toBe(true);
  });
});

describe("generateNodes address axis and tags", () => {
  it("adds clean ips with primary host/sni and clean-ip tag", () => {
    const s = settings();
    s.cleanIps = ["1.0.0.1 ", "worker.example.workers.dev"];
    const nodes = generateNodes(ctx(s));
    const clean = nodes.filter((n) => n.address === "1.0.0.1");
    expect(clean.length).toBeGreaterThan(0);
    expect(clean[0]!.tags).toContain("clean-ip");
    expect(clean[0]!.host).toBe(HOST);
    expect(clean[0]!.sni).toBe(HOST);
    expect(nodes.filter((n) => n.address === "worker.example.workers.dev").length).toBe(4 * 13);
  });

  it("pins clean-ip entries with an explicit port to that port only", () => {
    const s = settings();
    s.cleanIps = ["1.2.3.4:2053", "5.6.7.8", "[2606:4700::1]:8443", "junkline"];
    const nodes = generateNodes(ctx(s));

    const pinned2053 = nodes.filter((n) => n.address === "1.2.3.4");
    expect(pinned2053.length).toBe(4);
    expect(new Set(pinned2053.map((n) => n.port))).toEqual(new Set([2053]));
    expect(pinned2053.every((n) => n.security === "tls")).toBe(true);

    const pinnedV6 = nodes.filter((n) => n.address === "[2606:4700::1]");
    expect(pinnedV6.length).toBe(4);
    expect(new Set(pinnedV6.map((n) => n.port))).toEqual(new Set([8443]));
    expect(pinnedV6.every((n) => n.security === "tls" && n.tags.includes("clean-ip"))).toBe(true);

    const bare = nodes.filter((n) => n.address === "5.6.7.8");
    expect(bare.length).toBe(4 * (6 + 7));
    expect(new Set(bare.map((n) => n.port)).size).toBe(13);
    expect(nodes.some((n) => n.address === "junkline")).toBe(false);
  });

  it("treats a pinned non-CF port as plaintext family", () => {
    const s = settings();
    s.cleanIps = ["1.2.3.4:9999"];
    const nodes = generateNodes(ctx(s)).filter((n) => n.address === "1.2.3.4");
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => n.security === "none" && n.port === 9999 && n.sni === null)).toBe(true);
  });

  it("masks cdn addresses with cdn host/sni and tags them cdn", () => {
    const s = settings();
    s.cdn = { enabled: true, addresses: ["104.16.1.1"], host: "cdn.example.net", sni: "" };
    const nodes = generateNodes(ctx(s));
    const cdnTls = nodes.find((n) => n.address === "104.16.1.1" && n.security === "tls")!;
    expect(cdnTls.tags).toContain("cdn");
    expect(cdnTls.host).toBe("cdn.example.net");
    expect(cdnTls.sni).toBe("cdn.example.net");
  });

  it("tags secondary custom domains as custom-domain while keeping the first as primary", () => {
    const s = settings();
    s.customDomains = [HOST, "alt.example.net"];
    const nodes = generateNodes(ctx(s));
    const alt = nodes.filter((n) => n.address === "alt.example.net");
    expect(alt.length).toBe(4 * 13);
    expect(alt.every((n) => n.tags.includes("custom-domain"))).toBe(true);
  });
});

describe("generateNodes fragment variants", () => {
  function fragSettings(): Settings {
    const s = settings();
    s.fragment.mode = "medium";
    s.cdn = { enabled: true, addresses: ["104.16.1.1"], host: "", sni: "" };
    s.cleanIps = ["1.0.0.1"];
    return s;
  }

  it("adds fragment variants only for tls ports and excludes cdn addresses", () => {
    const nodes = generateNodes(ctx(fragSettings()));
    const frags = nodes.filter((n) => n.variant === "fragment");
    expect(frags.length).toBe(4 * 2 * 6);
    expect(frags.every((n) => n.security === "tls")).toBe(true);
    expect(frags.every((n) => n.address !== "104.16.1.1")).toBe(true);
    expect(frags.every((n) => n.tags.includes("fragment"))).toBe(true);
    const fragVless = frags.find((n) => n.kind === "vless")!;
    expect(fragVless.path).toBe(`/vl/${fragVless.path.split("/")[2]!.split("?")[0]}?ed=2048&frag=medium`);
  });

  it("marks the fragment marker on custom mode with explicit numbers", () => {
    const s = fragSettings();
    s.fragment.mode = "custom";
    s.fragment.packets = "1-3";
    s.fragment.lengthMin = 10;
    s.fragment.lengthMax = 20;
    s.fragment.delayMin = 2;
    s.fragment.delayMax = 4;
    s.fragment.maxSplitMin = 1;
    s.fragment.maxSplitMax = 2;
    const nodes = generateNodes(ctx(s));
    const frag = nodes.find((n) => n.variant === "fragment" && n.kind === "vless")!;
    expect(frag.path).toContain("&frag=custom&fpackets=1-3&flen=10-20&fdelay=2-4&fsplit=1-2");
  });

  it("omits fragment variants when mode is off", () => {
    const nodes = generateNodes(ctx(settings()));
    expect(nodes.every((n) => n.variant === "normal")).toBe(true);
  });
});

describe("generateNodes address composition guarantee", () => {
  it("emits only the worker hostname when all user lists are empty", () => {
    const s = settings();
    s.customDomains = [];
    s.cleanIps = [];
    s.cdn = { enabled: false, addresses: [], host: "", sni: "" };
    const nodes = generateNodes(ctx(s));
    expect(nodes.length).toBeGreaterThan(0);
    expect(new Set(nodes.map((n) => n.address))).toEqual(new Set([HOST]));
  });

  it("never introduces addresses beyond hostname + user lists", () => {
    const s = settings();
    s.customDomains = ["my.domain.net"];
    s.cleanIps = ["1.2.3.4:2053", "5.6.7.8"];
    const allowed = new Set([HOST, "my.domain.net", "1.2.3.4", "5.6.7.8"]);
    const nodes = generateNodes(ctx(s));
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(allowed.has(n.address), `unexpected address ${n.address}`).toBe(true);
    }
  });
});

describe("generateNodes caps and toggles", () => {
  it("caps output at maxNodesPerFormat", () => {
    const s = settings();
    s.maxNodesPerFormat = 7;
    expect(generateNodes(ctx(s)).length).toBe(7);
    s.maxNodesPerFormat = 0;
    expect(generateNodes(ctx(s))).toEqual([]);
  });

  it("skips disabled protocols and protocols with empty credentials", () => {
    const s = settings();
    s.vmessEnabled = false;
    s.trojanPassword = "";
    const nodes = generateNodes(ctx(s));
    expect(nodes.every((n) => n.kind === "vless" || n.kind === "ss")).toBe(true);
    expect(nodes.length).toBe(2 * 13);
  });
});

describe("generateNodes fair cap rotation", () => {
  it("round-robins across protocol kinds under the cap instead of filling kind-by-kind", () => {
    const s = settings();
    s.maxNodesPerFormat = 7;
    const nodes = generateNodes(ctx(s));
    expect(nodes.map((n) => n.name)).toEqual([
      `VLESS ${HOST} 443 Workers-Dev`,
      `VMESS ${HOST} 443 Workers-Dev`,
      `TROJAN ${HOST} 443 Workers-Dev`,
      `SS ${HOST} 443 Workers-Dev`,
      `VLESS ${HOST} 2053 Workers-Dev`,
      `VMESS ${HOST} 2053 Workers-Dev`,
      `TROJAN ${HOST} 2053 Workers-Dev`,
    ]);
  });

  it("spreads the cap evenly across remaining kinds when one is disabled", () => {
    const s = settings();
    s.ssEnabled = false;
    s.maxNodesPerFormat = 30;
    const nodes = generateNodes(ctx(s));
    expect(nodes.length).toBe(30);
    const count = (k: ProxyNode["kind"]): number => nodes.filter((n) => n.kind === k).length;
    expect(count("vless")).toBe(10);
    expect(count("vmess")).toBe(10);
    expect(count("trojan")).toBe(10);

    const full = settings();
    full.ssEnabled = false;
    full.maxNodesPerFormat = 100;
    expect(generateNodes(ctx(full)).length).toBe(39);
  });
});

describe("generateNodes naming enrichment", () => {
  it("prefixes the country flag from request.cf", () => {
    const nodes = generateNodes(ctx(settings(), undefined, { country: "DE" }));
    expect(nodes[0]!.name.startsWith("\u{1F1E9}\u{1F1EA} ")).toBe(true);
  });

  it("keeps names flag-free without request.cf", () => {
    const nodes = generateNodes(ctx(settings()));
    expect(nodes[0]!.name).toMatch(/^VLESS /);
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

  it("names encode variant and tag tokens", () => {
    const s = settings();
    s.plainPortPolicy = "always";
    s.cleanIps = ["1.0.0.1"];
    const nodes = generateNodes(ctx(s));
    expect(nodes.find((n) => n.security === "none")!.name).toContain(" Plain Workers-Dev");
    expect(
      nodes.find((n) => n.address === "1.0.0.1" && n.security === "tls")!.name,
    ).toContain("Clean-IP");
    expect(nodes.find((n) => n.security === "tls" && n.address === HOST)!.name).toBe(
      `VLESS ${HOST} 443 Workers-Dev`,
    );
  });
});
