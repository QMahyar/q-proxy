import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonOk } from "../../src/core/respond";
import {
  LOGIN_FAIL_PREFIX,
  LOGIN_FAIL_TTL_SECONDS,
  assertCsrf,
  assertLoginAllowed,
  clearLoginFailures,
  clearLoginThrottle,
  getSession,
  hashLoginIp,
  isIpAllowlisted,
  loginFailKey,
  loginFailWindow,
  recordLoginFailure,
  requireAuth,
} from "../../src/auth/guard";
import type { Env } from "../../src/types/env";
import { ForbiddenError, RateLimitedError, UnauthorizedError } from "../../src/core/errors";
import { clearSessionFloorCache, issueSession } from "../../src/auth/session";

const SECRET = "guard-secret";

function stubEnv(): { QPROXY_KV: { get(key: string): Promise<unknown> } } {
  return { QPROXY_KV: { get: async () => null } };
}

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

  it("takes the first q_session occurrence and tolerates malformed escapes", () => {
    expect(getSession(reqWith({ Cookie: "q_session=first; q_session=second" }))).toBe("first");
    expect(getSession(reqWith({ Cookie: "; q_session=leading" }))).toBe("leading");
    expect(getSession(reqWith({ Cookie: "q_session=bad%zzescape" }))).toBe("bad%zzescape");
  });

  it("returns null for an empty cookie value", () => {
    expect(getSession(reqWith({ Cookie: "q_session=" }))).toBeNull();
    expect(getSession(reqWith({ Cookie: "q_session=; other=1" }))).toBeNull();
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
      stubEnv() as never,
      { sessionSecret: SECRET } as never,
    );
    expect(res.status).toBe(200);
  });

  it("throws UnauthorizedError for missing or invalid sessions", async () => {
    const handler = requireAuth(inner);
    const settings = { sessionSecret: SECRET } as never;
    await expect(handler(reqWith({}), stubEnv() as never, settings)).rejects.toThrow(UnauthorizedError);
    const token = await issueSession("different-secret");
    await expect(
      handler(reqWith({ Cookie: `q_session=${token}` }), stubEnv() as never, settings),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("fails closed when the session floor cannot be read", async () => {
    clearSessionFloorCache();
    const token = await issueSession(SECRET);
    const handler = requireAuth(inner);
    const broken = { QPROXY_KV: { get: async () => { throw new Error("kv down"); } } };
    await expect(
      handler(reqWith({ Cookie: `q_session=${token}` }), broken as never, { sessionSecret: SECRET } as never),
    ).rejects.toThrow(UnauthorizedError);
  });
});

describe("login rate limiter", () => {
  interface ThrottlePut {
    key: string;
    value: string;
    options: { expirationTtl?: number } | undefined;
  }

  function mockThrottle() {
    const store = new Map<string, string>();
    const puts: ThrottlePut[] = [];
    let getFails = false;
    let putFails = false;
    const kv = {
      async get(key: string): Promise<string | null> {
        if (getFails) throw new Error("kv down");
        return store.get(key) ?? null;
      },
      async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
        puts.push({ key, value, options });
        if (putFails) throw new Error("kv put down");
        store.set(key, value);
      },
      async delete(key: string): Promise<void> {
        store.delete(key);
      },
      async list(opts: { prefix: string }): Promise<{ keys: Array<{ name: string }> }> {
        return { keys: [...store.keys()].filter((k) => k.startsWith(opts.prefix)).map((name) => ({ name })) };
      },
    };
    const api = {
      store,
      puts,
      env: { QPROXY_KV: kv } as unknown as Env,
      failReads(): void {
        getFails = true;
      },
      failWrites(): void {
        putFails = true;
      },
    };
    return api;
  }

  async function rateLimitedBy(env: Env, ip: string): Promise<RateLimitedError> {
    try {
      await assertLoginAllowed(env, ip);
    } catch (err) {
      return err as RateLimitedError;
    }
    throw new Error("expected RateLimitedError");
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("locks an ip after five failures inside the window", async () => {
    const t = mockThrottle();
    const ip = "203.0.113.9";
    clearLoginFailures(ip);
    await clearLoginThrottle(t.env, ip);
    await assertLoginAllowed(t.env, ip);
    for (let i = 0; i < 5; i++) await recordLoginFailure(t.env, ip);
    const err = await rateLimitedBy(t.env, ip);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.status).toBe(429);
    expect(Number(err.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    await clearLoginThrottle(t.env, ip);
  });

  it("allows attempts below the threshold and after clearing", async () => {
    const t = mockThrottle();
    const ip = "203.0.113.10";
    clearLoginFailures(ip);
    await clearLoginThrottle(t.env, ip);
    await recordLoginFailure(t.env, ip);
    await recordLoginFailure(t.env, ip);
    await expect(assertLoginAllowed(t.env, ip)).resolves.toBeUndefined();
    await clearLoginThrottle(t.env, ip);
    await expect(assertLoginAllowed(t.env, ip)).resolves.toBeUndefined();
  });

  it("tracks ips independently", async () => {
    const t = mockThrottle();
    const hot = "203.0.113.11";
    const cold = "203.0.113.12";
    clearLoginFailures(hot);
    clearLoginFailures(cold);
    await clearLoginThrottle(t.env, hot);
    await clearLoginThrottle(t.env, cold);
    for (let i = 0; i < 6; i++) await recordLoginFailure(t.env, hot);
    await expect(assertLoginAllowed(t.env, hot)).rejects.toThrow(RateLimitedError);
    await expect(assertLoginAllowed(t.env, cold)).resolves.toBeUndefined();
    await clearLoginThrottle(t.env, hot);
  });

  it("persists counts in KV across isolate restarts", async () => {
    const t = mockThrottle();
    const ip = "203.0.113.21";
    await clearLoginThrottle(t.env, ip);
    for (let i = 0; i < 5; i++) await recordLoginFailure(t.env, ip);
    await expect(assertLoginAllowed(t.env, ip)).rejects.toThrow(RateLimitedError);
    clearLoginFailures(ip);
    await expect(assertLoginAllowed(t.env, ip)).rejects.toThrow(RateLimitedError);
    await clearLoginThrottle(t.env, ip);
    await expect(assertLoginAllowed(t.env, ip)).resolves.toBeUndefined();
  });

  it("resets after the minute window rolls over", async () => {
    const t = mockThrottle();
    const ip = "203.0.113.22";
    await clearLoginThrottle(t.env, ip);
    const start = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => start);
    try {
      for (let i = 0; i < 5; i++) await recordLoginFailure(t.env, ip);
      await expect(assertLoginAllowed(t.env, ip)).rejects.toThrow(RateLimitedError);
      nowSpy.mockImplementation(() => start + 61_000);
      await expect(assertLoginAllowed(t.env, ip)).resolves.toBeUndefined();
      await recordLoginFailure(t.env, ip);
      await expect(assertLoginAllowed(t.env, ip)).resolves.toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
    await clearLoginThrottle(t.env, ip);
  });

  it("writes hashed keys with a 120s TTL and never stores raw ips", async () => {
    const t = mockThrottle();
    const ip = "203.0.113.23";
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      await clearLoginThrottle(t.env, ip);
      t.puts.length = 0;
      await recordLoginFailure(t.env, ip);
      expect(t.puts.length).toBe(1);
      const hash = await hashLoginIp(ip);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(t.puts[0]!.key).toBe(loginFailKey(hash, loginFailWindow(now)));
      expect(t.puts[0]!.key.startsWith(LOGIN_FAIL_PREFIX)).toBe(true);
      expect(t.puts[0]!.key).not.toContain(ip);
      expect(t.puts[0]!.value).toBe("1");
      expect(t.puts[0]!.options).toMatchObject({ expirationTtl: LOGIN_FAIL_TTL_SECONDS });
      await recordLoginFailure(t.env, ip);
      expect(t.puts[1]!.key).toBe(t.puts[0]!.key);
      expect(t.puts[1]!.value).toBe("2");
    } finally {
      nowSpy.mockRestore();
    }
    await clearLoginThrottle(t.env, ip);
  });

  it("clears KV counters so a later login starts fresh", async () => {
    const t = mockThrottle();
    const ip = "203.0.113.24";
    await clearLoginThrottle(t.env, ip);
    for (let i = 0; i < 5; i++) await recordLoginFailure(t.env, ip);
    expect([...t.store.keys()].some((k) => k.startsWith(LOGIN_FAIL_PREFIX))).toBe(true);
    await clearLoginThrottle(t.env, ip);
    expect([...t.store.keys()].some((k) => k.startsWith(LOGIN_FAIL_PREFIX))).toBe(false);
    await expect(assertLoginAllowed(t.env, ip)).resolves.toBeUndefined();
  });

  it("fails open when KV reads fail and survives KV write failures", async () => {
    const t = mockThrottle();
    const ip = "203.0.113.25";
    clearLoginFailures(ip);
    await clearLoginThrottle(t.env, ip);
    t.failReads();
    await expect(assertLoginAllowed(t.env, ip)).resolves.toBeUndefined();
    await expect(recordLoginFailure(t.env, ip)).resolves.toBeUndefined();
    const w = mockThrottle();
    const wip = "203.0.113.26";
    clearLoginFailures(wip);
    w.failWrites();
    await expect(recordLoginFailure(w.env, wip)).resolves.toBeUndefined();
    await expect(assertLoginAllowed(w.env, wip)).resolves.toBeUndefined();
    clearLoginFailures(ip);
    clearLoginFailures(wip);
  });
});

describe("ip allowlist matcher", () => {
  it("allows every ip when the list is empty", () => {
    expect(isIpAllowlisted("1.2.3.4", [])).toBe(true);
    expect(isIpAllowlisted("2001:db8::1", [])).toBe(true);
    expect(isIpAllowlisted("unknown", [])).toBe(true);
  });

  it("matches exact ipv4 and ipv6 addresses", () => {
    expect(isIpAllowlisted("1.2.3.4", ["1.2.3.4"])).toBe(true);
    expect(isIpAllowlisted("1.2.3.5", ["1.2.3.4"])).toBe(false);
    expect(isIpAllowlisted("2001:db8::1", ["2001:db8::1"])).toBe(true);
    expect(isIpAllowlisted("2001:db8::2", ["2001:db8::1"])).toBe(false);
  });

  it("matches cidr ranges without crossing address families", () => {
    expect(isIpAllowlisted("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(isIpAllowlisted("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
    expect(isIpAllowlisted("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(isIpAllowlisted("2001:db9::1", ["2001:db8::/32"])).toBe(false);
    expect(isIpAllowlisted("1.2.3.4", ["::/0"])).toBe(false);
    expect(isIpAllowlisted("2001:db8::1", ["0.0.0.0/0"])).toBe(false);
  });

  it("compares case-insensitively and tolerates brackets", () => {
    expect(isIpAllowlisted("2001:DB8::1", ["[2001:db8::1]"])).toBe(true);
    expect(isIpAllowlisted(" 1.2.3.4 ", ["1.2.3.4"])).toBe(true);
  });

  it("fails closed on malformed entries instead of matching them", () => {
    expect(isIpAllowlisted("1.2.3.4", ["example.com"])).toBe(false);
    expect(isIpAllowlisted("1.2.3.4", ["1.2.3.4/"])).toBe(false);
    expect(isIpAllowlisted("1.2.3.4", ["1.2.3.4/abc"])).toBe(false);
    expect(isIpAllowlisted("9.9.9.9", ["10.0.0.0/8", "garbage"])).toBe(false);
    expect(isIpAllowlisted("unknown", ["203.0.113.0/24"])).toBe(false);
  });
});

describe("requireAuth ip allowlist", () => {
  const inner = async (): Promise<Response> => jsonOk({ ok: true });

  function authedReq(ip: string, token: string): Request {
    return reqWith({ Cookie: `q_session=${token}`, "CF-Connecting-IP": ip });
  }

  it("passes listed client ips through to the handler", async () => {
    const token = await issueSession(SECRET);
    const handler = requireAuth(inner);
    const settings = { sessionSecret: SECRET, allowedIps: ["203.0.113.0/24"] } as never;
    const res = await handler(authedReq("203.0.113.9", token), stubEnv() as never, settings);
    expect(res.status).toBe(200);
  });

  it("rejects non-listed client ips with 403", async () => {
    const token = await issueSession(SECRET);
    const handler = requireAuth(inner);
    const settings = { sessionSecret: SECRET, allowedIps: ["203.0.113.0/24"] } as never;
    try {
      await handler(authedReq("198.51.100.7", token), stubEnv() as never, settings);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ForbiddenError).toBe(true);
      expect((err as ForbiddenError).status).toBe(403);
    }
  });

  it("allows every client ip when the list is empty", async () => {
    const token = await issueSession(SECRET);
    const handler = requireAuth(inner);
    const settings = { sessionSecret: SECRET, allowedIps: [] } as never;
    const res = await handler(authedReq("198.51.100.7", token), stubEnv() as never, settings);
    expect(res.status).toBe(200);
  });

  it("still rejects missing sessions with 401 before the allowlist check", async () => {
    const handler = requireAuth(inner);
    const settings = { sessionSecret: SECRET, allowedIps: ["203.0.113.0/24"] } as never;
    await expect(
      handler(reqWith({ "CF-Connecting-IP": "203.0.113.9" }), stubEnv() as never, settings),
    ).rejects.toThrow(UnauthorizedError);
  });
});
