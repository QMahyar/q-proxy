import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayKeyUtc } from "../../src/utils/time";

const KV_KEY = "qproxy:counters";

interface StoredCounters {
  day: string;
  requestsToday: number;
  requestsTotal: number;
  bytesUpTotal?: number;
  bytesDownTotal?: number;
}

type CountersModule = typeof import("../../src/core/counters");

async function loadCounters(): Promise<CountersModule> {
  vi.resetModules();
  return await import("../../src/core/counters");
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
  vi.resetModules();
});

describe("counter execution context", () => {
  it("binds, reads back, and unbinds the context", async () => {
    const { bindCounterContext, getCounterContext } = await loadCounters();
    expect(getCounterContext()).toBeNull();
    const ctx = { waitUntil: (_p: Promise<unknown>): void => {} } as unknown as ExecutionContext;
    bindCounterContext(ctx);
    expect(getCounterContext()).toBe(ctx);
    bindCounterContext(null as unknown as ExecutionContext);
    expect(getCounterContext()).toBeNull();
  });

  it("afterResponse forwards settlement to waitUntil when bound", async () => {
    const { afterResponse, bindCounterContext } = await loadCounters();
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
    const { afterResponse, getCounterContext } = await loadCounters();
    afterResponse(Promise.resolve("ok"));
    await Promise.resolve();
    expect(getCounterContext()).toBeNull();
  });
});

describe("flush batching", () => {
  it("buffers connections and flushes once every 32", async () => {
    const { recordConnection } = await loadCounters();
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
    const { readUsage } = await loadCounters();
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
    const { readUsage } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: "2000-01-01", requestsToday: 5, requestsTotal: 10 });
    const usage = await readUsage(env);
    expect(usage.day).toBe(dayKeyUtc());
    expect(usage.requestsToday).toBe(0);
    expect(usage.requestsTotal).toBe(10);
  });

  it("treats a missing requestsToday as zero", async () => {
    const { readUsage } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: dayKeyUtc(), requestsTotal: 4 });
    expect(await readUsage(env)).toMatchObject({ requestsToday: 0, requestsTotal: 4 });
  });

  it("falls back to zeros for malformed stored values", async () => {
    const { readUsage } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
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
    const { readUsage, recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
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
    const { readUsage, recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
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
    const { readUsage, recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
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
    const { readUsage } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.getFails = true;
    await expect(readUsage(env)).rejects.toThrow("kv down");
    kv.getFails = false;
  });
});

describe("byte accounting", () => {
  it("flushes accumulated byte deltas alongside the request counts", async () => {
    const { readUsage, recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    for (let i = 0; i < 31; i++) await recordConnection(env, { bytesUp: 100, bytesDown: 1000 });
    expect(kv.puts).toEqual([]);
    await recordConnection(env, { bytesUp: 100, bytesDown: 1000 });
    expect(kv.puts.length).toBe(1);
    expect(kv.lastPut()).toMatchObject({
      requestsToday: 32,
      requestsTotal: 32,
      bytesUpTotal: 3200,
      bytesDownTotal: 32000,
    });
    const usage = await readUsage(env);
    expect(usage.bytesUpTotal).toBe(3200);
    expect(usage.bytesDownTotal).toBe(32000);
  });

  it("merges unflushed byte deltas into usage reads", async () => {
    const { readUsage, recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 1, requestsTotal: 1, bytesUpTotal: 50, bytesDownTotal: 60 });
    await readUsage(env);
    await recordConnection(env, { bytesUp: 5, bytesDown: 6 });
    const usage = await readUsage(env);
    expect(usage).toMatchObject({ requestsToday: 2, requestsTotal: 2, bytesUpTotal: 55, bytesDownTotal: 66 });
  });

  it("defaults missing byte fields to zero for rows written before accounting", async () => {
    const { readUsage, recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 3, requestsTotal: 10 });
    expect(await readUsage(env)).toMatchObject({
      requestsToday: 3,
      requestsTotal: 10,
      bytesUpTotal: 0,
      bytesDownTotal: 0,
    });
    await recordConnection(env);
    const usage = await readUsage(env);
    expect(usage).toMatchObject({ requestsToday: 4, requestsTotal: 11, bytesUpTotal: 0, bytesDownTotal: 0 });
  });

  it("preserves byte totals across the daily rollover", async () => {
    const { readUsage } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: "2000-01-01", requestsToday: 5, requestsTotal: 10, bytesUpTotal: 70, bytesDownTotal: 80 });
    const usage = await readUsage(env);
    expect(usage.day).toBe(dayKeyUtc());
    expect(usage.requestsToday).toBe(0);
    expect(usage.requestsTotal).toBe(10);
    expect(usage.bytesUpTotal).toBe(70);
    expect(usage.bytesDownTotal).toBe(80);
  });

  it("flushes across midnight without resetting cumulative byte totals", async () => {
    const { recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: "2000-01-01", requestsToday: 9, requestsTotal: 9, bytesUpTotal: 7, bytesDownTotal: 8 });
    for (let i = 0; i < 32; i++) await recordConnection(env, { bytesUp: 1, bytesDown: 2 });
    const put = kv.lastPut();
    expect(put.day).toBe(dayKeyUtc());
    expect(put.requestsToday).toBe(32);
    expect(put.requestsTotal).toBe(41);
    expect(put.bytesUpTotal).toBe(39);
    expect(put.bytesDownTotal).toBe(72);
  });

  it("recordBytes accumulates bytes without counting requests", async () => {
    const { readUsage, recordBytes } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 3, requestsTotal: 10, bytesUpTotal: 50, bytesDownTotal: 60 });
    await recordBytes(env, { bytesUp: 5, bytesDown: 6 });
    expect(kv.puts).toEqual([]);
    const usage = await readUsage(env);
    expect(usage).toMatchObject({
      requestsToday: 3,
      requestsTotal: 10,
      bytesUpTotal: 55,
      bytesDownTotal: 66,
    });
  });

  it("recordBytes flushes on the staleness interval", async () => {
    const { recordBytes } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    kv.seedStored({ day: dayKeyUtc(), requestsToday: 3, requestsTotal: 10, bytesUpTotal: 50, bytesDownTotal: 60 });
    now += 61_000;
    await recordBytes(env, { bytesUp: 5, bytesDown: 6 });
    expect(kv.puts.length).toBe(1);
    expect(kv.lastPut()).toMatchObject({
      requestsToday: 3,
      requestsTotal: 10,
      bytesUpTotal: 55,
      bytesDownTotal: 66,
    });
  });
});
