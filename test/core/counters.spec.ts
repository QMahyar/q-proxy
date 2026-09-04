import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afterResponse,
  bindCounterContext,
  getCounterContext,
  readUsage,
  recordConnection,
} from "../../src/core/counters";
import { dayKeyUtc } from "../../src/utils/time";

const KV_KEY = "qproxy:counters";

interface StoredCounters {
  day: string;
  requestsToday: number;
  requestsTotal: number;
}

class MockKV {
  store = new Map<string, unknown>();
  puts: Array<{ key: string; value: string }> = [];
  getCalls = 0;
  getFails = false;
  putFails = false;

  async get(key: string, _format?: string): Promise<unknown> {
    this.getCalls += 1;
    if (this.getFails) throw new Error("kv down");
    const value = this.store.get(key);
    return value === undefined ? null : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.puts.push({ key, value });
    if (this.putFails) throw new Error("kv put down");
    this.store.set(key, JSON.parse(value) as unknown);
  }

  seedStored(value: unknown): void {
    this.store.set(KV_KEY, value);
  }

  lastPut(): StoredCounters {
    return JSON.parse(this.puts[this.puts.length - 1]!.value) as StoredCounters;
  }

  asEnv(): unknown {
    return { QPROXY_KV: this };
  }
}

let now: number;

beforeEach(() => {
  now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  bindCounterContext(null as unknown as ExecutionContext);
});

describe("counter execution context", () => {
  it("binds, reads back, and unbinds the context", () => {
    expect(getCounterContext()).toBeNull();
    const ctx = { waitUntil: (_p: Promise<unknown>): void => {} } as unknown as ExecutionContext;
    bindCounterContext(ctx);
    expect(getCounterContext()).toBe(ctx);
    bindCounterContext(null as unknown as ExecutionContext);
    expect(getCounterContext()).toBeNull();
  });

  it("afterResponse forwards settlement to waitUntil when bound", async () => {
    const seen: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>): void => {
        seen.push(p);
      },
    } as unknown as ExecutionContext;
    bindCounterContext(ctx);
    afterResponse(Promise.resolve("ok"));
    afterResponse(Promise.reject(new Error("ignored")));
    await Promise.allSettled(seen);
    expect(seen.length).toBe(2);
  });

  it("afterResponse is a no-op without a bound context", async () => {
    bindCounterContext(null as unknown as ExecutionContext);
    afterResponse(Promise.resolve("ok"));
    await Promise.resolve();
    expect(getCounterContext()).toBeNull();
  });
});

describe("flush batching", () => {
  it("buffers connections and flushes once every 32", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    for (let i = 0; i < 31; i++) await recordConnection(env);
    expect(kv.getCalls).toBe(0);
    expect(kv.puts).toEqual([]);
    await recordConnection(env);
    expect(kv.getCalls).toBe(1);
    expect(kv.puts.length).toBe(1);
    expect(kv.puts[0]!.key).toBe(KV_KEY);
    expect(kv.lastPut().requestsToday).toBe(32);
    expect(kv.lastPut().requestsTotal).toBe(32);
    expect(kv.lastPut().day).toBe(dayKeyUtc());
  });
});

describe("usage memo", () => {
  it("memoizes the KV read for 15 seconds", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    now += 16_000;
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 3, requestsTotal: 10 });
    expect(await readUsage(env)).toMatchObject({ requestsToday: 3, requestsTotal: 10 });
    expect(kv.getCalls).toBe(1);
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 7, requestsTotal: 70 });
    expect(await readUsage(env)).toMatchObject({ requestsToday: 3, requestsTotal: 10 });
    expect(kv.getCalls).toBe(1);
    now += 16_000;
    expect(await readUsage(env)).toMatchObject({ requestsToday: 7, requestsTotal: 70 });
    expect(kv.getCalls).toBe(2);
  });
});

describe("day rollover", () => {
  it("resets the daily count when the stored day is stale", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    now += 16_000;
    kv.seedStored({ day: "2000-01-01", requestsToday: 5, requestsTotal: 10 });
    const usage = await readUsage(env);
    expect(usage.day).toBe(dayKeyUtc());
    expect(usage.requestsToday).toBe(0);
    expect(usage.requestsTotal).toBe(10);
  });

  it("treats a missing requestsToday as zero", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    now += 16_000;
    kv.seedStored({ day: dayKeyUtc(), requestsTotal: 4 });
    expect(await readUsage(env)).toMatchObject({ requestsToday: 0, requestsTotal: 4 });
  });

  it("falls back to zeros for malformed stored values", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    now += 16_000;
    kv.seedStored("garbage");
    expect(await readUsage(env)).toMatchObject({
      day: dayKeyUtc(),
      requestsToday: 0,
      requestsTotal: 0,
    });
    now += 16_000;
    kv.seedStored({ day: dayKeyUtc() });
    expect(await readUsage(env)).toMatchObject({ requestsToday: 0, requestsTotal: 0 });
  });
});

describe("buffer deltas", () => {
  it("adds unflushed buffer deltas to the memoized snapshot", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    now += 16_000;
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 3, requestsTotal: 10 });
    const before = await readUsage(env);
    await recordConnection(env);
    await recordConnection(env);
    const after = await readUsage(env);
    expect(after.requestsToday).toBe(before.requestsToday + 2);
    expect(after.requestsTotal).toBe(before.requestsTotal + 2);
    expect(after.day).toBe(before.day);
  });
});

describe("time-based flush", () => {
  it("flushes on the next connection after 60 seconds", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    now += 16_000;
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 3, requestsTotal: 10 });
    const before = await readUsage(env);
    const putsBefore = kv.puts.length;
    now += 61_000;
    await recordConnection(env);
    expect(kv.puts.length).toBe(putsBefore + 1);
    expect(kv.lastPut().requestsToday).toBe(before.requestsToday + 1);
    expect(kv.lastPut().requestsTotal).toBe(before.requestsTotal + 1);
  });
});

describe("KV failure resilience", () => {
  it("survives a failed flush put and keeps optimistic counts", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    now += 16_000;
    const before = await readUsage(env);
    kv.putFails = true;
    for (let i = 0; i < 32; i++) await recordConnection(env);
    expect(kv.puts.length).toBe(1);
    kv.putFails = false;
    const after = await readUsage(env);
    expect(after.requestsToday).toBe(before.requestsToday + 32);
    expect(after.requestsTotal).toBe(before.requestsTotal + 32);
  });

  it("rejects reads when KV get fails", async () => {
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.getFails = true;
    now += 16_000;
    await expect(readUsage(env)).rejects.toThrow("kv down");
    kv.getFails = false;
  });
});
