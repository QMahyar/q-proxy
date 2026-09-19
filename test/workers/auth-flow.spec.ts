import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { SETTINGS_KEY, resetThrottle, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "flowpath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "correct-horse-42";

async function body(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

function post(json: unknown, extra: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(json),
  };
}

async function clearBootstrapFlag(): Promise<void> {
  const raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { updatedAt?: number; data: Record<string, unknown> };
  raw.data.passwordIsBootstrap = false;
  raw.updatedAt = Date.now();
  await kv.put(SETTINGS_KEY, JSON.stringify(raw));
  invalidateSettingsCache();
}

describe("panel auth lifecycle", () => {
  it("answers auth-status with hasSession=false when logged out and true with a valid session", async () => {
    await seed(kv, SP);

    let res = await SELF.fetch(`${BASE}/api/auth/status`);
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasSession: false });

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe("SETUP_REQUIRED");

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    const cookie = setCookie.split(";")[0]!;

    res = await SELF.fetch(`${BASE}/api/auth/status`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasSession: true });

    res = await SELF.fetch(`${BASE}/api/auth/status`, { headers: { Cookie: "q_session=bogus.sig" } });
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasSession: false });
  });

  it("walks setup -> login -> settings -> validation -> killswitch -> suburls -> logout -> lockout", async () => {
    await seed(kv, SP);

    let res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe("SETUP_REQUIRED");

    res = await SELF.fetch(`${BASE}/api/settings`);
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe("UNAUTHORIZED");

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: "short" }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(422);
    expect((await body(res)).fields.newPassword).toBeTruthy();

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    const setupBody = await body(res);
    expect(setupBody.ok).toBe(true);
    expect(setupBody.data.hasPassword).toBe(true);
    await clearBootstrapFlag();
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("q_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=604800");
    const cookie = setCookie.split(";")[0]!;

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: "another-pass-99" }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe("ALREADY_SET");

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const view = (await body(res)).data;
    expect(view.hasPassword).toBe(true);
    expect(view.securePath).toBe(SP);
    expect(view.passwordHash).toBeUndefined();
    expect(view.passwordSalt).toBeUndefined();
    expect(view.language).toBe(DEFAULT_SETTINGS.language);

    res = await SELF.fetch(
      `${BASE}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ profileTitle: "Renamed Panel" }),
      },
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe("FORBIDDEN");

    const csrfHeaders = { Cookie: cookie, "X-Q-Panel": "1" };
    res = await SELF.fetch(
      `${BASE}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...csrfHeaders },
        body: JSON.stringify({ profileTitle: "Renamed Panel" }),
      },
    );
    expect(res.status).toBe(200);
    expect((await body(res)).data.saved).toBe(true);

    res = await SELF.fetch(`${BASE}/api/settings/save`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ profileTitle: "Alias Save" }),
    });
    expect(res.status).toBe(200);
    expect((await body(res)).data.saved).toBe(true);

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    expect((await body(res)).data.profileTitle).toBe("Alias Save");

    res = await SELF.fetch(
      `${BASE}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...csrfHeaders },
        body: JSON.stringify({ fragment: { lengthMin: 900, lengthMax: 10 } }),
      },
    );
    expect(res.status).toBe(422);
    const validationBody = await body(res);
    expect(validationBody.error.code).toBe("VALIDATION");
    expect(validationBody.fields["fragment.lengthMin"]).toBeTruthy();

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: true }, csrfHeaders));
    expect(res.status).toBe(200);
    expect((await body(res)).data.killSwitch).toBe(true);

    res = await SELF.fetch(`https://example.com/vl/abcd1234efgh`, {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
      },
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("text/plain");

    res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const status = (await body(res)).data;
    expect(status.killSwitch).toBe(true);
    expect(typeof status.version).toBe("string");
    expect(status.hasPassword).toBe(true);
    expect(typeof status.usage.requestsToday).toBe("number");
    expect(typeof status.usage.requestsTotal).toBe("number");

    res = await SELF.fetch(`${BASE}/api/suburls`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const urls = (await body(res)).data.urls as Array<{
      format: string;
      label: string;
      url: string;
    }>;
    expect(urls.length).toBe(4);
    expect(urls.map((u) => u.format)).toEqual([
      "base64",
      "singbox",
      "clash",
      "base64",
    ]);
    expect(urls[0]!.url).toBe(`https://example.com/${SP}/sub`);
    expect(urls[1]!.url).toContain("?target=singbox");
    expect(urls[2]!.url).toContain("?target=clash");
    expect(urls.find((u) => u.label === "Panel info")!.url).toContain("?view=html");

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }, csrfHeaders));
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { "X-Q-Panel": "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

    res = await SELF.fetch(`${BASE}/api/settings`);
    expect(res.status).toBe(401);
  });

  it("revokes the presented session server-side on logout", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;

    res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: { "X-Q-Panel": "1", Cookie: cookie },
    });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(401);
  });

  it("does not revoke sessions when logout is called without a valid cookie", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;

    res = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { "X-Q-Panel": "1" } });
    expect(res.status).toBe(200);
    res = await SELF.fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: { "X-Q-Panel": "1", Cookie: "q_session=forged.value" },
    });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  it("rate limits repeated failed logins", async () => {
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();

    let saw429 = false;
    for (let i = 0; i < 9; i++) {
      res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: `wrong-${i}` }));
      if (res.status === 429) {
        saw429 = true;
        break;
      }
      expect([401]).toContain(res.status);
    }
    expect(saw429).toBe(true);
  });
});

