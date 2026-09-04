import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { SETTINGS_KEY, resetThrottle, seed, testKv } from "../helpers/seed";

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

describe("panel auth lifecycle", () => {
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
    const setupBody = await body(res);
    expect(setupBody.ok).toBe(true);
    expect(setupBody.data.hasPassword).toBe(true);
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
    expect(urls.length).toBe(7);
    expect(urls.map((u) => u.format)).toEqual([
      "base64",
      "clash",
      "singbox",
      "surge",
      "loon",
      "quantumult",
      "base64",
    ]);
    expect(urls[0]!.url).toBe(`https://example.com/${SP}/sub`);
    expect(urls[1]!.url).toContain("?target=clash");
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

describe("totp two-factor login", () => {
  const TOTP_PASSWORD = "totp-horse-99";
  const TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  function b32dec(s: string): Uint8Array {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const clean = s.trim().toUpperCase().replace(/[\s-]+/g, "").replace(/=+$/, "");
    const out: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const ch of clean) {
      acc = (acc << 5) | alphabet.indexOf(ch);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >>> bits) & 0xff);
      }
    }
    return new Uint8Array(out);
  }

  async function totpNow(secret: string): Promise<string> {
    const key = b32dec(secret);
    const counter = Math.floor(Math.floor(Date.now() / 1000) / 30);
    const msg = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) {
      msg[i] = c % 256;
      c = Math.floor(c / 256);
    }
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
    const o = sig[sig.length - 1]! & 15;
    const v = ((sig[o]! & 127) << 24) | (sig[o + 1]! << 16) | (sig[o + 2]! << 8) | sig[o + 3]!;
    return String(v % 10 ** 6).padStart(6, "0");
  }

  async function sha256hex(s: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function setupWithTotp(recoveryPlain: string[]): Promise<string> {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: TOTP_PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const hashes: string[] = [];
    for (const plain of recoveryPlain) {
      hashes.push(await sha256hex(plain.trim().replace(/[\s-]+/g, "").toUpperCase()));
    }
    res = await SELF.fetch(`${BASE}/api/settings/save`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-Q-Panel": "1" },
      body: JSON.stringify({ totp: { enabled: true, secret: TOTP_SECRET, recoveryCodes: hashes } }),
    });
    expect(res.status).toBe(200);
    return cookie;
  }

  async function preAuthCookie(): Promise<string> {
    const res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: TOTP_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await res.clone().json() as { data: { totpRequired?: boolean } }).data.totpRequired).toBe(true);
    return (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  }

  it("returns a short-lived pre-auth cookie instead of a session on password alone", async () => {
    await setupWithTotp([]);
    const res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: TOTP_PASSWORD }));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ totpRequired: true });
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("q_totp=");
    expect(setCookie).toContain("Max-Age=300");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("q_session=");
  });

  it("completes the second step with a current code", async () => {
    await setupWithTotp([]);
    const pre = await preAuthCookie();
    expect(pre).toContain("q_totp=");
    const res = await SELF.fetch(`${BASE}/api/auth/login`, post({ totp: await totpNow(TOTP_SECRET) }, { Cookie: pre }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("q_session=");
    expect(setCookie).toContain("q_totp=; ");
    const session = setCookie.split(";")[0]!;
    const status = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: session } });
    expect(status.status).toBe(200);
  });

  it("accepts password and code together without a pre-auth cookie", async () => {
    await setupWithTotp([]);
    const res = await SELF.fetch(
      `${BASE}/api/auth/login`,
      post({ password: TOTP_PASSWORD, totp: await totpNow(TOTP_SECRET) }),
    );
    expect(res.status).toBe(200);
    expect((res.headers.get("Set-Cookie") ?? "")).toContain("q_session=");
    const session = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const status = await SELF.fetch(`${BASE}/api/status`, { headers: { Cookie: session } });
    expect(status.status).toBe(200);
  });

  it("burns a recovery code on first use regardless of formatting", async () => {
    await setupWithTotp(["Test-Code-01"]);
    let pre = await preAuthCookie();
    let res = await SELF.fetch(`${BASE}/api/auth/login`, post({ totp: "test code 01" }, { Cookie: pre }));
    expect(res.status).toBe(200);
    expect((res.headers.get("Set-Cookie") ?? "")).toContain("q_session=");
    pre = await preAuthCookie();
    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ totp: "test code 01" }, { Cookie: pre }));
    expect(res.status).toBe(401);
    const raw = await kv.get(SETTINGS_KEY);
    const stored = (JSON.parse(raw!) as { data: { totp: { recoveryCodes: string[] } } }).data;
    expect(stored.totp.recoveryCodes).toEqual([]);
  });

  it("rejects the code step without a valid pre-auth cookie", async () => {
    await setupWithTotp([]);
    const code = await totpNow(TOTP_SECRET);
    let res = await SELF.fetch(`${BASE}/api/auth/login`, post({ totp: code }));
    expect(res.status).toBe(401);
    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ totp: code }, { Cookie: "q_totp=tp1.bogus.sig" }));
    expect(res.status).toBe(401);
  });

  it("never exposes totp material in settings or export", async () => {
    const cookie = await setupWithTotp(["Test-Code-01"]);
    const hash = await sha256hex("TESTCODE01");
    let res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOTP_SECRET);
    expect(text).not.toContain(hash);
    expect(text).not.toContain("totp");
    expect((JSON.parse(text) as { data: Record<string, unknown> }).data.totp).toBeUndefined();
    res = await SELF.fetch(`${BASE}/api/settings/export`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const exported = await res.text();
    expect(exported).not.toContain(TOTP_SECRET);
    expect(exported).not.toContain(hash);
    expect(exported).not.toContain("totp");
  });

  it("rejects enabling without a secret", async () => {
    resetThrottle();
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: TOTP_PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    res = await SELF.fetch(`${BASE}/api/settings/save`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-Q-Panel": "1" },
      body: JSON.stringify({ totp: { enabled: true } }),
    });
    expect(res.status).toBe(422);
    expect((await body(res)).fields["totp.secret"]).toBeTruthy();
  });

  it("rate limits repeated wrong codes", async () => {
    await setupWithTotp([]);
    const pre = await preAuthCookie();
    let saw429 = false;
    for (let i = 0; i < 9; i++) {
      const res = await SELF.fetch(`${BASE}/api/auth/login`, post({ totp: "000000" }, { Cookie: pre }));
      if (res.status === 429) {
        saw429 = true;
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(saw429).toBe(true);
  });
});
