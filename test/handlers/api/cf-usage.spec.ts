import { describe, expect, it, vi, afterEach } from "vitest";
import { handleCfUsage, isCfConfigured } from "../../../src/handlers/api/cf-usage";
import { invalidateSettingsCache, loadSettings } from "../../../src/settings/store";
import { makeTestSettings } from "../../helpers/settings";

class FakeKV {
  map = new Map<string, string>();

  async get(key: string, _options?: unknown): Promise<unknown> {
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as unknown);
  }

  async put(key: string, value: string, _options?: unknown): Promise<void> {
    this.map.set(key, value);
  }

  asEnv(): { QPROXY_KV: FakeKV } {
    return { QPROXY_KV: this };
  }
}

function post(body: unknown): Request {
  return new Request("https://panel.example/api/cf-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedCf(kv: FakeKV, url: string): Promise<void> {
  invalidateSettingsCache();
  const env = kv.asEnv() as never;
  const { saveSettings } = await import("../../../src/settings/store");
  const { validateSettings } = await import("../../../src/settings/validate");
  const base = makeTestSettings({ cf: { ...makeTestSettings().cf, usageApiUrl: url } });
  const v = validateSettings(JSON.parse(JSON.stringify(base)));
  expect(v.ok).toBe(true);
  if (v.ok) await saveSettings(env, v.value);
  invalidateSettingsCache();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isCfConfigured", () => {
  it("detects url, token, and legacy key-pair configuration", () => {
    const base = makeTestSettings().cf;
    expect(isCfConfigured({ cf: base })).toBe(false);
    expect(isCfConfigured({ cf: { ...base, usageApiUrl: "https://x.example/u" } })).toBe(true);
    expect(
      isCfConfigured({ cf: { ...base, apiToken: "t", accountId: "a".repeat(32) } }),
    ).toBe(true);
    expect(isCfConfigured({ cf: { ...base, apiToken: "t" } })).toBe(false);
    expect(isCfConfigured({ cf: { ...base, email: "a@b.co", globalApiKey: "k", accountId: "a".repeat(32) } })).toBe(
      true,
    );
  });
});

describe("handleCfUsage refresh", () => {
  it("refreshes from usageApiUrl and persists the snapshot", async () => {
    const kv = new FakeKV();
    await seedCf(kv, "https://usage.example.com/cf.json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, pages: 11, workers: 22, total: 33, max: 100 }), { status: 200 }),
      ),
    );
    const env = kv.asEnv() as never;
    const res = await handleCfUsage(post({}), env, makeTestSettings());
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: Record<string, unknown> }).data;
    expect(data.refreshed).toBe(true);
    expect(data.configured).toBe(true);
    const snap = data.cfUsage as Record<string, unknown>;
    expect(snap.pages).toBe(11);
    expect(snap.total).toBe(33);
    expect(typeof snap.updatedAt).toBe("number");
    const stored = await loadSettings(env);
    expect(stored.cfUsage).toMatchObject({ pages: 11, total: 33 });
  });

  it("applies an inline cf patch before refreshing", async () => {
    const kv = new FakeKV();
    await seedCf(kv, "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true, pages: 1, workers: 2, total: 3, max: 9 }), { status: 200 })),
    );
    const env = kv.asEnv() as never;
    const res = await handleCfUsage(post({ cf: { usageApiUrl: "https://usage.example.com/cf.json" } }), env, makeTestSettings());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: Record<string, unknown> }).data.refreshed).toBe(true);
    const stored = await loadSettings(env);
    expect(stored.cf.usageApiUrl).toBe("https://usage.example.com/cf.json");
    expect(stored.cfUsage).toMatchObject({ total: 3 });
  });
});
