import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "camopath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "camo-horse-42";

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

async function setCamouflage(csrf: Record<string, string>, camouflage: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}/api/settings/save`, put({ camouflage }, csrf));
}

describe("camouflage modes", () => {
  it("serves static bytes for static and nginx, 404 for off", async () => {
    const csrf = await setupAdmin();
    for (const mode of ["static", "nginx"] as const) {
      const saved = await setCamouflage(csrf, { mode, reverseUrl: "" });
      expect(saved.status, mode).toBe(200);
      const res = await SELF.fetch(`${BASE}/some/unknown/path`);
      expect(res.status, mode).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    }
    const saved = await setCamouflage(csrf, { mode: "off", reverseUrl: "" });
    expect(saved.status).toBe(200);
    expect((await SELF.fetch(`${BASE}/nope`)).status).toBe(404);
  });

  it("serves the minimal page for minimal", async () => {
    const csrf = await setupAdmin();
    expect((await setCamouflage(csrf, { mode: "minimal", reverseUrl: "" })).status).toBe(200);
    const res = await SELF.fetch(`${BASE}/nope`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("1101");
  });

  it("rejects reverse mode without an https URL at save time", async () => {
    const csrf = await setupAdmin();
    for (const reverseUrl of ["", "http://example.com", "not-a-url"]) {
      const res = await setCamouflage(csrf, { mode: "reverse", reverseUrl });
      expect(res.status, reverseUrl).toBe(422);
      expect((await body(res)).fields["camouflage.reverseUrl"]).toBeTruthy();
    }
    const ok = await setCamouflage(csrf, { mode: "reverse", reverseUrl: "https://127.0.0.1/blocked" });
    expect(ok.status).toBe(422);
  });

  it("fails safe to the static page for invalid stored reverse config", async () => {
    const csrf = await setupAdmin();
    // Seeded past validation (saves reject it): the loader self-heals to
    // defaults instead of serving a broken reverse mode. The handler's own
    // 503/502 guards stay covered by unit tests with crafted settings.
    const raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { data: Record<string, unknown> };
    raw.data.camouflage = { mode: "reverse", reverseUrl: "" };
    await kv.put(SETTINGS_KEY, JSON.stringify(raw));
    invalidateSettingsCache();
    const res = await SELF.fetch(`${BASE}/nope`, { headers: { Cookie: csrf.Cookie! } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});
