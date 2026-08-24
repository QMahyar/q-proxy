import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = (env as unknown as { QPROXY_KV: KVNamespace }).QPROXY_KV;

const SP = "routepath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "router-test-pass-1";
const SETTINGS_KEY = "qproxy:settings";

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
};

async function seed(overrides: Record<string, unknown> = {}): Promise<void> {
  await kv.delete(SETTINGS_KEY);
  await kv.put(
    SETTINGS_KEY,
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      data: { ...structuredClone(DEFAULT_SETTINGS), securePath: SP, ...overrides },
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

describe("router dispatch", () => {
  it("serves robots.txt with the disallow-all policy", async () => {
    await seed();
    const res = await SELF.fetch("https://example.com/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe("User-agent: *\nDisallow: /");
  });

  it("answers OPTIONS anywhere with 405 METHOD", async () => {
    await seed();
    for (const path of ["/robots.txt", "/anything/at/all", `${BASE}/api/status`]) {
      const res = await SELF.fetch(`https://example.com${path}`, { method: "OPTIONS" });
      expect(res.status).toBe(405);
      expect((await body(res)).error.code).toBe("METHOD");
    }
  });

  it("falls through non-upgrade tunnel hits and unknown paths to camouflage", async () => {
    await seed();
    let res = await SELF.fetch("https://example.com/vl/abcd1234efgh");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    res = await SELF.fetch("https://example.com/totally/unknown/path");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("dispatches the full route table with precedence and fallbacks", async () => {
    await seed();

    let     res = await SELF.fetch(BASE, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/routepath/panel`);

    res = await SELF.fetch(`${BASE}/panel`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    res = await SELF.fetch(`${BASE}/login`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    res = await SELF.fetch(`${BASE}/api/auth/login`);
    expect(res.status).toBe(405);
    expect((await body(res)).error.code).toBe("METHOD");

    res = await SELF.fetch(`${BASE}/api/status`, post({}));
    expect(res.status).toBe(405);

    res = await SELF.fetch(`${BASE}/my-ip`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }));
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const csrf = { Cookie: cookie, "X-Q-Panel": "1" };

    res = await SELF.fetch(`${BASE}/my-ip`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    res = await SELF.fetch(
      `${BASE}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...csrf },
        body: JSON.stringify({ camouflage: { mode: "off" } }),
      },
    );
    expect(res.status).toBe(200);

    res = await SELF.fetch("https://example.com/some/random/junk");
    expect(res.status).toBe(404);
    expect((await body(res)).error.code).toBe("NOT_FOUND");

    res = await SELF.fetch("https://example.com/vl/abcd1234efgh");
    expect(res.status).toBe(404);
    expect((await body(res)).error.code).toBe("NOT_FOUND");

    res = await SELF.fetch(
      `${BASE}/api/settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...csrf },
        body: JSON.stringify({
          camouflage: { mode: "proxy", url: "http://127.0.0.1:9/unreachable" },
        }),
      },
    );
    expect(res.status).toBe(200);
    res = await SELF.fetch("https://example.com/proxy/fallback/check");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: true }, csrf));
    expect(res.status).toBe(200);
    res = await SELF.fetch("https://example.com/vm/abcd1234efgh", { headers: UPGRADE_HEADERS });
    expect(res.status).toBe(503);
    res = await SELF.fetch("https://example.com/ss/abcd1234efgh");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }, csrf));
    expect(res.status).toBe(200);

    res = await SELF.fetch("https://example.com/vl/abcd1234efgh", { headers: UPGRADE_HEADERS });
    expect(res.status).toBe(101);
    expect(res.webSocket).not.toBeNull();
    if (res.webSocket !== null) {
      res.webSocket.accept();
      try {
        res.webSocket.close(1000);
      } catch {}
    }

    res = await SELF.fetch(`${BASE}/sub?target=clash`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("yaml");

    res = await SELF.fetch(`${BASE}/sub`);
    expect(res.status).toBeLessThan(500);

    res = await SELF.fetch(`${BASE}/doh?dns=q80BAAABAAAAAAAAA2NvbQdhZXJvcGlhA2NvbQAAAQAB`, {
      headers: { Accept: "application/dns-message" },
    });
    expect(res.status).toBeLessThan(500);

    res = await SELF.fetch(`${BASE}/api/settings/reset`, post({}, csrf));
    expect(res.status).toBe(200);
    expect((await body(res)).data.saved).toBe(true);
    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    const restored = (await body(res)).data;
    expect(restored.camouflage.mode).toBe(DEFAULT_SETTINGS.camouflage.mode);
    expect(restored.profileTitle).toBe(DEFAULT_SETTINGS.profileTitle);
    expect(restored.hasPassword).toBe(true);

    res = await SELF.fetch(`${BASE}/api/settings`);
    expect(res.status).toBe(401);
  }, 120_000);
});
