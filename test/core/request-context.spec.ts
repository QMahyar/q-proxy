import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayKeyUtc } from "../../src/utils/time";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { readFileSync } from "node:fs";

type CountersModule = typeof import("../../src/core/counters");
type LogModule = typeof import("../../src/core/log");

async function loadCounters(): Promise<CountersModule> {
  vi.resetModules();
  return await import("../../src/core/counters");
}

async function loadLog(): Promise<LogModule> {
  vi.resetModules();
  return await import("../../src/core/log");
}

function fakeCtx(): { ctx: ExecutionContext; seen: Promise<unknown>[] } {
  const seen: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>): void => {
      seen.push(p);
    },
  } as unknown as ExecutionContext;
  return { ctx, seen };
}

class MockKV {
  store = new Map<string, unknown>();

  async get(key: string, _format?: string): Promise<unknown> {
    const value = this.store.get(key);
    return value === undefined ? null : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, JSON.parse(value) as unknown);
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

describe("explicit request context (no globals)", () => {
  it("exposes no module-global context binders", async () => {
    const counters = await loadCounters();
    const log = await loadLog();
    expect((counters as Record<string, unknown>).bindCounterContext).toBeUndefined();
    expect((counters as Record<string, unknown>).getCounterContext).toBeUndefined();
    expect((log as Record<string, unknown>).bindAuditContext).toBeUndefined();
  });

  it("afterResponse runs each promise as its own request's I/O", async () => {
    const { afterResponse } = await loadCounters();
    const a = fakeCtx();
    const b = fakeCtx();
    afterResponse(a.ctx, Promise.resolve("a"));
    afterResponse(b.ctx, Promise.reject(new Error("b-ignored")));
    await Promise.allSettled([...a.seen, ...b.seen]);
    expect(a.seen.length).toBe(1);
    expect(b.seen.length).toBe(1);
    expect(a.seen[0]).not.toBe(b.seen[0]);
  });

  it("counter flush waitUntil is scoped to the flushing request", async () => {
    const { recordConnection } = await loadCounters();
    const kv = new MockKV();
    const env = kv.asEnv() as never;
    const a = fakeCtx();
    const b = fakeCtx();
    for (let i = 0; i < 32; i++) await recordConnection(env, undefined, a.ctx);
    expect(b.seen.length).toBe(0);
    expect(a.seen.length).toBeGreaterThan(0);
    await Promise.allSettled(a.seen);
    const stored = kv.store.get("qproxy:counters") as { requestsTotal: number; day: string };
    expect(stored.requestsTotal).toBe(32);
    expect(stored.day).toBe(dayKeyUtc());
  });

  it("audit inserts waitUntil on the auditing request only", async () => {
    const { audit } = await loadLog();
    let runs = 0;
    const db = {
      prepare: () => ({
        bind: () => ({
          run: () => {
            runs += 1;
            return Promise.resolve({});
          },
        }),
      }),
    } as unknown as D1Database;
    const a = fakeCtx();
    const b = fakeCtx();
    audit("ctx-a", { ip: "10.0.0.1" }, { QPROXY_DB: db }, a.ctx);
    audit("ctx-b", { ip: "10.0.0.2" }, { QPROXY_DB: db }, b.ctx);
    expect(runs).toBe(2);
    expect(a.seen.length).toBe(1);
    expect(b.seen.length).toBe(1);
    expect(a.seen[0]).not.toBe(b.seen[0]);
    await Promise.allSettled([...a.seen, ...b.seen]);
  });

  it("parks no tunnel lifetime past the response (waitUntil lives only in the bounded sinks)", () => {
    const tunnel = readFileSync("src/handlers/tunnel.ts", "utf8") as string;
    expect(tunnel).not.toContain("waitUntil");
    for (const file of ["src/core/counters.ts", "src/core/log.ts"]) {
      expect((readFileSync(file, "utf8") as string)).toContain("waitUntil");
    }
  });
});
