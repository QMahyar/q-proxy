import { describe, expect, it } from "vitest";
import { pickSubFormat } from "../../src/subscription/negotiate";

function req(url: string, ua?: string): Request {
  const headers = new Headers();
  if (ua !== undefined) headers.set("user-agent", ua);
  return new Request(url, { headers });
}

describe("pickSubFormat negotiation priority", () => {
  it("target= wins over any UA", () => {
    expect(pickSubFormat(req("https://w/sp/sub?target=clash", "Mozilla/5.0"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub?target=singbox", "clash-verge/1"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub?target=base64", "Loon/3"))).toBe("base64");
  });

  it("rejects invalid target values and falls through to UA sniffing", () => {
    expect(pickSubFormat(req("https://w/sp/sub?target=SINGBOX", "clash-verge/1"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub?target=hysteria", "v2rayNG/1.8"))).toBe("base64");
  });

  it("classifies the R4 priority table by UA", () => {
    expect(pickSubFormat(req("https://w/sp/sub", "clash-verge/v1.2.3"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub", "ClashforWindows/0.20"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub", "mihomo/1.18"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub", "SagerNet/sing-box/1.8.0"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub", "HiddifyNext/1.0"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub", "NekoBox/1.2"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub", "Surge iOS/2520"))).toBe("surge");
    expect(pickSubFormat(req("https://w/sp/sub", "Loon/3.2.4"))).toBe("loon");
    expect(pickSubFormat(req("https://w/sp/sub", "v2rayNG/1.8.14"))).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub", "ShadowRocket/88"))).toBe("base64");
  });

  it("browsers yield null for the HTML info page", () => {
    expect(pickSubFormat(req("https://w/sp/sub", "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0"))).toBeNull();
    expect(pickSubFormat(req("https://w/sp/sub", "Mozilla/5.0 Safari/605"))).toBeNull();
  });

  it("missing UA falls back to base64", () => {
    expect(pickSubFormat(req("https://w/sp/sub"))).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub", ""))).toBe("base64");
  });
});
