import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { seed, SETTINGS_KEY, testKv } from "../helpers/seed";

const kv = testKv(env);

const SP = "subtargets";
const BASE = `https://example.com/${SP}`;

async function seedAll(overrides: Record<string, unknown> = {}): Promise<void> {
  await seed(kv, SP, {
    vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
    randomizeSniCase: false,
    customEndpoints: ["203.0.113.10:443"],
    ...overrides,
  });
}

function get(path: string, ua?: string): Promise<Response> {
  const headers = new Headers();
  if (ua !== undefined) headers.set("user-agent", ua);
  return SELF.fetch(`${BASE}${path}`, { headers });
}

describe("subscribe targets (B1)", () => {
  it("serves target=mixed as base64 with identical bytes", async () => {
    await seedAll();
    const mixed = await get("/sub?target=mixed", "Surge iOS/2520");
    const base = await get("/sub?target=base64", "Surge iOS/2520");
    expect(mixed.status).toBe(200);
    expect(mixed.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await mixed.text()).toBe(await base.text());
  });

  it("honors the ?b64 and client flag shorthands", async () => {
    await seedAll();
    const b64 = await get("/sub?b64", "Surge iOS/2520");
    expect(b64.status).toBe(200);
    expect(b64.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const clash = await get("/sub?clash", "Surge iOS/2520");
    expect(clash.status).toBe(200);
    expect(clash.headers.get("Content-Type")).toContain("yaml");
    const sb = await get("/sub?sb", "Loon/3.2.4");
    expect(sb.status).toBe(200);
    expect(sb.headers.get("Content-Type")).toContain("json");
  });

  it("sniffs surge/quanx/loon UAs and answers 503 without a converter api", async () => {
    await seedAll();
    for (const ua of ["Surge iOS/2520", "Quantumult X/1.5.4", "Loon/3.2.4"]) {
      const res = await get("/sub", ua);
      expect(res.status, ua).toBe(503);
    }
    for (const target of ["surge", "quanx", "loon"]) {
      const res = await get(`/sub?target=${target}`);
      expect(res.status, target).toBe(503);
    }
  });

  it("ignores cnIspCode for native formats", async () => {
    await seedAll();
    const plain = await get("/sub?target=clash");
    const tagged = await get("/sub?target=clash&cnIspCode=ct");
    expect(tagged.status).toBe(200);
    expect(await tagged.text()).toBe(await plain.text());
  });

  it("rejects unknown targets with 400", async () => {
    await seedAll();
    const res = await get("/sub?target=hysteria");
    expect(res.status).toBe(400);
  });

  it("sends the profile headers with the subName download filename", async () => {
    await seedAll({ subName: "MySub" });
    const res = await get("/sub?target=clash");
    expect(res.status).toBe(200);
    expect(res.headers.get("Profile-Update-Interval")).toBe("12");
    expect(res.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''MySub.yaml");
    expect(res.headers.get("Profile-Title")).toContain("base64:");
  });

  it("keeps the default download filename when subName is empty", async () => {
    await seedAll();
    const res = await get("/sub?target=clash");
    expect(res.headers.get("Content-Disposition")).toContain("Q%20Proxy.yaml");
  });

  it("redirects the quick-sub alias to /sub preserving the query", async () => {
    await seedAll();
    const res = await SELF.fetch(`${BASE}/q?target=clash&cnIspCode=ct`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/${SP}/sub?target=clash&cnIspCode=ct`);
    const bare = await SELF.fetch(`${BASE}/q`, { redirect: "manual" });
    expect(bare.status).toBe(302);
    expect(bare.headers.get("Location")).toBe(`/${SP}/sub`);
  });

  it("keeps the subName setting out of the public settings view secrets", async () => {
    await seedAll({ subName: "MySub" });
    const raw = (await kv.get(SETTINGS_KEY)) as string | null;
    expect(raw).toContain("MySub");
  });
});
