import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "cfusagepath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "cfusage-horse-42";

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

async function setupAdmin(): Promise<Record<string, string>> {
  await seed(kv, SP);
  const res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
  expect(res.status).toBe(200);
  const raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { data: Record<string, unknown> };
  raw.data.passwordIsBootstrap = false;
  await kv.put(SETTINGS_KEY, JSON.stringify(raw));
  invalidateSettingsCache();
  const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  return { Cookie: cookie, "X-Q-Panel": "1" };
}

describe("cf-usage API", () => {
  it("requires auth (and CSRF for POST)", async () => {
    const csrf = await setupAdmin();
    const cookieOnly = { Cookie: csrf.Cookie! };

    let res = await SELF.fetch(`${BASE}/api/cf-usage`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/cf-usage`, post({}, cookieOnly));
    expect(res.status).toBe(403);
  });

  it("reads the cached snapshot on GET without fetching", async () => {
    const csrf = await setupAdmin();
    const res = await SELF.fetch(`${BASE}/api/cf-usage`, { headers: { Cookie: csrf.Cookie! } });
    expect(res.status).toBe(200);
    const data = (await body(res)).data;
    expect(data.cfUsage).toEqual({ success: false, pages: 0, workers: 0, total: 0, max: 0, updatedAt: 0 });
    expect(data.configured).toBe(false);
  });

  it("reports unconfigured on POST refresh without keys or url", async () => {
    const csrf = await setupAdmin();
    const res = await SELF.fetch(`${BASE}/api/cf-usage`, post({}, csrf));
    expect(res.status).toBe(200);
    const data = (await body(res)).data;
    expect(data.cfUsage).toEqual({ success: false, pages: 0, workers: 0, total: 0, max: 0, updatedAt: 0 });
    expect(data.refreshed).toBe(false);
    expect(data.configured).toBe(false);
  });

  it("leaks no keys in refresh responses", async () => {
    const csrf = await setupAdmin();
    const res = await SELF.fetch(
      `${BASE}/api/cf-usage`,
      post({ cf: { apiToken: "sekret-token", accountId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }, csrf),
    );
    expect([200, 422]).toContain(res.status);
    const raw = await res.text();
    expect(raw).not.toContain("sekret-token");
  });
});
