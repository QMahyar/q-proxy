import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "proxycheckpath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "proxycheck-horse-42";

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

describe("proxy-check API", () => {
  it("requires auth (and CSRF for POST)", async () => {
    const csrf = await setupAdmin();
    const cookieOnly = { Cookie: csrf.Cookie! };

    let res = await SELF.fetch(
      `${BASE}/api/proxy-check`,
      post({ protocol: "socks5", param: "u:p@203.0.113.7:1080" }),
    );
    expect(res.status).toBe(401);

    res = await SELF.fetch(
      `${BASE}/api/proxy-check`,
      post({ protocol: "socks5", param: "u:p@203.0.113.7:1080" }, cookieOnly),
    );
    expect(res.status).toBe(403);
  });

  it("validates input with field errors and no credential leak", async () => {
    const csrf = await setupAdmin();
    let res = await SELF.fetch(
      `${BASE}/api/proxy-check`,
      post({ protocol: "socks4", param: "u:p@203.0.113.7:1080" }, csrf),
    );
    expect(res.status).toBe(422);
    expect((await body(res)).fields.protocol).toBeTruthy();

    res = await SELF.fetch(`${BASE}/api/proxy-check`, post({ protocol: "http", param: "nope" }, csrf));
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw).not.toContain("secret");
  });

  it("rejects local proxy hosts and unsupported check protocols", async () => {
    const csrf = await setupAdmin();
    let res = await SELF.fetch(
      `${BASE}/api/proxy-check`,
      post({ protocol: "socks5", param: "u:p@127.0.0.1:1080" }, csrf),
    );
    expect(res.status).toBe(400);

    res = await SELF.fetch(
      `${BASE}/api/proxy-check`,
      post({ protocol: "turn", param: "u:p@203.0.113.7:3478" }, csrf),
    );
    expect(res.status).toBe(501);
  });
});
