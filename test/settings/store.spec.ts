import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "../../src/types/settings";
import {
  ensureInitialized,
  invalidateSettingsCache,
  loadSettings,
  saveSettings,
} from "../../src/settings/store";
import {
  handleImportSettings,
  handleResetSettings,
  handleSaveSettings,
} from "../../src/handlers/api/settings";
import { handleKillSwitch } from "../../src/handlers/api/status";

class FakeKV {
  map = new Map<string, string>();
  getCalls = 0;
  putCalls = new Map<string, number>();

  async get(key: string): Promise<unknown> {
    this.getCalls += 1;
    const raw = this.map.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }

  async put(key: string, value: string): Promise<void> {
    this.putCalls.set(key, (this.putCalls.get(key) ?? 0) + 1);
    this.map.set(key, value);
  }

  asEnv(): { QPROXY_KV: unknown } {
    return { QPROXY_KV: this };
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("settings store", () => {
  it("seeds identity on first load and persists the wrapped blob", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const s = await loadSettings(kv.asEnv() as never);
    expect(s.securePath).toMatch(/^[0-9a-f]{24}$/);
    expect(s.sessionSecret).toMatch(/^[0-9a-f]{128}$/);
    expect(s.vlessUuid).toMatch(/^[0-9a-f-]{36}$/);
    const blob = JSON.parse(kv.map.get("qproxy:settings")!);
    expect(blob.version).toBe(SETTINGS_VERSION);
    expect(typeof blob.updatedAt).toBe("number");
    expect(blob.data.securePath).toBe(s.securePath);
  });

  it("caches reads for the 60 second TTL", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    await loadSettings(kv.asEnv() as never);
    expect(kv.getCalls).toBe(1);
    await loadSettings(kv.asEnv() as never);
    expect(kv.getCalls).toBe(1);
    vi.useFakeTimers();
    vi.advanceTimersByTime(60_001);
    await loadSettings(kv.asEnv() as never);
    expect(kv.getCalls).toBeGreaterThanOrEqual(2);
  });

  it("saveSettings stamps version and updatedAt and bypasses the cache", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const s = await loadSettings(kv.asEnv() as never);
    s.profileTitle = "Saved Title";
    await saveSettings(kv.asEnv() as never, s);
    const blob = JSON.parse(kv.map.get("qproxy:settings")!);
    expect(blob.data.profileTitle).toBe("Saved Title");
    expect(blob.version).toBe(SETTINGS_VERSION);
    expect(blob.updatedAt).toBeGreaterThanOrEqual(0);
    const reloaded = await loadSettings(kv.asEnv() as never);
    expect(reloaded.profileTitle).toBe("Saved Title");
  });

