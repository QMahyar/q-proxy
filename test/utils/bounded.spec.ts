import { describe, expect, it } from "vitest";
import { pruneBoundedRegistry } from "../../src/utils/bounded";

function admit(registry: Map<string, number>, limit: number, now: number, key: string): void {
  pruneBoundedRegistry(registry, limit - 1, now);
  registry.set(key, now + 600);
}

describe("pruneBoundedRegistry call-site contract", () => {
  it("holds exactly 2048 entries for SS salt registry semantics", () => {
    const registry = new Map<string, number>();
    const now = 1000;
    const limit = 2048;
    for (let i = 0; i < limit; i++) admit(registry, limit, now, `k${i}`);
    expect(registry.size).toBe(limit);
    admit(registry, limit, now, "k2048");
    expect(registry.size).toBe(limit);
    expect(registry.has("k0")).toBe(false);
    expect(registry.has("k2048")).toBe(true);
  });

  it("holds exactly 1024 entries for VMess replay registry semantics", () => {
    const registry = new Map<string, number>();
    const now = 2000;
    const limit = 1024;
    for (let i = 0; i < limit; i++) admit(registry, limit, now, `a${i}`);
    expect(registry.size).toBe(limit);
    admit(registry, limit, now, "a1024");
    expect(registry.size).toBe(limit);
    expect(registry.has("a0")).toBe(false);
  });

  it("evicts expired entries before counting toward limit", () => {
    const registry = new Map<string, number>();
    const now = 3000;
    registry.set("expired", now - 1);
    registry.set("alive", now + 100);
    pruneBoundedRegistry(registry, 10, now);
    expect(registry.has("expired")).toBe(false);
    expect(registry.has("alive")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("prune then set never exceeds limit with interleaved expiries", () => {
    const registry = new Map<string, number>();
    const limit = 5;
    let now = 4000;
    for (let i = 0; i < 20; i++) {
      now += 1;
      admit(registry, limit, now, `k${i}`);
      expect(registry.size).toBeLessThanOrEqual(limit);
    }
    expect(registry.size).toBe(limit);
  });
});
