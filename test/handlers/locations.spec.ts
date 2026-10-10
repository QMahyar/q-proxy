import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCATIONS_CACHE_TTL_SECONDS,
  LOCATIONS_MAX_BYTES,
  fetchLocationsText,
  handleLocations,
} from "../../src/handlers/api/locations";

function stubResponse(body: string, status = 200, contentLength: string | null = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentLength === null ? {} : { "content-length": contentLength }),
    text: async () => body,
    body: null,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLocationsText", () => {
  it("returns the upstream body", async () => {
    const fetchFn = vi.fn(async () => stubResponse('[{"iata":"FRA"}]'));
    const r = await fetchLocationsText(fetchFn as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, value: '[{"iata":"FRA"}]' });
  });

  it("caps oversize and failing upstreams without throwing", async () => {
    const big = vi.fn(async () => stubResponse("x", 200, String(2 * 1024 * 1024)));
    expect((await fetchLocationsText(big as unknown as typeof fetch)).ok).toBe(false);
    const down = vi.fn(async () => stubResponse("err", 500));
    expect((await fetchLocationsText(down as unknown as typeof fetch)).ok).toBe(false);
  });

  it("times out instead of hanging", async () => {
    const hanging = vi.fn((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise<never>((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const r = await fetchLocationsText(hanging as unknown as typeof fetch, { timeoutMs: 20 });
    expect(r.ok).toBe(false);
  });
});

describe("handleLocations", () => {
  it("serves cached max-age JSON with the upstream locations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stubResponse('[{"iata":"FRA","city":"Frankfurt"}]')));
    const res = await handleLocations(
      new Request("https://panel.example/api/locations"),
      {} as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe(`public, max-age=${LOCATIONS_CACHE_TTL_SECONDS}`);
    const payload = (await res.json()) as { ok: boolean; data: { locations: unknown[] } };
    expect(payload.ok).toBe(true);
    expect(payload.data.locations).toEqual([{ iata: "FRA", city: "Frankfurt" }]);
    expect(LOCATIONS_MAX_BYTES).toBe(1024 * 1024);
  });

  it("maps non-array upstream payloads to 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stubResponse('{"nope":true}')));
    let caught: unknown = null;
    try {
      await handleLocations(new Request("https://panel.example/api/locations"), {} as never, {} as never);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 502, code: "UPSTREAM" });
  });

  it("maps upstream failure to 502 without leaking the url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stubResponse("err", 503)));
    let caught: unknown = null;
    try {
      await handleLocations(new Request("https://panel.example/api/locations"), {} as never, {} as never);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 502, code: "UPSTREAM" });
  });
});
