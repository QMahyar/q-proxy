import { describe, expect, it } from "vitest";
import { jsonOk } from "../../src/core/respond";
import {
  assertCsrf,
  assertLoginAllowed,
  clearLoginFailures,
  getSession,
  recordLoginFailure,
  requireAuth,
} from "../../src/auth/guard";
import { ForbiddenError, RateLimitedError, UnauthorizedError } from "../../src/core/errors";
import { issueSession } from "../../src/auth/session";

const SECRET = "guard-secret";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/x", { headers });
}

describe("getSession", () => {
  it("parses the q_session cookie out of the Cookie header", () => {
    expect(getSession(reqWith({ Cookie: "q_session=abc.def" }))).toBe("abc.def");
    expect(getSession(reqWith({ Cookie: "other=1; q_session=tok; x=y" }))).toBe("tok");
    expect(getSession(reqWith({}))).toBeNull();
    expect(getSession(reqWith({ Cookie: "other=1" }))).toBeNull();
  });

  it("decodes url-encoded cookie values", () => {
    expect(getSession(reqWith({ Cookie: "q_session=a.b%21" }))).toBe("a.b!");
  });
});

describe("assertCsrf", () => {
  it("requires the X-Q-Panel marker header", async () => {
    expect(assertCsrf(reqWith({ "X-Q-Panel": "1" }))).toBeUndefined();
    try {
      assertCsrf(reqWith({}));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ForbiddenError).toBe(true);
    }
    try {
      assertCsrf(reqWith({ "X-Q-Panel": "0" }));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ForbiddenError).toBe(true);
    }
  });
});

describe("requireAuth", () => {
  const inner = async (): Promise<Response> => jsonOk({ ok: true });

  it("passes valid sessions through to the handler", async () => {
    const token = await issueSession(SECRET);
    const handler = requireAuth(inner);
    const res = await handler(
      reqWith({ Cookie: `q_session=${token}` }),
      {} as never,
      { sessionSecret: SECRET } as never,
    );
    expect(res.status).toBe(200);
  });

  it("throws UnauthorizedError for missing or invalid sessions", async () => {
    const handler = requireAuth(inner);
    const settings = { sessionSecret: SECRET } as never;
    await expect(handler(reqWith({}), {} as never, settings)).rejects.toThrow(UnauthorizedError);
    const token = await issueSession("different-secret");
    await expect(
      handler(reqWith({ Cookie: `q_session=${token}` }), {} as never, settings),
    ).rejects.toThrow(UnauthorizedError);
  });
});

describe("login rate limiter", () => {
  it("locks an ip after five failures inside the window", () => {
    const ip = "203.0.113.9";
    clearLoginFailures(ip);
    assertLoginAllowed(ip);
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    expect(() => assertLoginAllowed(ip)).toThrow(RateLimitedError);
  });

  it("allows attempts below the threshold and after clearing", () => {
    const ip = "203.0.113.10";
    clearLoginFailures(ip);
    recordLoginFailure(ip);
    recordLoginFailure(ip);
    expect(() => assertLoginAllowed(ip)).not.toThrow();
    clearLoginFailures(ip);
    expect(() => assertLoginAllowed(ip)).not.toThrow();
  });

  it("tracks ips independently", () => {
    const hot = "203.0.113.11";
    const cold = "203.0.113.12";
    clearLoginFailures(hot);
    clearLoginFailures(cold);
    for (let i = 0; i < 6; i++) recordLoginFailure(hot);
    expect(() => assertLoginAllowed(hot)).toThrow(RateLimitedError);
    expect(() => assertLoginAllowed(cold)).not.toThrow();
  });
});
