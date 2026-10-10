import { describe, expect, it } from "vitest";
import { ECH_SERVER_NAME_RE, resolveEchServerName } from "../../src/nodes/ech";

describe("resolveEchServerName", () => {
  it("returns nulls when ECH is disabled regardless of input", () => {
    expect(
      resolveEchServerName({ echEnabled: false, echAuto: true, echServerName: "" }, "example.com"),
    ).toEqual({ name: null, warning: null });
    expect(
      resolveEchServerName({ echEnabled: false, echAuto: false, echServerName: "cdn.example.com" }, "example.com"),
    ).toEqual({ name: null, warning: null });
  });

  it("prefers the trimmed manual name over any SNI", () => {
    expect(
      resolveEchServerName(
        { echEnabled: true, echAuto: true, echServerName: "  cdn.example.com  " },
        "other.example.net",
      ),
    ).toEqual({ name: "cdn.example.com", warning: null });
  });

  it("uses a valid hostname SNI when no manual name is set", () => {
    expect(resolveEchServerName({ echEnabled: true, echAuto: false, echServerName: "" }, "example.com")).toEqual({
      name: "example.com",
      warning: null,
    });
    expect(
      resolveEchServerName({ echEnabled: true, echAuto: true, echServerName: "   " }, "  sub.example.com  "),
    ).toEqual({ name: "sub.example.com", warning: null });
  });

  it("echoes an unusable SNI without warning when auto is off", () => {
    expect(resolveEchServerName({ echEnabled: true, echAuto: false, echServerName: "" }, "203.0.113.7")).toEqual({
      name: "203.0.113.7",
      warning: null,
    });
    expect(resolveEchServerName({ echEnabled: true, echAuto: false, echServerName: "" }, null)).toEqual({
      name: null,
      warning: null,
    });
    expect(resolveEchServerName({ echEnabled: true, echAuto: false, echServerName: "" }, "   ")).toEqual({
      name: null,
      warning: null,
    });
  });

  it("warns when auto is on but the SNI cannot serve as an ECH name", () => {
    const ip = resolveEchServerName({ echEnabled: true, echAuto: true, echServerName: "" }, "203.0.113.7");
    expect(ip.name).toBeNull();
    expect(ip.warning).toContain("ech server name is unresolvable");
    const missing = resolveEchServerName({ echEnabled: true, echAuto: true, echServerName: "" }, null);
    expect(missing).toEqual({
      name: null,
      warning: "ech server name is unresolvable: set a manual name or use a hostname SNI",
    });
  });
});

describe("ECH_SERVER_NAME_RE", () => {
  it("accepts multi-label hostnames and rejects non-names", () => {
    expect(ECH_SERVER_NAME_RE.test("example.com")).toBe(true);
    expect(ECH_SERVER_NAME_RE.test("cdn.sub.example.co")).toBe(true);
    expect(ECH_SERVER_NAME_RE.test("localhost")).toBe(false);
    expect(ECH_SERVER_NAME_RE.test("203.0.113.7")).toBe(false);
    expect(ECH_SERVER_NAME_RE.test("example.com.")).toBe(false);
    expect(ECH_SERVER_NAME_RE.test("has space.com")).toBe(false);
    expect(ECH_SERVER_NAME_RE.test("")).toBe(false);
  });
});
