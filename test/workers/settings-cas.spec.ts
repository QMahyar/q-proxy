import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "caspath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "cas-horse-42";

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

async function currentRev(): Promise<number> {
  const raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { rev?: number };
  return raw.rev ?? 0;
}

describe("settings compare-and-swap", () => {
  it("reads expose the revision and saves echo it", async () => {
    const csrf = await setupAdmin();
    let res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: csrf.Cookie! } });
    expect(res.status).toBe(200);
    const before = (await body(res)).data.rev;
    expect(typeof before).toBe("number");

    res = await SELF.fetch(`${BASE}/api/bootstrap`, { headers: { Cookie: csrf.Cookie! } });
    expect((await body(res)).data.settings.rev).toBe(before);

    res = await SELF.fetch(`${BASE}/api/settings`, put({ profileTitle: "CAS One", baseRev: before }, csrf));
    expect(res.status).toBe(200);
    const saved = (await body(res)).data;
    expect(saved.saved).toBe(true);
    expect(saved.rev).toBe(before + 1);
    expect(await currentRev()).toBe(before + 1);
  });

  it("rejects a stale baseRev with 409 and applies nothing", async () => {
    const csrf = await setupAdmin();
    let res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: csrf.Cookie! } });
    const stale = (await body(res)).data.rev as number;

    res = await SELF.fetch(`${BASE}/api/settings`, put({ profileTitle: "Panel A wins", baseRev: stale }, csrf));
    expect(res.status).toBe(200);

    res = await SELF.fetch(
      `${BASE}/api/settings`,
      put({ profileTitle: "Panel B overwrites", baseRev: stale }, csrf),
    );
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe("CONFLICT");

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: csrf.Cookie! } });
    const view = (await body(res)).data;
    expect(view.profileTitle).toBe("Panel A wins");
    expect(view.rev).toBe(stale + 1);
    expect(await currentRev()).toBe(stale + 1);
  });

  it("saves without baseRev keep working (legacy writers)", async () => {
    const csrf = await setupAdmin();
    const res = await SELF.fetch(`${BASE}/api/settings`, put({ profileTitle: "No Rev Sent" }, csrf));
    expect(res.status).toBe(200);
    expect((await body(res)).data.saved).toBe(true);
  });
});
