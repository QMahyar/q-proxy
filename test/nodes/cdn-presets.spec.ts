import { describe, expect, it } from "vitest";
import { CDN_PRESETS } from "../../src/nodes/cdn-presets";
import { CF_PLAIN_PORTS, CF_TLS_PORTS } from "../../src/types/settings";

const CF_PORTS = new Set<number>([...CF_TLS_PORTS, ...CF_PLAIN_PORTS]);

describe("CDN_PRESETS shipped contract", () => {
  it("pins stable unique ids with labels", () => {
    const ids = CDN_PRESETS.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CDN_PRESETS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.label).toContain(`${p.ip}:${p.port}`);
    }
  });

  it("keeps every preset port inside the Cloudflare families", () => {
    expect(CDN_PRESETS.length).toBeGreaterThan(0);
    for (const p of CDN_PRESETS) {
      expect(CF_PORTS.has(p.port), `${p.id} port ${p.port}`).toBe(true);
    }
  });

  it("covers both TLS and plain families", () => {
    const ports = new Set(CDN_PRESETS.map((p) => p.port));
    expect([...ports].some((p) => (CF_TLS_PORTS as readonly number[]).includes(p))).toBe(true);
    expect([...ports].some((p) => (CF_PLAIN_PORTS as readonly number[]).includes(p))).toBe(true);
  });
});
