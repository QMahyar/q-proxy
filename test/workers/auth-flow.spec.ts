import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = (env as unknown as { QPROXY_KV: KVNamespace }).QPROXY_KV;

const SP = "flowpath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "correct-horse-42";
const SETTINGS_KEY = "qproxy:settings";

async function seed(): Promise<void> {
  await kv.delete(SETTINGS_KEY);
  await kv.put(
    SETTINGS_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      data: { ...structuredClone(DEFAULT_SETTINGS), securePath: SP },
    }),
  );
  invalidateSettingsCache();
}

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
    await seed();

    let res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe("SETUP_REQUIRED");

    res = await SELF.fetch(`${BASE}/api/settings`);
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe("UNAUTHORIZED");

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: "short" }));
    expect(res.status).toBe(422);
    expect((await body(res)).fields.newPassword).toBeTruthy();

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }));
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

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: "another-pass-99" }));
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
    expect(urls.length).toBe(6);
    expect(urls.map((u) => u.format)).toEqual([
      "base64",
      "clash",
      "singbox",
      "surge",
      "loon",
      "base64",
    ]);
    expect(urls[0]!.url).toBe(`https://example.com/${SP}/sub`);
    expect(urls[1]!.url).toContain("?target=clash");
    expect(urls.find((u) => u.label === "Panel info")!.url).toContain("?view=html");

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }, csrfHeaders));
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

    res = await SELF.fetch(`${BASE}/api/settings`);
    expect(res.status).toBe(401);
  });

  it("rate limits repeated failed logins", async () => {
    await seed();
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }));
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