  it("writes every saveSettings call so cross-isolate writes are never shadowed", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const s = await loadSettings(kv.asEnv() as never);
    kv.putCalls.set("qproxy:settings", 0);
    await saveSettings(kv.asEnv() as never, structuredClone(s));
    expect(kv.putCalls.get("qproxy:settings")).toBe(1);
    await saveSettings(kv.asEnv() as never, structuredClone(s));
    expect(kv.putCalls.get("qproxy:settings")).toBe(2);
    await saveSettings(kv.asEnv() as never, { ...structuredClone(s), profileTitle: "Changed" });
    expect(kv.putCalls.get("qproxy:settings")).toBe(3);
  });

  it("ensureInitialized writes the meta row exactly once", async () => {
    const kv = new FakeKV();
    await ensureInitialized(kv.asEnv() as never);
    await ensureInitialized(kv.asEnv() as never);
    const meta = JSON.parse(kv.map.get("qproxy:meta")!);
    expect(typeof meta.createdAt).toBe("number");
    expect(typeof meta.installedVersion).toBe("string");
    expect(kv.putCalls.get("qproxy:meta")).toBe(1);
  });

  it("ensureInitialized leaves an existing meta row untouched", async () => {
    const kv = new FakeKV();
    kv.map.set(
      "qproxy:meta",
      JSON.stringify({ createdAt: 1234567890, installedVersion: "9.9.9" }),
    );
    await ensureInitialized(kv.asEnv() as never);
    expect(kv.putCalls.get("qproxy:meta")).toBeUndefined();
    const meta = JSON.parse(kv.map.get("qproxy:meta")!);
    expect(meta.installedVersion).toBe("9.9.9");
  });

  it("saveSettings starts rev at 1 for legacy blobs and increments on every save", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const s = await loadSettings(kv.asEnv() as never);
    expect(JSON.parse(kv.map.get("qproxy:settings")!).rev).toBe(0);
    expect(await saveSettings(kv.asEnv() as never, s)).toBe(1);
    expect(await saveSettings(kv.asEnv() as never, s)).toBe(2);
    const blob = JSON.parse(kv.map.get("qproxy:settings")!);
    expect(blob.rev).toBe(2);
    expect(blob.data.profileTitle).toBe(s.profileTitle);
  });

  it("saveSettings treats a missing or invalid rev as 0", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const s = await loadSettings(kv.asEnv() as never);
    const blob = JSON.parse(kv.map.get("qproxy:settings")!);
    blob.rev = "bogus";
    kv.map.set("qproxy:settings", JSON.stringify(blob));
    expect(await saveSettings(kv.asEnv() as never, s)).toBe(1);
    expect(JSON.parse(kv.map.get("qproxy:settings")!).rev).toBe(1);
  });

  it("handleSaveSettings merges fresh KV state instead of the stale isolate cache", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    const stale = await loadSettings(env);
    const concurrent = JSON.parse(kv.map.get("qproxy:settings")!);
    concurrent.data.profileTitle = "concurrent-title";
    kv.map.set("qproxy:settings", JSON.stringify(concurrent));
    const req = new Request("https://panel.example/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urlTestIntervalSec: 600 }),
    });
    const res = await handleSaveSettings(req, env, stale);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { saved: boolean; rev: number } };
    expect(payload.data.saved).toBe(true);
    expect(payload.data.rev).toBe(1);
    const stored = JSON.parse(kv.map.get("qproxy:settings")!);
    expect(stored.rev).toBe(1);
    expect(stored.data.profileTitle).toBe("concurrent-title");
    expect(stored.data.urlTestIntervalSec).toBe(600);
  });

  it("handleKillSwitch merges fresh KV state instead of the stale isolate cache", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    const stale = await loadSettings(env);
    const concurrent = JSON.parse(kv.map.get("qproxy:settings")!);
    concurrent.data.profileTitle = "concurrent-title";
    kv.map.set("qproxy:settings", JSON.stringify(concurrent));
    const req = new Request("https://panel.example/api/killswitch", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Q-Panel": "1" },
      body: JSON.stringify({ enabled: true }),
    });
    const res = await handleKillSwitch(req, env, stale);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { killSwitch: boolean; rev: number } };
    expect(payload.data.killSwitch).toBe(true);
    expect(typeof payload.data.rev).toBe("number");
    const stored = JSON.parse(kv.map.get("qproxy:settings")!);
    expect(stored.data.killSwitch).toBe(true);
    expect(stored.data.profileTitle).toBe("concurrent-title");
  });

  it("handleResetSettings preserves fresh identity fields instead of the stale isolate cache", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    const stale = await loadSettings(env);
    const concurrent = JSON.parse(kv.map.get("qproxy:settings")!);
    concurrent.data.language = "en";
    concurrent.data.trojanPassword = "concurrent-trojan-pass-1";
    kv.map.set("qproxy:settings", JSON.stringify(concurrent));
    const req = new Request("https://panel.example/api/settings/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await handleResetSettings(req, env, stale);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { saved: boolean; rev: number } };
    expect(payload.data.saved).toBe(true);
    expect(typeof payload.data.rev).toBe("number");
    const stored = JSON.parse(kv.map.get("qproxy:settings")!);
    expect(stored.data.language).toBe("en");
    expect(stored.data.trojanPassword).toBe("concurrent-trojan-pass-1");
    expect(stored.data.profileTitle).toBe(DEFAULT_SETTINGS.profileTitle);
  });

  it("handleImportSettings preserves fresh identity fields instead of the stale isolate cache", async () => {
    invalidateSettingsCache();
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    const stale = await loadSettings(env);
    const concurrent = JSON.parse(kv.map.get("qproxy:settings")!);
    concurrent.data.trojanPassword = "concurrent-trojan-pass-2";
    kv.map.set("qproxy:settings", JSON.stringify(concurrent));
    const req = new Request("https://panel.example/api/settings/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { profileTitle: "imported-title" } }),
    });
    const res = await handleImportSettings(req, env, stale);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: { saved: boolean; rev: number; imported: { profileTitle: string } };
    };
    expect(payload.data.saved).toBe(true);
    expect(payload.data.imported.profileTitle).toBe("imported-title");
    expect(typeof payload.data.rev).toBe("number");
    const stored = JSON.parse(kv.map.get("qproxy:settings")!);
    expect(stored.data.profileTitle).toBe("imported-title");
    expect(stored.data.trojanPassword).toBe("concurrent-trojan-pass-2");
  });
});
