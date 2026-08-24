import { describe, expect, it } from "vitest";
import { FRAGMENT_PRESETS, SMART_SWEEP_LENGTHS, fragmentQuery } from "../../src/nodes/fragments";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { countryFlag, renderName } from "../../src/nodes/naming";
import type { SSNode, TrojanNode, VlessNode } from "../../src/types/node";

describe("fragment presets", () => {
  it("matches the R1 B.3 preset table", () => {
    expect(FRAGMENT_PRESETS.low).toEqual({ lengthMin: 100, lengthMax: 200, delayMin: 1, delayMax: 1 });
    expect(FRAGMENT_PRESETS.medium).toEqual({ lengthMin: 50, lengthMax: 100, delayMin: 1, delayMax: 5 });
    expect(FRAGMENT_PRESETS.high).toEqual({ lengthMin: 10, lengthMax: 20, delayMin: 10, delayMax: 20 });
    expect(FRAGMENT_PRESETS.severe).toEqual({ lengthMin: 1, lengthMax: 5, delayMin: 1, delayMax: 5 });
  });

  it("provides a twenty-entry smart-sweep length list spanning 1-5 to 180-200", () => {
    expect(SMART_SWEEP_LENGTHS.length).toBe(20);
    expect(SMART_SWEEP_LENGTHS[0]).toBe("1-5");
    expect(SMART_SWEEP_LENGTHS[SMART_SWEEP_LENGTHS.length - 1]).toBe("180-200");
  });

  it("builds the fragment path marker per mode", () => {
    const base = { ...DEFAULT_SETTINGS.fragment };
    expect(fragmentQuery({ ...base, mode: "off" })).toBe("");
    expect(fragmentQuery({ ...base, mode: "low" })).toBe("frag=low");
    expect(fragmentQuery({ ...base, mode: "severe" })).toBe("frag=severe");
    const custom = fragmentQuery({
      ...base,
      mode: "custom",
      packets: "1-2",
      lengthMin: 10,
      lengthMax: 30,
      delayMin: 2,
      delayMax: 6,
      maxSplitMin: 1,
      maxSplitMax: 3,
    });
    expect(custom).toBe("frag=custom&fpackets=1-2&flen=10-30&fdelay=2-6&fsplit=1-3");
  });
});

function vless(): VlessNode {
  return {
    kind: "vless",
    name: "",
    address: "worker.test",
    port: 443,
    security: "tls",
    sni: "worker.test",
    host: "worker.test",
    path: "/vl/abcd1234",
    earlyData: 0,
    fingerprint: "chrome",
    alpn: [],
    variant: "normal",
    tags: [],
    uuid: "u",
  };
}

describe("naming", () => {
  it("renders PROTO ADDR PORT with optional tokens", () => {
    expect(renderName(vless())).toBe("VLESS worker.test 443");
    const plain: VlessNode = { ...vless(), port: 80, security: "none", tags: ["workers-dev"] };
    expect(renderName(plain)).toContain(" 80 Plain Workers-Dev");
    const frag: VlessNode = { ...vless(), variant: "fragment", tags: ["fragment"] };
    expect(renderName(frag)).toContain(" 443 Frag");
    const clean: VlessNode = { ...vless(), address: "1.0.0.1", tags: ["clean-ip"] };
    expect(renderName(clean)).toBe("VLESS 1.0.0.1 443 Clean-IP");
  });

  it("brackets ipv6 addresses in names", () => {
    expect(renderName({ ...vless(), address: "2001:db8::1" })).toBe("VLESS [2001:db8::1] 443");
  });

  it("renders trojan and ss protocol labels", () => {
    const trojan: TrojanNode = { ...vless(), kind: "trojan", password: "p" };
    expect(renderName(trojan).startsWith("TROJAN ")).toBe(true);
    const ss: SSNode = { ...vless(), kind: "ss", method: "aes-128-gcm", password: "p" };
    expect(renderName(ss).startsWith("SS ")).toBe(true);
  });

  it("converts cf country codes to flag emoji and rejects junk", () => {
    expect(countryFlag("DE")).toBe("\u{1F1E9}\u{1F1EA}");
    expect(countryFlag("us")).toBe("\u{1F1FA}\u{1F1F8}");
    expect(countryFlag("")).toBe("");
    expect(countryFlag("D")).toBe("");
    expect(countryFlag("XYZ")).toBe("");
    expect(countryFlag(null)).toBe("");
  });
});