describe("change password", () => {
  const NEW_PASSWORD = "brand-new-pass-77";

  it("rejects unauthenticated, csrf-less and wrong-current attempts", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;

    res = await SELF.fetch(
      `${BASE}/api/auth/password`,
      post({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(401);

    res = await SELF.fetch(
      `${BASE}/api/auth/password`,
      post({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { Cookie: cookie }),
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe("FORBIDDEN");

    res = await SELF.fetch(
      `${BASE}/api/auth/password`,
      post(
        { currentPassword: "not-the-password", newPassword: NEW_PASSWORD },
        { Cookie: cookie, "X-Q-Panel": "1" },
      ),
    );
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe("UNAUTHORIZED");

    res = await SELF.fetch(
      `${BASE}/api/auth/password`,
      post({ currentPassword: PASSWORD, newPassword: "short" }, { Cookie: cookie, "X-Q-Panel": "1" }),
    );
    expect(res.status).toBe(422);
    expect((await body(res)).fields.newPassword).toBeTruthy();
  });

  it("rotates the password, kills old sessions and issues a fresh cookie", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    const setupCookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    await new Promise((resolve) => setTimeout(resolve, 1100));

    res = await SELF.fetch(
      `${BASE}/api/auth/password`,
      post(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        { Cookie: setupCookie, "X-Q-Panel": "1" },
      ),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).data.changed).toBe(true);
    const freshCookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    expect(freshCookie).toContain("q_session=");
    expect(freshCookie).not.toBe(setupCookie);

    res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: setupCookie } });
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: freshCookie } });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: NEW_PASSWORD }));
    expect(res.status).toBe(200);
  });
});

describe("legacy hash upgrade", () => {
  const PEPPER = "ab".repeat(64);

  it("upgrades an unpeppered hash to peppered on login and re-logs in on the peppered path", async () => {
    resetThrottle();
    const { hashPassword, verifyPassword } = await import("../../src/auth/password");
    const legacy = await hashPassword(PASSWORD);
    await seed(kv, SP, {
      sessionSecret: PEPPER,
      passwordHash: legacy.hash,
      passwordSalt: legacy.salt,
    });

    let res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(200);
    expect((res.headers.get("Set-Cookie") ?? "").split(";")[0]).toContain("q_session=");

    const raw = await kv.get(SETTINGS_KEY);
    const stored = (JSON.parse(raw!) as { data: Record<string, unknown> }).data;
    expect(typeof stored.passwordHash).toBe("string");
    expect(stored.passwordHash).not.toBe(legacy.hash);
    expect(await verifyPassword(
      PASSWORD,
      stored.passwordHash as string,
      stored.passwordSalt as string,
      PEPPER,
    )).toEqual({ ok: true, tier: "current" });
    expect(await verifyPassword(
      PASSWORD,
      stored.passwordHash as string,
      stored.passwordSalt as string,
    )).toEqual({ ok: false, tier: "current" });

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: "wrong-password" }));
    expect(res.status).toBe(401);
  });
});


describe("password-only login (no second factor)", () => {
  const PASSWORD_ONLY = "solo-horse-99";

  it("issues a session on password alone and never sets a pre-auth cookie", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD_ONLY }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD_ONLY }));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasPassword: true });
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("q_session=");
    expect(setCookie).not.toContain("q_totp=");
  });

  it("ignores a totp field in the login body", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD_ONLY }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD_ONLY, totp: "000000" }));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasPassword: true });
  });
});

