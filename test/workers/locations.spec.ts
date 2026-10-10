import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "locationspath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "locations-horse-42";

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

describe("locations API", () => {
  it("requires auth and only serves GET", async () => {
    const csrf = await setupAdmin();

    let res = await SELF.fetch(`${BASE}/api/locations`);
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrf },
      body: "{}",
    });
    expect(res.status).toBe(405);
  });
});
