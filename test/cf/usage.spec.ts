import { describe, expect, it, vi } from "vitest";
import { fetchCfUsage, parseUsageApiPayload } from "../../src/cf/usage";
import type { Settings } from "../../src/types/settings";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

function settings(): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    securePath: "sp12345678",
    sessionSecret: "x".repeat(64),
  };
}

function stubResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => body,
    body: null,
  } as unknown as Response;
}

describe("parseUsageApiPayload", () => {
  it("parses a full usageApiUrl JSON body", () => {
    const r = parseUsageApiPayload({ success: true, pages: 10, workers: 20, total: 30, max: 100 });
    expect(r).toEqual({ ok: true, value: { success: true, pages: 10, workers: 20, total: 30, max: 100 } });
  });

  it("rejects malformed payloads without throwing", () => {
    for (const bad of [null, [], "x", {}, { success: true }, { success: true, pages: -1, workers: 0, total: 0, max: 1 }]) {
      expect(parseUsageApiPayload(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(() => parseUsageApiPayload(null)).not.toThrow();
  });
});

describe("fetchCfUsage", () => {
  it("prefers usageApiUrl over keys", async () => {
    const s = settings();
    s.cf.usageApiUrl = "https://usage.example.com/cf.json";
    s.cf.apiToken = "token-secret";
    s.cf.accountId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://usage.example.com/cf.json");
      return stubResponse(JSON.stringify({ success: true, pages: 1, workers: 2, total: 3, max: 100 }));
    });
    const r = await fetchCfUsage(s, fetchFn as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ success: true, pages: 1, workers: 2, total: 3, max: 100 });
      expect(r.value.updatedAt).toBeGreaterThan(0);
    }
  });

  it("returns unconfigured when neither url nor keys are present", async () => {
    const fetchFn = vi.fn(async () => stubResponse("{}"));
    const r = await fetchCfUsage(settings(), fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, reason: "cloudflare usage is not configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("queries GraphQL with a token and maps the request total", async () => {
    const s = settings();
    s.cf.apiToken = "token-secret";
    s.cf.accountId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let seenAuth = "";
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenAuth = headers.get("Authorization") ?? "";
      return stubResponse(
        JSON.stringify({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 4321 } }] }] } } }),
      );
    });
    const r = await fetchCfUsage(s, fetchFn as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.total).toBe(4321);
    expect(seenAuth).toBe("Bearer token-secret");
  });

  it("never leaks keys in reasons", async () => {
    const s = settings();
    s.cf.usageApiUrl = "https://usage.example.com/cf.json?token=s3cret";
    const fetchFn = vi.fn(async () => stubResponse("not json", 200));
    const r = await fetchCfUsage(s, fetchFn as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toContain("s3cret");
      expect(r.reason).not.toContain("token=");
    }
  });

  it("times out instead of hanging", async () => {
    const s = settings();
    s.cf.usageApiUrl = "https://usage.example.com/cf.json";
    const hanging = vi.fn((_url: string | URL | Request, opts: { signal: AbortSignal }) => {
      return new Promise<never>((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const r = await fetchCfUsage(s, hanging as unknown as typeof fetch, { timeoutMs: 20 });
    expect(r.ok).toBe(false);
  });
});
