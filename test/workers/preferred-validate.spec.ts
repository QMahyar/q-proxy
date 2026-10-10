import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "preferredpath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "preferred-horse-42";

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

const MIXED_TEXT = [
  "1.2.3.4:443#Tehran",
  "sub://5.6.7.8:8443#home?proxyip=true",
  "https://example.com/add.txt",
  "not a host!!",
].join("\n");

describe("preferred-validate API", () => {
  it("requires auth (and CSRF for POST)", async () => {
    const csrf = await setupAdmin();
    const cookieOnly = { Cookie: csrf.Cookie! };

    let res = await SELF.fetch(`${BASE}/api/preferred-validate`, post({ text: MIXED_TEXT }));
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/preferred-validate`, post({ text: MIXED_TEXT }, cookieOnly));
    expect(res.status).toBe(403);

    res = await SELF.fetch(`${BASE}/api/preferred-validate?text=1.2.3.4`);
    expect(res.status).toBe(401);
  });

  it("validates posted text with valid/invalid grouping", async () => {
    const csrf = await setupAdmin();
    const res = await SELF.fetch(`${BASE}/api/preferred-validate`, post({ text: MIXED_TEXT }, csrf));
    expect(res.status).toBe(200);
    const data = (await body(res)).data;
    expect(data.source).toBe("text");
    expect(data.valid.map((e: { raw: string }) => e.raw)).toEqual([
      "1.2.3.4:443#Tehran",
      "sub://5.6.7.8:8443#home?proxyip=true",
      "https://example.com/add.txt",
    ]);
    const flagged = data.valid.find((e: { proxyIp: boolean }) => e.proxyIp);
    expect(flagged.raw).toBe("sub://5.6.7.8:8443#home?proxyip=true");
    expect(data.invalid).toHaveLength(1);
    expect(data.invalid[0].line).toBe("not a host!!");
    expect(data.invalid[0].reason.length).toBeGreaterThan(0);
  });

  it("validates the stored list when neither url nor text is given", async () => {
    const csrf = await setupAdmin();
    let res = await SELF.fetch(`${BASE}/api/settings/save`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrf },
      body: JSON.stringify({ customEndpoints: ["9.9.9.9:443#stored"] }),
    });
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/preferred-validate`, post({}, csrf));
    expect(res.status).toBe(200);
    const data = (await body(res)).data;
    expect(data.source).toBe("stored");
    expect(data.valid.map((e: { raw: string }) => e.raw)).toEqual(["9.9.9.9:443#stored"]);

    res = await SELF.fetch(`${BASE}/api/preferred-validate`, { headers: { Cookie: csrf.Cookie! } });
    expect(res.status).toBe(200);
    expect((await body(res)).data.source).toBe("stored");
  });

  it("rejects malformed, non-http, and local remote urls without fetching", async () => {
    const csrf = await setupAdmin();
    for (const url of ["not-a-url", "ftp://example.com/a.txt", "http://127.0.0.1/a.txt", "https://localhost/a.txt"]) {
      const res = await SELF.fetch(`${BASE}/api/preferred-validate`, post({ url }, csrf));
      expect(res.status, url).toBe(400);
    }
  });

  it("leaks no secrets in the validation payload", async () => {
    const csrf = await setupAdmin();
    const res = await SELF.fetch(`${BASE}/api/preferred-validate`, post({ text: MIXED_TEXT }, csrf));
    expect(res.status).toBe(200);
    const raw = await res.text();
    for (const secret of ["passwordHash", "passwordSalt", "sessionSecret", "botToken", "securePath", "vlessUuid"]) {
      expect(raw).not.toContain(secret);
    }
  });
});
