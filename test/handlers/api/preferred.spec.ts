import { describe, expect, it, vi } from "vitest";
import { fetchPreferredText, serializePreferredEntry } from "../../../src/handlers/api/preferred";
import { parsePreferredLine } from "../../../src/nodes/preferred";

function stubResponse(body: string, status = 200, contentLength: string | null = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentLength === null ? {} : { "content-length": contentLength }),
    text: async () => body,
    body: null,
  } as unknown as Response;
}

describe("fetchPreferredText", () => {
  it("returns the body for a small ok response", async () => {
    const fetchFn = vi.fn(async () => stubResponse("1.2.3.4:443\n"));
    const r = await fetchPreferredText("https://example.com/a.txt", fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, value: "1.2.3.4:443\n" });
  });

  it("reports upstream status without throwing", async () => {
    const fetchFn = vi.fn(async () => stubResponse("nope", 500));
    const r = await fetchPreferredText("https://example.com/a.txt", fetchFn as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });

  it("rejects declared and streamed oversize bodies", async () => {
    const bigFetch = vi.fn(async () => stubResponse("x", 200, String(512 * 1024)));
    expect((await fetchPreferredText("https://example.com/a.txt", bigFetch as unknown as typeof fetch)).ok).toBe(
      false,
    );
    const streamFetch = vi.fn(async () => stubResponse("y".repeat(300 * 1024), 200));
    const r = await fetchPreferredText(
      "https://example.com/a.txt",
      streamFetch as unknown as typeof fetch,
      { maxBytes: 1024 },
    );
    expect(r).toEqual({ ok: false, reason: "preferred list response too large" });
  });

  it("times out instead of hanging", async () => {
    const hanging = vi.fn((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise<never>((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const r = await fetchPreferredText("https://example.com/a.txt", hanging as unknown as typeof fetch, {
      timeoutMs: 20,
    });
    expect(r.ok).toBe(false);
  });
});

describe("serializePreferredEntry", () => {
  it("exposes the parsed shape without secrets", () => {
    const parsed = parsePreferredLine("sub://5.6.7.8:8443#home?proxyip=true");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const view = serializePreferredEntry(parsed.value);
    expect(view).toEqual({
      kind: "sub",
      host: "5.6.7.8",
      port: 8443,
      remark: "home",
      chain: null,
      proxyIp: true,
      wildcard: false,
      url: "",
      raw: "sub://5.6.7.8:8443#home?proxyip=true",
    });
    expect(JSON.stringify(view)).not.toContain("passwordHash");
  });
});