describe("onboarding bootstrap password", () => {
  const BOOTSTRAP_PASSWORD = "bootstrap-pass-11";
  const PERSONAL_PASSWORD = "personal-pass-99";

  function put(json: unknown, extra: Record<string, string> = {}): RequestInit {
    return {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...extra },
      body: JSON.stringify(json),
    };
  }
  async function seedBootstrapAccount(overrides: Record<string, unknown> = {}): Promise<void> {
    resetThrottle();
    const { hashPassword } = await import("../../src/auth/password");
    const { hash, salt } = await hashPassword(BOOTSTRAP_PASSWORD);
    await seed(kv, SP, {
      passwordHash: hash,
      passwordSalt: salt,
      passwordIsBootstrap: true,
      ...overrides,
    });
  }

  async function loginBootstrap(): Promise<string> {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: BOOTSTRAP_PASSWORD }));
    expect(res.status).toBe(200);
    return (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  }

  it("reports mustChangePassword on a successful bootstrap login and stays absent otherwise", async () => {
    await seedBootstrapAccount();
    const res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: BOOTSTRAP_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasPassword: true, mustChangePassword: true });

    resetThrottle();
    await seed(kv, SP);
    const plain = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(plain.status).toBe(200);
    const normal = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(normal.status).toBe(200);
    expect((await body(normal)).data).toEqual({ hasPassword: true, mustChangePassword: true });
  });

  it("logs a bootstrap account in with password alone (no second factor)", async () => {
    await seedBootstrapAccount();
    const res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: BOOTSTRAP_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasPassword: true, mustChangePassword: true });
    expect(res.headers.get("Set-Cookie") ?? "").toContain("q_session=");
  });

  it("gates authed api routes with PASSWORD_CHANGE_REQUIRED and keeps the allowlist open", async () => {
    await seedBootstrapAccount();
    const cookie = await loginBootstrap();
    const csrfHeaders = { Cookie: cookie, "X-Q-Panel": "1" };
    const cookieOnly = { Cookie: cookie };

    let res = await SELF.fetch(`${BASE}/api/status`);
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe("UNAUTHORIZED");

    const gatedReads = [
      `${BASE}/api/status`,
      `${BASE}/api/suburls`,
      `${BASE}/api/settings/export`,
      `${BASE}/api/warp/presets`,
    ];
    for (const url of gatedReads) {
      const gated = await SELF.fetch(url, { headers: cookieOnly });
      expect(gated.status, url).toBe(403);
      expect((await body(gated)).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: true }, csrfHeaders));
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    res = await SELF.fetch(`${BASE}/api/settings`, put({ profileTitle: "Blocked" }, csrfHeaders));
    expect(res.status).toBe(403);
    expect((await body(res)).error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    res = await SELF.fetch(`${BASE}/api/auth/password`, post({ currentPassword: "wrong", newPassword: PERSONAL_PASSWORD }, csrfHeaders));
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: cookieOnly });
    expect(res.status).toBe(200);
    expect((await body(res)).data.passwordIsBootstrap).toBe(true);

    res = await SELF.fetch(`${BASE}/api/bootstrap`, { headers: cookieOnly });
    expect(res.status).toBe(200);
    expect((await body(res)).data.settings.passwordIsBootstrap).toBe(true);

    res = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { "X-Q-Panel": "1" } });
    expect(res.status).toBe(200);
  });

  it("clears the bootstrap flag on password change and unlocks the gated routes", async () => {
    await seedBootstrapAccount();
    const cookie = await loginBootstrap();
    const csrfHeaders = { Cookie: cookie, "X-Q-Panel": "1" };

    let res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);

    res = await SELF.fetch(
      `${BASE}/api/auth/password`,
      post({ currentPassword: BOOTSTRAP_PASSWORD, newPassword: PERSONAL_PASSWORD }, csrfHeaders),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).data.changed).toBe(true);
    const freshCookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;

    const stored = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as {
      data: { passwordIsBootstrap: boolean; passwordHash: string };
    };
    expect(stored.data.passwordIsBootstrap).toBe(false);
    expect(stored.data.passwordHash).not.toBeNull();

    res = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: freshCookie } });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PERSONAL_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ hasPassword: true });

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: BOOTSTRAP_PASSWORD }));
    expect(res.status).toBe(401);
  });
});

describe("password strength rules", () => {
  const WEAK = ["password", "12345678", "abcdefgh", "ABCDEFGH", "short1a", "        "];

  it("rejects weak secrets on setup with an inline field error", async () => {
    for (const newPassword of WEAK) {
      resetThrottle();
      await seed(kv, SP);
      const res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword }, { "X-Q-Panel": "1" }));
      expect(res.status, newPassword).toBe(422);
      expect((await body(res)).fields.newPassword, newPassword).toMatch(/8 characters.*letter.*digit/);
    }
  });

  it("rejects weak secrets on change with an inline field error", async () => {
    for (const newPassword of WEAK) {
      resetThrottle();
      await seed(kv, SP);
      let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
      expect(res.status).toBe(200);
      await clearBootstrapFlag();
      const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
      res = await SELF.fetch(
        `${BASE}/api/auth/password`,
        post({ currentPassword: PASSWORD, newPassword }, { Cookie: cookie, "X-Q-Panel": "1" }),
      );
      expect(res.status, newPassword).toBe(422);
      expect((await body(res)).fields.newPassword, newPassword).toMatch(/8 characters.*letter.*digit/);
    }
  });

  it("accepts a letters-and-digits secret on both endpoints", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: "s3cur3p4ss" }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    res = await SELF.fetch(
      `${BASE}/api/auth/password`,
      post({ currentPassword: "s3cur3p4ss", newPassword: "4n0th3rs3cret" }, { Cookie: cookie, "X-Q-Panel": "1" }),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).data.changed).toBe(true);
  });
});

describe("setup window", () => {
  it("allows setup on a fresh boot and shortly after seeding", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();

    resetThrottle();
    await seed(kv, SP, { seededAt: Date.now() - 60 * 60 * 1000 });
    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: "within-window-1" }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    await clearBootstrapFlag();
  });

  it("rejects setup with SETUP_WINDOW_EXPIRED after 24 hours", async () => {
    resetThrottle();
    await seed(kv, SP, { seededAt: Date.now() - 25 * 60 * 60 * 1000 });
    const res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe("SETUP_WINDOW_EXPIRED");
  });
});
