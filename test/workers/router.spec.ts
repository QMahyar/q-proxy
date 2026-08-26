import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { invalidateSettingsCache } from "../../src/settings/store";
import { telegramWebhookSecret } from "../../src/handlers/api/telegram";

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
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");

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
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/doh?dns=q80BAAABAAAAAAAAA2NvbQdhZXJvcGlhA2NvbQAAAQAB`, {
      headers: { Accept: "application/dns-message" },
    });
    expect([200, 502]).toContain(res.status);

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

  it("serves the bootstrap aggregate with ETag revalidation", async () => {
    await seed();

    let res = await SELF.fetch(`${BASE}/api/bootstrap`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }));
    expect(res.status).toBe(200);
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

  it("dispatches the warp api with auth, csrf and a full import roundtrip", async () => {
    await seed();

    let res = await SELF.fetch(`${BASE}/api/warp/account`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }));
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

  it("gates the telegram webhook by hmac secret and serves only the bound chat", async () => {
    const tg = { enabled: true, botToken: `123456789:${"B".repeat(35)}`, chatId: "555000111" };
    await seed({ telegram: tg, sessionSecret: "tg-router-secret" });
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

    await seed({ telegram: { ...tg, enabled: false }, sessionSecret: "tg-router-secret" });
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
  });

  it("serves warp subscriptions publicly by token across formats", async () => {
    await seed();
    let res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }));
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
    const account = (await body(res)).data.account as { token: string };

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

    res = await SELF.fetch(`${BASE}/sub/wg/${account.token}/not-a-format`);
    expect(res.status).toBe(404);

    res = await SELF.fetch(`${BASE}/sub/wg/not-a-uuid/throne`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("covers the user center: admin CRUD, token subs, 410/429 and camouflage fallthrough", async () => {
    await seed();

    let res = await SELF.fetch(`${BASE}/api/users`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }));
    const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
    const csrfHeaders = { Cookie: cookie, "X-Q-Panel": "1" };

    res = await SELF.fetch(`${BASE}/api/users`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(((await body(res)).data.users as unknown[]).length).toBe(0);

    res = await SELF.fetch(`${BASE}/api/warp/nonsense`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    res = await SELF.fetch(`${BASE}/api/users`, post({}, { Cookie: cookie }));
    expect(res.status).toBe(403);

    res = await SELF.fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBe(200);
    const user = (await body(res)).data.user as Record<string, any>;
    expect(user.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(user.enabled).toBe(true);
    expect(user.protocols).toBe("all");

    res = await SELF.fetch(`${BASE}/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ name: "Bob" }),
    });
    expect(res.status).toBe(200);
    expect(((await body(res)).data.user as Record<string, unknown>).name).toBe("Bob");

    res = await SELF.fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(422);
    res = await SELF.fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ name: "X", protocols: ["vless", "nope"] }),
    });
    expect(res.status).toBe(422);

    const usersKey = "qproxy:users";
    const directory = JSON.parse((await kv.get(usersKey)) as string) as unknown[];
    directory.push(
      {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Old",
        token: "33333333-3333-4333-8333-333333333333",
        enabled: true,
        expiresAt: Date.now() - 1000,
        dailyReqLimit: null,
        protocols: "all",
        createdAt: new Date().toISOString(),
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        name: "Off",
        token: "44444444-4444-4444-8444-444444444444",
        enabled: false,
        expiresAt: null,
        dailyReqLimit: null,
        protocols: ["ss"],
        createdAt: new Date().toISOString(),
      },
    );
    await kv.put(usersKey, JSON.stringify(directory));

    res = await SELF.fetch(`${BASE}/sub/u/33333333-3333-4333-8333-333333333333?target=base64`);
    expect(res.status).toBe(410);
    res = await SELF.fetch(`${BASE}/sub/u/44444444-4444-4444-8444-444444444444?target=clash`);
    expect(res.status).toBe(410);

    res = await SELF.fetch(`${BASE}/sub/u/not-a-uuid`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    res = await SELF.fetch(`${BASE}/sub/u/77777777-7777-4777-8777-777777777777`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    res = await SELF.fetch(`${BASE}/sub/u/${user.token}?target=base64`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(atob((await res.text()).trim()).length).toBeGreaterThan(0);

    res = await SELF.fetch(
      `${BASE}/sub/u/${user.token}?view=html`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("?target=clash");

    res = await SELF.fetch(`${BASE}/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ dailyReqLimit: 2 }),
    });
    expect(res.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    await kv.put(`qproxy:user-usage:${today}`, JSON.stringify([{ token: user.token, count: 2 }]));
    res = await SELF.fetch(`${BASE}/sub/u/${user.token}?target=surge`);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);

    res = await SELF.fetch(`${BASE}/api/users/${user.id}/regenerate-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const freshToken = (await body(res)).data.token as string;
    expect(freshToken).not.toBe(user.token);

    res = await SELF.fetch(`${BASE}/api/users/${user.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-Q-Panel": "1" },
    });
    expect(res.status).toBe(200);
    res = await SELF.fetch(`${BASE}/api/users/${user.id}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});
