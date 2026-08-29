import { describe, expect, it } from "vitest";
import { classifyUA } from "../../src/core/ua";

describe("classifyUA", () => {
  it("clash family wins over everything", () => {
    expect(classifyUA("clash-verge/v2.1.3")).toBe("clash");
    expect(classifyUA("ClashMetaForAndroid/2.11.5")).toBe("clash");
    expect(classifyUA("mihomo/1.18 linux")).toBe("clash");
    expect(classifyUA("Stash/2.7 (iPhone)")).toBe("clash");
    expect(classifyUA("ClashVerge/2.0")).toBe("clash");
  });

  it("does not match bare meta or verge tokens", () => {
    expect(classifyUA("Meta/1.0")).toBe("base64");
    expect(classifyUA("Verge/3.2")).toBe("base64");
    expect(classifyUA("clash-verge/2.0")).toBe("clash");
  });

  it("sing-box family", () => {
    expect(classifyUA("sing-box 1.9.0 (darwin)")).toBe("singbox");
    expect(classifyUA("SFA/1.10.0")).toBe("singbox");
    expect(classifyUA("HiddifyNext/2.0.5")).toBe("singbox");
    expect(classifyUA("NekoBox/1.3.2 Android")).toBe("singbox");
    expect(classifyUA("Karing/1.1")).toBe("singbox");
  });

  it("surge then loon", () => {
    expect(classifyUA("Surge iOS/2406")).toBe("surge");
    expect(classifyUA("Loon/3.2.4")).toBe("loon");
  });

  it("base64 clients", () => {
    expect(classifyUA("v2rayNG/1.8.23")).toBe("base64");
    expect(classifyUA("Shadowrocket/1956 CFNetwork/1404")).toBe("base64");
    expect(classifyUA("Happ/1.12.0")).toBe("base64");
  });

  it("browsers get html", () => {
    expect(
      classifyUA(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      ),
    ).toBe("browser");
    expect(classifyUA("Mozilla/5.0 (Windows NT 10.0; rv:127.0) Gecko/20100101 Firefox/127.0")).toBe("browser");
  });

  it("empty and unknown default to base64", () => {
    expect(classifyUA("")).toBe("base64");
    expect(classifyUA("curl/8.4.0")).toBe("base64");
  });

  it("sing-box token variants", () => {
    expect(classifyUA("SFI/1.0")).toBe("singbox");
    expect(classifyUA("SFM/2.0")).toBe("singbox");
    expect(classifyUA("SFT/1.5")).toBe("singbox");
    expect(classifyUA("singbox/1.9 dalvik")).toBe("singbox");
  });

  it("base64 client token variants", () => {
    expect(classifyUA("Streisand/1.0")).toBe("base64");
    expect(classifyUA("V2Box/3.0")).toBe("base64");
    expect(classifyUA("Foxray/2.1")).toBe("base64");
    expect(classifyUA("Husi/1.0")).toBe("base64");
    expect(classifyUA("Xray-core/1.8")).toBe("base64");
    expect(classifyUA("NapsternetV/1.0")).toBe("base64");
  });
});
