import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATELIMIT_BURST,
  RATELIMIT_MAX_CONNECTIONS,
  RATELIMIT_PREFIX,
  RATELIMIT_TTL_SECONDS,
  RATELIMIT_WINDOW_MS,
  consumeBucket,
  ratelimitKey,
  tryConsume,
} from "../../src/tunnel/ratelimit";

class FakeKV {
  map = new Map<string, string>();
  ttls: Array<number | undefined> = [];
  failGet = false;
  failPut = false;

  async get(key: string, _type?: unknown): Promise<unknown> {
    if (this.failGet) throw new Error("kv down");
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as unknown);
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (this.failPut) throw new Error("kv down");
    this.map.set(key, value);
    this.ttls.push(options?.expirationTtl);
  }

  asEnv(): { QPROXY_KV: FakeKV } {
    return { QPROXY_KV: this };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tryConsume KV gate", () => {
  it("allows a full burst then denies with a retry hint while other keys stay open", async () => {
    const kv = new FakeKV();
    const env = kv.asEnv();
    for (let i = 0; i < RATELIMIT_BURST; i++) {
      const decision = await tryConsume(env, "user-a");
      expect(decision).toEqual({ allowed: true, retryAfterMs: 0 });
    }
    const denied = await tryConsume(env, "user-a");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(await tryConsume(env, "user-b")).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("keys state per window with a short TTL", async () => {
    const kv = new FakeKV();
    await tryConsume(kv.asEnv(), "deadbeef");
    expect(ratelimitKey("deadbeef", 0)).toBe(`${RATELIMIT_PREFIX}deadbeef:0`);
    expect([...kv.map.keys()]).toEqual([ratelimitKey("deadbeef", Date.now())]);
    expect(kv.ttls).toEqual([RATELIMIT_TTL_SECONDS]);
  });

  it("starts a fresh window after the window rolls over", async () => {
    const kv = new FakeKV();
    const env = kv.asEnv();
    for (let i = 0; i < RATELIMIT_BURST; i++) await tryConsume(env, "user-d");
    expect((await tryConsume(env, "user-d")).allowed).toBe(false);
    vi.advanceTimersByTime(RATELIMIT_WINDOW_MS);
    for (let i = 0; i < RATELIMIT_BURST; i++) {
      expect((await tryConsume(env, "user-d")).allowed).toBe(true);
    }
  });

  it("refills tokens as time passes within the window", async () => {
    const kv = new FakeKV();
    const env = kv.asEnv();
    for (let i = 0; i < RATELIMIT_BURST; i++) await tryConsume(env, "user-c");
    expect((await tryConsume(env, "user-c")).allowed).toBe(false);
    vi.advanceTimersByTime(Math.ceil(RATELIMIT_WINDOW_MS / RATELIMIT_MAX_CONNECTIONS) + 100);
    const refilled = await tryConsume(env, "user-c");
    expect(refilled.allowed).toBe(true);
    expect(refilled.retryAfterMs).toBe(0);
  });

  it("fails open when the KV read throws", async () => {
    const kv = new FakeKV();
    kv.failGet = true;
    expect(await tryConsume(kv.asEnv(), "user-e")).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("still reports the computed decision when the KV write throws", async () => {
    const kv = new FakeKV();
    kv.failPut = true;
    const first = await tryConsume(kv.asEnv(), "user-f");
    expect(first.allowed).toBe(true);
    expect(kv.map.size).toBe(0);
  });

  it("treats corrupt stored state as a fresh bucket", async () => {
    const variants: unknown[] = ["oops", [1, 2], { tokens: "many" }, { tokens: 5 }, { updatedAt: 1 }, null, 42];
    for (const [index, variant] of variants.entries()) {
      const kv = new FakeKV();
      kv.map.set(ratelimitKey("shady", Date.now()), JSON.stringify(variant));
      const decision = await tryConsume(kv.asEnv(), "shady");
      expect(decision.allowed, `variant ${index}`).toBe(true);
    }
  });
});

describe("consumeBucket pure refill", () => {
  it("drains the burst, denies with a retry hint, then refills", () => {
    const start = 1_000_000;
    let slot = consumeBucket(null, start);
    expect(slot.allowed).toBe(true);
    expect(slot.state.tokens).toBe(RATELIMIT_BURST - 1);
    for (let i = 1; i < RATELIMIT_BURST; i++) slot = consumeBucket(slot.state, start);
    expect(slot.state.tokens).toBe(0);
    const denied = consumeBucket(slot.state, start);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    const refilled = consumeBucket(denied.state, start + 10_000);
    expect(refilled.allowed).toBe(true);
    expect(refilled.retryAfterMs).toBe(0);
  });

  it("clamps negative stored tokens to empty instead of refilling", () => {
    const now = 2_000_000;
    expect(consumeBucket({ tokens: Number.NaN, updatedAt: now }, now).allowed).toBe(true);
    expect(consumeBucket({ tokens: Number.POSITIVE_INFINITY, updatedAt: now }, now).allowed).toBe(true);
    const fromNegative = consumeBucket({ tokens: -40, updatedAt: now }, now);
    expect(fromNegative.allowed).toBe(false);
    expect(fromNegative.retryAfterMs).toBeGreaterThan(0);
  });
});
