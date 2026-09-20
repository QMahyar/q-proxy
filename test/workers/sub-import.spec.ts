import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { SETTINGS_KEY, seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";
import { decodeBase64 } from "../../src/utils/base64";

const kv = testKv(env);

const SP = "importpath";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "import-horse-42";

const FOREIGN_A = "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@203.0.113.50:443?security=tls&type=ws#ext-a";
const FOREIGN_B = "vless://d342d11e-d424-4583-b36e-524ab1f0afa4@203.0.113.51:8443?security=tls&type=ws#ext-b";

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

async function customEndpoints(cookie: string): Promise<unknown> {
  const res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: cookie } });
  return (await body(res)).data.customEndpoints;
}

describe("foreign subscription import", () => {
  it("requires auth and CSRF, previews per-source without storing", async () => {
    const csrf = await setupAdmin();
    const cookieOnly = { Cookie: csrf.Cookie! };

    let res = await SELF.fetch(`${BASE}/api/sub-import`, post({ text: FOREIGN_A }));
    expect(res.status).toBe(401);

    res = await SELF.fetch(`${BASE}/api/sub-import`, post({ text: FOREIGN_A }, cookieOnly));
    expect(res.status).toBe(403);

    const before = await customEndpoints(csrf.Cookie!);
    res = await SELF.fetch(`${BASE}/api/sub-import`, post({ text: `${FOREIGN_A}\n\n${FOREIGN_B}` }, csrf));
    expect(res.status).toBe(200);
    const sources = (await body(res)).data.sources as Array<{ tag: string; endpoints: string[]; invalid: unknown[] }>;
    expect(sources.map((s) => s.tag)).toEqual(["Source 1", "Source 2"]);
    expect(sources[0]!.endpoints).toEqual(["203.0.113.50:443"]);
    expect(sources[1]!.endpoints).toEqual(["203.0.113.51:8443"]);
    expect(await customEndpoints(csrf.Cookie!)).toEqual(before);
  });

  it("confirmed endpoints serve in every format after save", async () => {
    const csrf = await setupAdmin();
    const existing = (await customEndpoints(csrf.Cookie!)) as string[];
    expect(existing).toEqual([]);

    let res = await SELF.fetch(`${BASE}/api/sub-import`, post({ text: FOREIGN_A }, csrf));
    const endpoints = ((await body(res)).data.sources as Array<{ endpoints: string[] }>).flatMap((s) => s.endpoints);

    res = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: csrf.Cookie! } });
    const rev = (await body(res)).data.rev as number;
    res = await SELF.fetch(`${BASE}/api/settings/save`, put({ customEndpoints: endpoints, baseRev: rev }, csrf));
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/sub?target=base64`);
    expect(res.status).toBe(200);
    const decoded = decodeBase64(await res.text());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    expect(new TextDecoder().decode(decoded.value)).toContain("203.0.113.50:443");

    res = await SELF.fetch(`${BASE}/sub?target=clash`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("203.0.113.50");
  });
});
