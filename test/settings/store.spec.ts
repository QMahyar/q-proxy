import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureInitialized,
  invalidateSettingsCache,
  loadSettings,
  saveSettings,
} from "../../src/settings/store";

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
    expect(blob.version).toBe(1);
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
    expect(blob.version).toBe(1);
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
});
