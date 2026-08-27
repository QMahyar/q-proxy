import { describe, expect, it } from "vitest";
import { identifyTunnel, resolveHostname, resolveSecureRoute, splitPath } from "../../src/core/routes";
import { makeTestSettings } from "../helpers/settings";

const s = makeTestSettings();

describe("splitPath", () => {
  it("splits and drops empties", () => {
    expect(splitPath("/a/b/c")).toEqual(["a", "b", "c"]);
    expect(splitPath("/")).toEqual([]);
    expect(splitPath("")).toEqual([]);
    expect(splitPath("/a//b/")).toEqual(["a", "b"]);
  });
});

describe("identifyTunnel", () => {
  it("matches configured prefixes with valid suffix", () => {
    expect(identifyTunnel("/vl/abcdefgh", s)).toBe("vless");
    expect(identifyTunnel("/vm/abcdefgh12345678", s)).toBe("vmess");
    expect(identifyTunnel("/tr/ABCDEFGH", s)).toBe("trojan");
    expect(identifyTunnel("/ss/sssuffix12", s)).toBe("ss");
  });

  it("requires suffix of 8-32 alnum chars", () => {
    expect(identifyTunnel("/vl/short", s)).toBeNull();
    expect(identifyTunnel("/vl/12345678", s)).not.toBeNull();
    for (let i = 0; i < 40; i++) {
      const suffix = "a".repeat(i);
      const ok = i >= 8 && i <= 32;
      expect(identifyTunnel(`/vl/${suffix}`, s) !== null).toBe(ok);
    }
    expect(identifyTunnel("/vl/has-dash!!", s)).toBeNull();
    expect(identifyTunnel("/vl/", s)).toBeNull();
  });

  it("rejects wrong prefix or extra segments", () => {
    expect(identifyTunnel("/nope/abcdefgh", s)).toBeNull();
    expect(identifyTunnel("/vl/abcdefgh/extra", s)).toBeNull();
    expect(identifyTunnel("/vl", s)).toBeNull();
  });

  it("is case-sensitive on prefix and case-tolerant on suffix", () => {
    expect(identifyTunnel("/VL/abcdefgh", s)).toBeNull();
    expect(identifyTunnel("/vl/ABCDEFgh", s)).toBe("vless");
  });
});

describe("resolveSecureRoute", () => {
  it("returns null when securePath unset", () => {
    const noSp = makeTestSettings({ securePath: "" });
    expect(resolveSecureRoute(new URL("https://x.com/anything"), noSp)).toBeNull();
  });

  it("root exact match only", () => {
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1"), s)).toEqual({ kind: "root" });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/"), s)).toEqual({ kind: "root" });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/x"), s)).toBeNull();
  });

  it("pages and endpoints", () => {
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/panel"), s)).toEqual({ kind: "page", page: "panel" });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/login"), s)).toEqual({ kind: "page", page: "login" });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/sub"), s)).toEqual({ kind: "sub" });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/doh"), s)).toEqual({ kind: "doh" });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/my-ip"), s)).toEqual({ kind: "myip" });
  });

  it("api routes incl nested settings paths", () => {
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/api/settings"), s)).toEqual({
      kind: "api",
      api: "settings-get",
    });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/api/settings/save"), s)).toEqual({
      kind: "api",
      api: "settings-save",
    });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/api/settings/reset"), s)).toEqual({
      kind: "api",
      api: "settings-reset",
    });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/api/status"), s)).toEqual({ kind: "api", api: "status" });
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/api/nope"), s)).toBeNull();
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/api"), s)).toBeNull();
  });

  it("rejects other secure prefixes", () => {
    expect(resolveSecureRoute(new URL("https://x.com/wrongpath/sub"), s)).toBeNull();
  });

  it("sub accepts query params", () => {
    expect(resolveSecureRoute(new URL("https://x.com/mysecret1/sub?target=clash"), s)).toEqual({ kind: "sub" });
  });
});

