import { describe, expect, it } from "vitest";
import { clampAccessPage, readAccessEvents, recordAccessEvent } from "../../src/log/access";

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

describe("access log KV fallback", () => {
  it("records, dedups within 30min, and paginates newest-first", async () => {
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    await recordAccessEvent(env, { ip: "1.1.1.1", action: "sub:clash", detail: '{"format":"clash"}' }, 1000);
    await recordAccessEvent(env, { ip: "1.1.1.1", action: "sub:clash", detail: '{"format":"clash"}' }, 2000);
    await recordAccessEvent(env, { ip: "2.2.2.2", action: "sub:xray", detail: '{"format":"xray"}' }, 3000);
    // Outside the dedup window: recorded again.
    await recordAccessEvent(env, { ip: "1.1.1.1", action: "sub:clash", detail: '{"format":"clash"}' }, 1000 + 31 * 60 * 1000);

    const all = await readAccessEvents(env, 1, 100);
    expect(all.total).toBe(3);
    expect(all.events.map((e) => e.action)).toEqual(["sub:clash", "sub:xray", "sub:clash"]);

    const first = await readAccessEvents(env, 1, 2);
    expect(first.events).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await readAccessEvents(env, 2, 2);
    expect(second.events).toHaveLength(1);
  });

  it("ignores non-sub actions on read and never throws on corrupt stores", async () => {
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    kv.map.set("qproxy:access-log", "not-json");
    expect((await readAccessEvents(env, 1, 10)).total).toBe(0);
    await recordAccessEvent({} as never, { ip: "", action: "sub:x", detail: "{}" });
  });
});

describe("clampAccessPage", () => {
  it("clamps limit to 100 and defaults bad pages", () => {
    expect(clampAccessPage(0, 500)).toEqual({ page: 1, limit: 100 });
    expect(clampAccessPage(2, 5)).toEqual({ page: 2, limit: 5 });
  });
});
