import { describe, expect, it } from "vitest";
import { pickSubFormat } from "../../src/subscription/negotiate";

function req(url: string, ua?: string): Request {
  const headers = new Headers();
  if (ua !== undefined) headers.set("user-agent", ua);
  return new Request(url, { headers });
}

describe("pickSubFormat negotiation priority", () => {
  it("target= wins over any UA", () => {
    expect(pickSubFormat(req("https://w/sp/sub?target=singbox", "Mozilla/5.0"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub?target=singbox", "clash-verge/1"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub?target=surge", "v2rayNG/1.8"))).toBe("surge");
    expect(pickSubFormat(req("https://w/sp/sub?target=quanx", "Loon/3"))).toBe("quanx");
    expect(pickSubFormat(req("https://w/sp/sub?target=loon", "Surge iOS/1"))).toBe("loon");
  });

  it("target=mixed is the base64 alias", () => {
    expect(pickSubFormat(req("https://w/sp/sub?target=mixed", "Loon/3"))).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub?target=mixed", "Mozilla/5.0"))).toBe("base64");
  });

  it("rejects invalid target values with BadRequest", () => {
    expect(() => pickSubFormat(req("https://w/sp/sub?target=SINGBOX", "clash-verge/1"))).toThrow();
    expect(() => pickSubFormat(req("https://w/sp/sub?target=hysteria", "v2rayNG/1.8"))).toThrow();
    expect(() => pickSubFormat(req("https://w/sp/sub?target=quantumult", "v2rayNG/1.8"))).toThrow();
  });

  it("?b64 forces base64 over converter UA sniffing but not over explicit target", () => {
    expect(pickSubFormat(req("https://w/sp/sub?b64", "Surge iOS/2520"))).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub?base64", "Loon/3.2.4"))).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub?b64&surge", "Surge iOS/2520"))).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub?b64&target=surge", "Surge iOS/2520"))).toBe("surge");
  });

  it("client flags beat UA sniffing but not explicit target", () => {
    expect(pickSubFormat(req("https://w/sp/sub?surge", "v2rayNG/1.8"))).toBe("surge");
    expect(pickSubFormat(req("https://w/sp/sub?quanx", "v2rayNG/1.8"))).toBe("quanx");
    expect(pickSubFormat(req("https://w/sp/sub?loon", "v2rayNG/1.8"))).toBe("loon");
    expect(pickSubFormat(req("https://w/sp/sub?clash", "Surge iOS/2520"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub?sb", "Loon/3.2.4"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub?singbox", "Loon/3.2.4"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub?xray", "Loon/3.2.4"))).toBe("xray");
    expect(pickSubFormat(req("https://w/sp/sub?surge&target=clash", "Surge iOS/2520"))).toBe("clash");
  });

  it("classifies the surviving priority table by UA", () => {
    expect(pickSubFormat(req("https://w/sp/sub", "clash-verge/v1.2.3"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub", "ClashforWindows/0.20"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub", "mihomo/1.18"))).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub", "SagerNet/sing-box/1.8.0"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub", "HiddifyNext/1.0"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub", "NekoBox/1.2"))).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub", "Surge iOS/2520"))).toBe("surge");
    expect(pickSubFormat(req("https://w/sp/sub", "Loon/3.2.4"))).toBe("loon");
    expect(pickSubFormat(req("https://w/sp/sub", "Quantumult X/1.5.4"))).toBe("quanx");
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

  it("path segment target beats UA sniffing but not query target", () => {
    expect(pickSubFormat(req("https://w/sp/sub/u/x/singbox", "Loon/3"), "singbox")).toBe("singbox");
    expect(pickSubFormat(req("https://w/sp/sub/u/x/base64", "Loon/3"), "base64")).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub/u/x/singbox", "Loon/3"), "base64")).toBe("base64");
    expect(pickSubFormat(req("https://w/sp/sub/u/x/singbox?target=base64", "Loon/3"), "singbox")).toBe("base64");
  });
  it("target=xray resolves directly and via path segment", () => {
    expect(pickSubFormat(req("https://w/sp/sub?target=xray", "Mozilla/5.0"))).toBe("xray");
    expect(pickSubFormat(req("https://w/sp/sub/u/x/xray", "v2rayNG/1.8"), "xray")).toBe("xray");
  });

  it("classifies xray-core UAs to the xray emitter", () => {
    expect(pickSubFormat(req("https://w/sp/sub", "Xray-core/1.8"))).toBe("xray");
    expect(pickSubFormat(req("https://w/sp/sub", "Foxray/2.1"))).toBe("base64");
  });

  it("ignores an invalid path target and falls through", () => {
    expect(pickSubFormat(req("https://w/sp/sub/u/x/hysteria", "clash-verge/1"), "hysteria")).toBe("clash");
    expect(pickSubFormat(req("https://w/sp/sub/u/x/hysteria"), "hysteria")).toBe("base64");
  });

  it("view=html still wins over the path target", () => {
    expect(pickSubFormat(req("https://w/sp/sub/u/x/singbox?view=html"), "singbox")).toBeNull();
  });
});
