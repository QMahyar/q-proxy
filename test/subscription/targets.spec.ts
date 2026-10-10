import { describe, expect, it } from "vitest";
import { readCnIspCode, resolveTarget } from "../../src/subscription/targets";

describe("resolveTarget", () => {
  it("resolves explicit targets and flags converter formats", () => {
    expect(resolveTarget(new URL("https://w/sp/sub?target=surge"), "v2rayNG/1")).toEqual({
      target: "surge",
      isConverter: true,
    });
    expect(resolveTarget(new URL("https://w/sp/sub?target=quanx"), "v2rayNG/1")).toEqual({
      target: "quanx",
      isConverter: true,
    });
    expect(resolveTarget(new URL("https://w/sp/sub?target=loon"), "v2rayNG/1")).toEqual({
      target: "loon",
      isConverter: true,
    });
    expect(resolveTarget(new URL("https://w/sp/sub?target=mixed"), "Surge iOS/1")).toEqual({
      target: "base64",
      isConverter: false,
    });
    expect(resolveTarget(new URL("https://w/sp/sub?target=clash"), "Surge iOS/1")).toEqual({
      target: "clash",
      isConverter: false,
    });
  });

  it("sniffs converter UAs and honors flags", () => {
    expect(resolveTarget(new URL("https://w/sp/sub"), "Surge iOS/2520").target).toBe("surge");
    expect(resolveTarget(new URL("https://w/sp/sub?loon"), "v2rayNG/1")).toEqual({
      target: "loon",
      isConverter: true,
    });
  });

  it("returns null for browser info pages", () => {
    expect(
      resolveTarget(new URL("https://w/sp/sub"), "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0"),
    ).toEqual({ target: null, isConverter: false });
  });
});

describe("readCnIspCode", () => {
  it("passes through short token values", () => {
    expect(readCnIspCode(new URL("https://w/sp/sub?target=surge&cnIspCode=ct"))).toBe("ct");
    expect(readCnIspCode(new URL("https://w/sp/sub?cnIspCode=cmcc"))).toBe("cmcc");
  });

  it("returns null when absent, empty, or malformed", () => {
    expect(readCnIspCode(new URL("https://w/sp/sub"))).toBeNull();
    expect(readCnIspCode(new URL("https://w/sp/sub?cnIspCode="))).toBeNull();
    expect(readCnIspCode(new URL("https://w/sp/sub?cnIspCode=has%20space"))).toBeNull();
    expect(readCnIspCode(new URL(`https://w/sp/sub?cnIspCode=${"x".repeat(64)}`))).toBeNull();
  });

  it("never throws", () => {
    expect(() => readCnIspCode(new URL("https://w/sp/sub?cnIspCode=%FF"))).not.toThrow();
  });
});
