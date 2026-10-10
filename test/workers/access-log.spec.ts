import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "accesslogpath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "accesslog-horse-42";

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

async function totalEvents(csrf: Record<string, string>): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const res = await SELF.fetch(`${BASE}/api/access-log?limit=100`, { headers: { Cookie: csrf.Cookie! } });
    expect(res.status).toBe(200);
    const total = ((await body(res)).data.total as number) ?? -1;
    if (total > 0) return total;
    await new Promise((r) => setTimeout(r, 50));
  }
  return -1;
}

describe("access-log API", () => {
  it("requires auth and only serves GET", async () => {
    const csrf = await setupAdmin();

    let res = await SELF.fetch(`${BASE}/api/access-log`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/access-log`, post({}, csrf));
    expect(res.status).toBe(405);
  });

  it("records served subscriptions and dedups rapid repeats", async () => {
    const csrf = await setupAdmin();
    const before = await totalEvents(csrf).catch(() => 0);

    let res = await SELF.fetch(`${BASE}/sub?target=clash`);
    expect(res.status).toBe(200);
    res = await SELF.fetch(`${BASE}/sub?target=clash`);
    expect(res.status).toBe(200);

    const after = await totalEvents(csrf);
    expect(after).toBeGreaterThan(0);
    expect(after - Math.max(0, before)).toBeLessThanOrEqual(1);

    res = await SELF.fetch(`${BASE}/api/access-log?limit=100`, { headers: { Cookie: csrf.Cookie! } });
    const data = (await body(res)).data;
    const clash = (data.events as Array<{ action: string }>).filter((e) => e.action === "sub:clash");
    expect(clash.length).toBeGreaterThanOrEqual(1);
    expect(clash.length).toBeLessThanOrEqual(2);
  });

  it("paginates with page/limit caps and echoes sane defaults", async () => {
    const csrf = await setupAdmin();
    const res = await SELF.fetch(`${BASE}/api/access-log?page=abc&limit=500`, {
      headers: { Cookie: csrf.Cookie! },
    });
    expect(res.status).toBe(200);
    const data = (await body(res)).data;
    expect(data.page).toBe(1);
    expect(data.limit).toBe(100);
    expect(Array.isArray(data.events)).toBe(true);
    expect(typeof data.total).toBe("number");
    for (const e of data.events as Array<Record<string, unknown>>) {
      expect(typeof e.ts).toBe("number");
      expect(typeof e.action).toBe("string");
    }
    const raw = await SELF.fetch(`${BASE}/api/access-log?page=1&limit=2`, { headers: { Cookie: csrf.Cookie! } });
    const page = (await body(raw)).data;
    expect(page.events.length).toBeLessThanOrEqual(2);
  });
});
