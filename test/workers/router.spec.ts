import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF, env as cfEnv } from "cloudflare:test";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { telegramWebhookSecret } from "../../src/handlers/api/telegram";
import { seed, SETTINGS_KEY, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const env: Env = cfEnv as unknown as Env;
const kv = testKv(env);

const SP = "routepath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "router-test-pass-1";

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
};

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

function put(json: unknown, extra: Record<string, string> = {}): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(json),
  };
}

async function setupAdmin(): Promise<{ cookie: string; csrfHeaders: Record<string, string> }> {
  const res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
  expect(res.status).toBe(200);
    const __raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { updatedAt?: number; data: Record<string, unknown> };
    __raw.data.passwordIsBootstrap = false;
    __raw.updatedAt = Date.now();
    await kv.put(SETTINGS_KEY, JSON.stringify(__raw));
    invalidateSettingsCache();
  const raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { updatedAt?: number; data: Record<string, unknown> };
  raw.data.passwordIsBootstrap = false;
  raw.updatedAt = Date.now();
  await kv.put(SETTINGS_KEY, JSON.stringify(raw));
  invalidateSettingsCache();
  const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  return { cookie, csrfHeaders: { Cookie: cookie, "X-Q-Panel": "1" } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("router dispatch", () => {
  it("serves robots.txt with the disallow-all policy", async () => {
    await seed(kv, SP);
    const res = await SELF.fetch("https://example.com/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe("User-agent: *\nDisallow: /");
  });

  it("answers OPTIONS anywhere with 405 METHOD", async () => {
    await seed(kv, SP);
    for (const path of ["/robots.txt", "/anything/at/all", `${BASE}/api/status`]) {
      const res = await SELF.fetch(`https://example.com${path}`, { method: "OPTIONS" });
      expect(res.status).toBe(405);
      expect((await body(res)).error.code).toBe("METHOD");
    }
  });

  it("serves /healthz for GET and rejects other methods", async () => {
    await seed(kv, SP);
    const res = await SELF.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const data = await body(res);
    expect(data).toEqual({ ok: true });

    const rejected = await SELF.fetch("https://example.com/healthz", { method: "POST" });
    expect(rejected.status).toBe(405);
    expect((await body(rejected)).error.code).toBe("METHOD");
  });

  it("maps the auth alias routes to their canonical handlers", async () => {
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: "alias-pass-1" }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    const __raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { updatedAt?: number; data: Record<string, unknown> };
    __raw.data.passwordIsBootstrap = false;
    __raw.updatedAt = Date.now();
    await kv.put(SETTINGS_KEY, JSON.stringify(__raw));
    invalidateSettingsCache();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: "wrong" }));
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/password`, post({}, { Cookie: cookie }));
    expect(res.status).toBe(403);

    res = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { "X-Q-Panel": "1" } });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/auth/nonsense`, post({}));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("serves removed routes exactly like unknown paths (camouflage)", async () => {
    await seed(kv, SP);
    const unknown = await SELF.fetch("https://example.com/totally/unknown/path");
    expect(unknown.status).toBe(200);
    const unknownBody = await unknown.text();
    for (const path of [
      `${BASE}/api/version/check`,
      `${BASE}/api/users`,
      `${BASE}/my-ip`,
      `${BASE}/sub/u/33333333-3333-4333-8333-333333333333?target=base64`,
      "https://example.com/vm/abcd1234efgh",
      "https://example.com/ss/abcd1234efgh",
    ]) {
      const res = await SELF.fetch(path);
      expect(res.status, path).toBe(unknown.status);
      expect(await res.text(), path).toBe(unknownBody);
    }
  });

  it("falls through non-upgrade tunnel hits and unknown paths to camouflage", async () => {
    await seed(kv, SP);
    let res = await SELF.fetch("https://example.com/vl/abcd1234efgh");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    res = await SELF.fetch("https://example.com/totally/unknown/path");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
    );
  });

  describe("route table precedence", () => {
    let cookie = "";
    let csrfHeaders: Record<string, string> = {};

    beforeEach(async () => {
      await seed(kv, SP);
      ({ cookie, csrfHeaders } = await setupAdmin());
    });

    it("redirects root and serves panel/login pages with their policies", async () => {
      let res = await SELF.fetch(BASE, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(`/routepath/panel`);

      res = await SELF.fetch(`${BASE}/panel`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
      expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{32}"$/);
      expect(res.headers.get("Content-Security-Policy")).toBe(
        "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' https:; base-uri 'none'; form-action 'self'",
      );

      res = await SELF.fetch(`${BASE}/login`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(res.headers.get("Content-Security-Policy")).toBe(
        "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
      );
    });

    it("rejects wrong methods and unauthenticated gates before dispatch", async () => {
      let res = await SELF.fetch(`${BASE}/api/auth/login`);
      expect(res.status).toBe(405);
      expect((await body(res)).error.code).toBe("METHOD");

      res = await SELF.fetch(`${BASE}/api/status`, post({}));
      expect(res.status).toBe(405);
    });

    it("enforces the dispatchApi method/auth matrix", async () => {
      const getOnly = [
        `${BASE}/api/status`,
        `${BASE}/api/suburls`,
        `${BASE}/api/bootstrap`,
        `${BASE}/api/settings/export`,
      ];
      for (const url of getOnly) {
        const res = await SELF.fetch(url, post({}));
        expect(res.status).toBe(405);
        expect((await body(res)).error.code).toBe("METHOD");
      }

      let res = await SELF.fetch(`${BASE}/api/settings`, post({}));
      expect(res.status).toBe(405);
      expect((await body(res)).error.code).toBe("METHOD");

      const postOnly = [
        `${BASE}/api/killswitch`,
        `${BASE}/api/settings/reset`,
        `${BASE}/api/settings/import`,
        `${BASE}/api/auth/login`,
        `${BASE}/api/auth/logout`,
        `${BASE}/api/auth/setup`,
        `${BASE}/api/auth/password`,
        `${BASE}/telegram/setup`,
        `${BASE}/telegram/remove`,
      ];
      for (const url of postOnly) {
        const rejected = await SELF.fetch(url);
        expect(rejected.status).toBe(405);
        expect((await body(rejected)).error.code).toBe("METHOD");
      }

      res = await SELF.fetch(`${BASE}/api/settings/save`);
      expect(res.status).toBe(405);
      expect((await body(res)).error.code).toBe("METHOD");

      const cookieOnly = { Cookie: cookie };
      const protectedGet = [
        `${BASE}/api/status`,
        `${BASE}/api/suburls`,
        `${BASE}/api/bootstrap`,
        `${BASE}/api/settings`,
        `${BASE}/api/settings/export`,
        `${BASE}/api/warp/presets`,
      ];
      for (const url of protectedGet) {
        const unauth = await SELF.fetch(url);
        expect(unauth.status).toBe(401);
        expect((await body(unauth)).error.code).toBe("UNAUTHORIZED");
      }

      res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }));
      expect(res.status).toBe(401);
      expect((await body(res)).error.code).toBe("UNAUTHORIZED");

      res = await SELF.fetch(`${BASE}/api/settings`, { headers: cookieOnly });
      expect(res.status).toBe(200);
      res = await SELF.fetch(`${BASE}/api/warp/presets`, { headers: cookieOnly });
      expect(res.status).toBe(200);

      const csrfMissing: Array<{ url: string; init: RequestInit }> = [
        { url: `${BASE}/api/settings/save`, init: put({ profileTitle: "Matrix Panel" }, cookieOnly) },
        { url: `${BASE}/api/settings`, init: put({ profileTitle: "Matrix Panel" }, cookieOnly) },
        { url: `${BASE}/api/killswitch`, init: post({ enabled: false }, cookieOnly) },
        { url: `${BASE}/api/settings/reset`, init: post({}, cookieOnly) },
        { url: `${BASE}/api/settings/import`, init: post({ settings: {} }, cookieOnly) },
        { url: `${BASE}/api/auth/password`, init: post({}, cookieOnly) },
        { url: `${BASE}/telegram/setup`, init: post({}, cookieOnly) },
        { url: `${BASE}/telegram/remove`, init: post({}, cookieOnly) },
      ];
      for (const { url, init } of csrfMissing) {
        const forbidden = await SELF.fetch(url, init);
        expect(forbidden.status).toBe(403);
        expect((await body(forbidden)).error.code).toBe("FORBIDDEN");
      }

      res = await SELF.fetch(`${BASE}/api/settings/save`, put({ profileTitle: "Matrix Panel" }, csrfHeaders));
      expect(res.status).toBe(200);
      expect((await body(res)).data.saved).toBe(true);

      res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }, csrfHeaders));
      expect(res.status).toBe(200);

      res = await SELF.fetch(`${BASE}/api/status`, { headers: cookieOnly });
      expect(res.status).toBe(200);
    });

    it("serves removed paths as camouflage and hides unknown paths behind camo-off 404s", async () => {
      const camo = await SELF.fetch("https://example.com/some/random/junk");
      expect(camo.status).toBe(200);
      const camoBody = await camo.text();
      for (const path of [`${BASE}/my-ip`, `${BASE}/sub/u/33333333-3333-4333-8333-333333333333`]) {
        const res = await SELF.fetch(path, { headers: { Cookie: cookie } });
        expect(res.status, path).toBe(200);
        expect(await res.text(), path).toBe(camoBody);
      }

      let res = await SELF.fetch(`${BASE}/api/settings`, put({ camouflage: { mode: "off" } }, csrfHeaders));
      expect(res.status).toBe(200);

      res = await SELF.fetch("https://example.com/some/random/junk");
      expect(res.status).toBe(404);
      expect((await body(res)).error.code).toBe("NOT_FOUND");

      res = await SELF.fetch("https://example.com/vl/abcd1234efgh");
      expect(res.status).toBe(404);
      expect((await body(res)).error.code).toBe("NOT_FOUND");
    });

    it("rejects camouflage proxy mode at save (static/off only)", async () => {
      const res = await SELF.fetch(
        `${BASE}/api/settings`,
        put(
          { camouflage: { mode: "proxy", url: "http://unreachable.example/unreachable" } },
          csrfHeaders,
        ),
      );
      expect(res.status).toBe(422);
    });

    it("blocks tunnel upgrades under kill switch and restores them after", async () => {
      let res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: true }, csrfHeaders));
      expect(res.status).toBe(200);

      res = await SELF.fetch("https://example.com/vl/abcd1234efgh", { headers: UPGRADE_HEADERS });
      expect(res.status).toBe(503);

      res = await SELF.fetch("https://example.com/vm/abcd1234efgh");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");

      res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }, csrfHeaders));
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
    });

    it("serves subscriptions, rejects deleted targets, and runs doh plus the reset roundtrip", async () => {
      let res = await SELF.fetch(`${BASE}/sub?target=singbox`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("json");

      res = await SELF.fetch(`${BASE}/sub?target=clash`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("yaml");
      expect(await res.text()).toContain("proxies:");

      res = await SELF.fetch(`${BASE}/sub?target=surge`);
      expect(res.status).toBe(400);

      res = await SELF.fetch(`${BASE}/sub`);
      expect(res.status).toBe(200);

      res = await SELF.fetch(`${BASE}/doh?dns=q80BAAABAAAAAAAAA2NvbQdhZXJvcGlhA2NvbQAAAQAB`, {
        headers: { Accept: "application/dns-message" },
      });
      expect([200, 502]).toContain(res.status);

      res = await SELF.fetch(`${BASE}/api/settings/reset`, post({}, csrfHeaders));
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

  it("gates the api behind PASSWORD_CHANGE_REQUIRED while the bootstrap password is active", async () => {
    const { resetThrottle } = await import("../helpers/seed");
    resetThrottle();
    await seed(kv, SP);
    const { hashPassword } = await import("../../src/auth/password");
    const { hash, salt } = await hashPassword(PASSWORD);
    await seed(kv, SP, { passwordHash: hash, passwordSalt: salt, passwordIsBootstrap: true });

    let res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(200);
    expect((await body(res)).data.mustChangePassword).toBe(true);
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const csrfHeaders = { Cookie: cookie, "X-Q-Panel": "1" };

    const gated = [
      `${BASE}/api/status`,
      `${BASE}/api/suburls`,
      `${BASE}/api/settings/export`,
    ];
    for (const url of gated) {
      const denied = await SELF.fetch(url, { headers: { Cookie: cookie } });
      expect(denied.status, url).toBe(403);
      expect((await body(denied)).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    res = await SELF.fetch(`${BASE}/api/bootstrap`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    const deniedWrite = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }, csrfHeaders));
    expect(deniedWrite.status).toBe(403);
    expect((await body(deniedWrite)).error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    res = await SELF.fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { "X-Q-Panel": "1" } });
    expect(res.status).toBe(200);
  });

  it("serves the bootstrap aggregate with ETag revalidation", async () => {
    await seed(kv, SP);

    let res = await SELF.fetch(`${BASE}/api/bootstrap`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    expect(res.status).toBe(200);
    const __raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { updatedAt?: number; data: Record<string, unknown> };
    __raw.data.passwordIsBootstrap = false;
    __raw.updatedAt = Date.now();
    await kv.put(SETTINGS_KEY, JSON.stringify(__raw));
    invalidateSettingsCache();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const headers = { Cookie: cookie, "X-Q-Panel": "1" };

    res = await SELF.fetch(`${BASE}/api/bootstrap`, { headers });
    expect(res.status).toBe(200);
    const etag = res.headers.get("ETag");
    expect(etag).not.toBeNull();
    const data = await body(res);
    expect(data.data.settings.securePath).toBe(SP);
    expect(data.data.settings.hasPassword).toBe(true);
    expect(typeof data.data.status.version).toBe("string");
    expect(data.data.status.usage).toBeTruthy();
    expect(data.data.subUrls.urls.length).toBeGreaterThan(0);

    res = await SELF.fetch(`${BASE}/api/bootstrap`, {
      headers: { Cookie: cookie, "If-None-Match": etag! },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");

    res = await SELF.fetch(`${BASE}/api/bootstrap`, { method: "POST", headers });
    expect(res.status).toBe(405);
  });

  it("round-trips settings export and import without leaking credentials", async () => {
    await seed(kv, SP);
    const { cookie, csrfHeaders } = await setupAdmin();

    let res = await SELF.fetch(`${BASE}/api/settings/export`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const raw = await res.text();
    for (const secret of ["passwordHash", "passwordSalt", "sessionSecret", "botToken"]) {
      expect(raw).not.toContain(secret);
    }
    const blob = JSON.parse(raw) as { kind: string; version: number; settings: Record<string, unknown> };
    expect(blob.kind).toBe("q-proxy-settings");
    expect(blob.settings.securePath).toBeUndefined();

    res = await SELF.fetch(`${BASE}/api/settings`, put({ profileTitle: "Roundtrip Panel" }, csrfHeaders));
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/settings/export`, { headers: { Cookie: cookie } });
    const customized = JSON.parse(await res.text()) as { settings: Record<string, unknown> };
    expect(customized.settings.profileTitle).toBe("Roundtrip Panel");

    res = await SELF.fetch(`${BASE}/api/settings/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ settings: customized.settings }),
    });
    expect(res.status).toBe(200);
    const imported = (await body(res)).data;
    expect(imported.saved).toBe(true);
    expect(imported.imported.profileTitle).toBe("Roundtrip Panel");
    expect(imported.imported.hasPassword).toBe(true);

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    expect((await body(res)).data.hasPassword).toBe(true);

    res = await SELF.fetch(`${BASE}/api/auth/login`, post({ password: PASSWORD }));
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/settings/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ settings: { ...customized.settings, version: 999 } }),
    });
    expect(res.status).toBe(422);
    expect((await body(res)).error.code).toBe("VALIDATION");
  });

  it("merges settings saves with fresh KV state instead of the stale isolate cache", async () => {
    await seed(kv, SP);
    const { cookie, csrfHeaders } = await setupAdmin();

    let res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await body(res)).data.profileTitle).toBe(DEFAULT_SETTINGS.profileTitle);

    const before = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as {
      rev: number;
      data: Record<string, unknown>;
    };
    expect(typeof before.rev).toBe("number");
    before.data.profileTitle = "fresh-concurrent";
    await kv.put(SETTINGS_KEY, JSON.stringify(before));

    res = await SELF.fetch(`${BASE}/api/settings`, put({ maxNodesPerFormat: 600 }, csrfHeaders));
    expect(res.status).toBe(200);
    const saved = (await body(res)).data;
    expect(saved.saved).toBe(true);
    expect(saved.rev).toBe(before.rev + 1);

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
    const view = (await body(res)).data;
    expect(view.profileTitle).toBe("fresh-concurrent");
    expect(view.maxNodesPerFormat).toBe(600);

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: true }, csrfHeaders));
    expect(res.status).toBe(200);
    const kill = (await body(res)).data;
    expect(kill.killSwitch).toBe(true);
    expect(kill.rev).toBe(saved.rev + 1);

    res = await SELF.fetch(`${BASE}/api/killswitch`, post({ enabled: false }, csrfHeaders));
    expect(res.status).toBe(200);
    expect((await body(res)).data.killSwitch).toBe(false);
  });

  it("dispatches the warp api with auth, csrf and a full import roundtrip", async () => {
    await seed(kv, SP);

    let res = await SELF.fetch(`${BASE}/api/warp/account`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    const __raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { updatedAt?: number; data: Record<string, unknown> };
    __raw.data.passwordIsBootstrap = false;
    __raw.updatedAt = Date.now();
    await kv.put(SETTINGS_KEY, JSON.stringify(__raw));
    invalidateSettingsCache();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const csrfHeaders = { Cookie: cookie, "X-Q-Panel": "1" };

    res = await SELF.fetch(`${BASE}/api/warp/presets`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const presetIds = ((await body(res)).data.presets as Array<{ id: string }>).map((p) => p.id);
    expect(presetIds).toContain("default");

    const priv = btoa(
      String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)),
    );
    const conf = [
      "[Interface]",
      `PrivateKey = ${priv}`,
      "Address = 10.2.0.2/32, 2606:4700:110:8d4a::/128",
      "MTU = 1280",
      "[Peer]",
      `PublicKey = ${"bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo="}`,
      "AllowedIPs = 0.0.0.0/0",
      "Endpoint = engage.cloudflareclient.com:2408",
    ].join("\n");

    res = await SELF.fetch(`${BASE}/api/warp/account/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Router Test", config: conf }),
    });
    expect(res.status).toBe(403);

    res = await SELF.fetch(`${BASE}/api/warp/account/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ name: "Router Test", config: conf }),
    });
    expect(res.status).toBe(200);
    const account = (await body(res)).data.account as Record<string, unknown>;
    expect(account.name).toBe("Router Test");
    expect(JSON.stringify(account)).not.toContain("private_key");
    const accountId = account.id as string;
    const token = account.token as string;

    res = await SELF.fetch(`${BASE}/api/warp/account`, { headers: { Cookie: cookie } });
    expect((await body(res)).data.accounts.length).toBe(1);

    res = await SELF.fetch(`${BASE}/api/warp/account/${accountId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(200);
    expect(((await body(res)).data.account as Record<string, unknown>).name).toBe("Renamed");

    res = await SELF.fetch(`${BASE}/api/warp/account/${accountId}/regenerate-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(((await body(res)).data.token as string)).not.toBe(token);

    res = await SELF.fetch(`${BASE}/api/warp/settings/amnezia`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/warp/settings/amnezia`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ amnezia: { Jc: 4, Jmin: 40, Jmax: 70 } }),
    });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/warp/settings/amnezia`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ amnezia: { Jc: 999 } }),
    });
    expect(res.status).toBe(422);

    res = await SELF.fetch(`${BASE}/api/warp/account/${accountId}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-Q-Panel": "1" },
    });
    expect(res.status).toBe(200);
    res = await SELF.fetch(`${BASE}/api/warp/account/${accountId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);

    res = await SELF.fetch(`${BASE}/api/warp/nonsense`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  it("registers and removes the telegram webhook against the upstream bot api", async () => {
    const tg = { enabled: true, botToken: `123456789:${"B".repeat(35)}`, chatId: "555000111" };
    await seed(kv, SP, { telegram: tg, sessionSecret: "tg-router-secret" });
    const { csrfHeaders } = await setupAdmin();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ ok: true, description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const secret = await telegramWebhookSecret("tg-router-secret");
    let res = await SELF.fetch(`${BASE}/telegram/setup`, post({}, csrfHeaders));
    expect(res.status).toBe(200);
    expect((await body(res)).data.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${tg.botToken}/setWebhook`);
    const sentBody = JSON.parse(calls[0]!.init.body as string) as { url: string };
    expect(sentBody.url).toBe(`https://example.com/${SP}/telegram/webhook/${secret}`);

    res = await SELF.fetch(`${BASE}/telegram/remove`, post({}, csrfHeaders));
    expect(res.status).toBe(200);
    expect((await body(res)).data.ok).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[1]!.url).toBe(`https://api.telegram.org/bot${tg.botToken}/deleteWebhook`);
  });

  it("gates the telegram webhook by hmac secret and serves only the bound chat", async () => {
    const tg = { enabled: true, botToken: `123456789:${"B".repeat(35)}`, chatId: "555000111" };
    await seed(kv, SP, { telegram: tg, sessionSecret: "tg-router-secret" });
    const secret = await telegramWebhookSecret("tg-router-secret");
    const hookPost = (text: string, id: number): RequestInit => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { message_id: 1, chat: { id }, text } }),
    });

    let res = await SELF.fetch(`${BASE}/telegram/webhook/ffffffffffffffff`, hookPost("/kill on", 555000111));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({});

    res = await SELF.fetch(`${BASE}/telegram/webhook/${secret}`, hookPost("/kill on", 1111));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({});

    res = await SELF.fetch(`${BASE}/telegram/webhook/${secret}`, hookPost("/kill on", 555000111));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({});

    let stored = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { data: { killSwitch: boolean; telegram: typeof tg } };
    expect(stored.data.killSwitch).toBe(true);
    expect(stored.data.telegram.chatId).toBe("555000111");

    res = await SELF.fetch(`${BASE}/telegram/webhook/${secret}`, hookPost("/kill off", 555000111));
    expect(res.status).toBe(200);
    stored = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { data: { killSwitch: boolean; telegram: typeof tg } };
    expect(stored.data.killSwitch).toBe(false);

    await seed(kv, SP, { telegram: { ...tg, enabled: false }, sessionSecret: "tg-router-secret" });
    res = await SELF.fetch(`${BASE}/telegram/webhook/${secret}`, hookPost("/kill on", 555000111));
    expect(res.status).toBe(200);
    stored = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { data: { killSwitch: boolean; telegram: typeof tg } };
    expect(stored.data.killSwitch).toBe(false);

    res = await SELF.fetch(`${BASE}/telegram/setup`, post({}, {}));
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/telegram/webhook/${secret}`);
    expect(res.status).toBe(405);
    expect((await body(res)).error.code).toBe("METHOD");

    res = await SELF.fetch(`${BASE}/telegram/webhook/not-a-secret-at-all`, hookPost("/kill on", 555000111));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  }, 30000);

  it("serves warp subscriptions publicly by token across formats", async () => {
    await seed(kv, SP);
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
    const __raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { updatedAt?: number; data: Record<string, unknown> };
    __raw.data.passwordIsBootstrap = false;
    __raw.updatedAt = Date.now();
    await kv.put(SETTINGS_KEY, JSON.stringify(__raw));
    invalidateSettingsCache();
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const csrfHeaders = { Cookie: cookie, "X-Q-Panel": "1" };
    const priv = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)));
    const conf = [
      "[Interface]",
      `PrivateKey = ${priv}`,
      "Address = 10.2.0.2/32, 2606:4700:110:8d4a::/128",
      "MTU = 1280",
      "[Peer]",
      "PublicKey = bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=",
      "AllowedIPs = 0.0.0.0/0",
      "Endpoint = engage.cloudflareclient.com:2408",
    ].join("\n");
    res = await SELF.fetch(`${BASE}/api/warp/account/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ name: "Sub Test", config: conf }),
    });
    const account = (await body(res)).data.account as { id: string; token: string };

    res = await SELF.fetch(`${BASE}/sub/wg/${account.token}/throne`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Content-Disposition")).toContain("Sub-Test-throne.txt");
    const throne = await res.text();
    expect(throne).toMatch(/^wg:\/\/engage\.cloudflareclient\.com:2408\?private_key=/);
    expect(throne).toContain("local_address=10.2.0.2-2606:4700:110:8d4a::");

    res = await SELF.fetch(`${BASE}/sub/wg/${account.token}/singbox`);
    const singbox = JSON.parse(await res.text()) as { endpoints: Array<{ type: string }> };
    expect(singbox.endpoints[0]!.type).toBe("wireguard");

    res = await SELF.fetch(`${BASE}/sub/wg/${account.token}/wireguard-conf`);
    expect(res.headers.get("Content-Type")).toContain("zip");
    const zipBytes = new Uint8Array(await res.arrayBuffer());
    expect(new DataView(zipBytes.buffer).getUint32(0, true)).toBe(0x04034b50);

    res = await SELF.fetch(`${BASE}/sub/wg/11111111-1111-4111-8111-111111111111/throne`);
    expect(res.status).toBe(404);

    const unknown = await SELF.fetch("https://example.com/totally/unknown/path");
    expect(unknown.status).toBe(200);
    const unknownBody = await unknown.text();
    for (const format of [
      "wireguard-conf-amnezia",
      "throne-amnezia",
      "wireguard-uri",
      "singbox-amnezia",
      "singbox-legacy",
      "singbox-legacy-amnezia",
      "xray",
      "clash",
      "clash-amnezia",
      "surge",
      "surfboard",
      "loon",
      "egern",
      "not-a-format",
    ]) {
      res = await SELF.fetch(`${BASE}/sub/wg/${account.token}/${format}`);
      expect(res.status, format).toBe(unknown.status);
      expect(await res.text(), format).toBe(unknownBody);
    }

    res = await SELF.fetch(`${BASE}/sub/wg/not-a-uuid/throne`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    res = await SELF.fetch(`${BASE}/api/warp/account/${account.id}/regenerate-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const rotated = (await body(res)).data.token as string;
    expect(rotated).not.toBe(account.token);
    for (const format of ["wireguard-conf", "throne", "v2rayn", "singbox"]) {
      res = await SELF.fetch(`${BASE}/sub/wg/${rotated}/${format}`);
      expect(res.status, format).toBe(200);
    }
    res = await SELF.fetch(`${BASE}/sub/wg/${account.token}/singbox`);
    expect(res.status).toBe(404);
  });


  it("serves dead per-user token URLs as camouflage identical to unknown paths", async () => {
    await seed(kv, SP);
    const unknown = await SELF.fetch("https://example.com/some/random/junk");
    expect(unknown.status).toBe(200);
    const unknownBody = await unknown.text();
    for (const path of [
      `${BASE}/sub/u/33333333-3333-4333-8333-333333333333?target=base64`,
      `${BASE}/sub/u/44444444-4444-4444-8444-444444444444?target=clash`,
      `${BASE}/sub/u/not-a-uuid`,
    ]) {
      const res = await SELF.fetch(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(unknownBody);
    }
  });
});