describe("resolveHostname", () => {
  it("prefers override then custom domain then request host", () => {
    const url = new URL("https://worker.example.com/sub");
    expect(resolveHostname(makeTestSettings({ hostnameOverride: "override.io" }), url)).toBe("override.io");
    expect(
      resolveHostname(makeTestSettings({ customDomains: ["custom.one", "custom.two"] }), url),
    ).toBe("custom.one");
    expect(resolveHostname(makeTestSettings(), url)).toBe("worker.example.com");
  });
});

const UUID = "12345678-1234-4234-8234-123456789abc";
const HEX16 = "0123456789abcdef";

function routeAt(path: string): ReturnType<typeof resolveSecureRoute> {
  return resolveSecureRoute(new URL(`https://x.com/mysecret1${path}`), s);
}

describe("resolveSecureRoute full matrix", () => {
  it.each([
    ["/panel", { kind: "page", page: "panel" }],
    ["/login", { kind: "page", page: "login" }],
    ["/sub", { kind: "sub" }],
    [`/sub/wg/${UUID}/throne`, { kind: "warp-sub" }],
    [`/sub/u/${UUID}`, { kind: "user-sub" }],
    [`/sub/u/${UUID}/clash`, { kind: "user-sub" }],
    ["/doh", { kind: "doh" }],
    ["/my-ip", { kind: "myip" }],
    ["/telegram/setup", { kind: "api", api: "telegram-setup" }],
    ["/telegram/remove", { kind: "api", api: "telegram-remove" }],
    [`/telegram/webhook/${HEX16}`, { kind: "api", api: "telegram-webhook" }],
    ["/api/status", { kind: "api", api: "status" }],
    ["/api/bootstrap", { kind: "api", api: "bootstrap" }],
    ["/api/killswitch", { kind: "api", api: "killswitch" }],
    ["/api/suburls", { kind: "api", api: "suburls" }],
    ["/api/warp", { kind: "api", api: "warp" }],
    ["/api/warp/account", { kind: "api", api: "warp" }],
    ["/api/warp/account/x/regenerate-token", { kind: "api", api: "warp" }],
    ["/api/users", { kind: "api", api: "users" }],
    [`/api/users/${UUID}`, { kind: "api", api: "users" }],
    [`/api/users/${UUID}/regenerate-token`, { kind: "api", api: "users" }],
    ["/api/version/check", { kind: "api", api: "version-check" }],
    ["/api/settings", { kind: "api", api: "settings-get" }],
    ["/api/settings/save", { kind: "api", api: "settings-save" }],
    ["/api/settings/reset", { kind: "api", api: "settings-reset" }],
    ["/api/settings/export", { kind: "api", api: "settings-export" }],
    ["/api/settings/import", { kind: "api", api: "settings-import" }],
  ])("maps %s to %j", (path, expected) => {
    expect(routeAt(path)).toEqual(expected);
  });

  it.each([
    "/panel/extra",
    "/login/extra",
    "/sub/extra",
    "/doh/extra",
    "/my-ip/extra",
    `/sub/wg/not-a-uuid/throne`,
    `/sub/wg/${UUID}`,
    `/sub/u/not-a-uuid`,
    `/sub/u/${UUID}/clash/extra`,
    `/sub/u/${UUID}/a/b/c`,
    "/sub/wg",
    "/telegram",
    "/telegram/other",
    "/telegram/webhook",
    "/telegram/webhook/tooshort",
    `/telegram/webhook/${HEX16}/extra`,
    "/telegram/setup/extra",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/setup",
    "/api/auth/password",
    "/api/auth/login/extra",
    "/api/auth/unknown",
    "/api/status/extra",
    "/api/bootstrap/extra",
    "/api/killswitch/extra",
    "/api/suburls/extra",
    "/api/version",
    "/api/version/check/extra",
    "/api/settings/save/extra",
    "/api/settings/unknown",
    "/api/nope",
  ])("rejects %s by segment count or shape", (path) => {
    expect(routeAt(path)).toBeNull();
  });
});
