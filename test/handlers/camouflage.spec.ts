import { describe, expect, it, vi, afterEach } from "vitest";
import { ASSETS } from "../../src/ui/assets";
import {
  CAMO_REVERSE_MAX_BYTES,
  CAMO_REVERSE_TIMEOUT_MS,
  fetchReverseText,
  handleCamouflage,
  rewriteReverseHosts,
} from "../../src/handlers/camouflage";
import { makeTestSettings } from "../helpers/settings";

function req(path = "/nope"): Request {
  return new Request(`https://panel.example${path}`);
}

function stubResponse(body: string, contentType: string | null, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType === null ? {} : { "content-type": contentType }),
    text: async () => body,
    body: null,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("camouflage mode matrix", () => {
  it("serves the static asset for static and nginx", async () => {
    for (const mode of ["static", "nginx"] as const) {
      const res = await handleCamouflage(req(), {} as never, makeTestSettings({ camouflage: { mode, reverseUrl: "" } }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(ASSETS.camo);
    }
  });

  it("serves a tiny 1101-style page for minimal", async () => {
    const res = await handleCamouflage(req(), {} as never, makeTestSettings({ camouflage: { mode: "minimal", reverseUrl: "" } }));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("1101");
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(1024);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("serves the identical static page for any unknown path (removed routes look untouched)", async () => {
    const a = await handleCamouflage(new Request("https://x/old-vm-path/abc12345"), {} as never, makeTestSettings({ camouflage: { mode: "static", reverseUrl: "" } }));
    const b = await handleCamouflage(new Request("https://x/totally-random-zzz"), {} as never, makeTestSettings({ camouflage: { mode: "static", reverseUrl: "" } }));
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it("never fetches an upstream except in reverse mode", async () => {
    const fetchFn = vi.fn(async () => stubResponse("evil", "text/html"));
    vi.stubGlobal("fetch", fetchFn);
    for (const mode of ["static", "nginx", "minimal"] as const) {
      await handleCamouflage(req(), {} as never, makeTestSettings({ camouflage: { mode, reverseUrl: "" } }));
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers 404 for off", async () => {
    let caught: unknown = null;
    try {
      await handleCamouflage(req(), {} as never, makeTestSettings({ camouflage: { mode: "off", reverseUrl: "" } }));
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("answers 503 when reverse has no URL configured", async () => {
    let caught: unknown = null;
    try {
      await handleCamouflage(req(), {} as never, makeTestSettings({ camouflage: { mode: "reverse", reverseUrl: "" } }));
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 503 });
  });
});

describe("reverse camouflage", () => {
  it("fetches upstream origin+request path and rewrites text hosts", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        seen.push(String(url));
        return stubResponse("<html><body><a href=\"https://origin.example/page\">x</a></body></html>", "text/html");
      }),
    );
    const s = makeTestSettings({ camouflage: { mode: "reverse", reverseUrl: "https://origin.example/blog" } });
    const res = await handleCamouflage(new Request("https://panel.example/some/path?q=1"), {} as never, s);
    expect(res.status).toBe(200);
    expect(seen).toEqual(["https://origin.example/some/path?q=1"]);
    const body = await res.text();
    expect(body).not.toContain("origin.example");
    expect(body).toContain("panel.example");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("passes non-text bodies through untouched", async () => {
    const png = "PNGDATA";
    vi.stubGlobal("fetch", vi.fn(async () => stubResponse(png, "image/png")));
    const s = makeTestSettings({ camouflage: { mode: "reverse", reverseUrl: "https://origin.example" } });
    const res = await handleCamouflage(req("/img.png"), {} as never, s);
    expect(await res.text()).toBe(png);
    expect(res.headers.get("Content-Type")).toContain("image/png");
  });

  it("upgrades http reverse URLs to https", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      return stubResponse("hello", "text/plain");
    }));
    const s = makeTestSettings({ camouflage: { mode: "reverse", reverseUrl: "http://origin.example" } });
    await handleCamouflage(req(), {} as never, s);
    expect(seen[0]!.startsWith("https://origin.example")).toBe(true);
  });

  it("refuses local reverse targets without fetching", async () => {
    const fetchFn = vi.fn(async () => stubResponse("x", "text/plain"));
    vi.stubGlobal("fetch", fetchFn);
    const s = makeTestSettings({ camouflage: { mode: "reverse", reverseUrl: "https://127.0.0.1/secret" } });
    let caught: unknown = null;
    try {
      await handleCamouflage(req(), {} as never, s);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 502 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps timeouts and oversize bodies to failures", async () => {
    const hanging = vi.fn((_url: string | URL | Request, opts: { signal: AbortSignal }) => {
      return new Promise<never>((_, reject) => {
        opts.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    expect(
      (await fetchReverseText("https://origin.example", hanging as unknown as typeof fetch, { timeoutMs: 20 })).ok,
    ).toBe(false);

    const big = vi.fn(async () => stubResponse("y".repeat(3 * 1024 * 1024), "text/html"));
    expect((await fetchReverseText("https://origin.example", big as unknown as typeof fetch)).ok).toBe(false);

    // The handler surfaces those failures as 502.
    vi.stubGlobal("fetch", hanging);
    const s = makeTestSettings({ camouflage: { mode: "reverse", reverseUrl: "https://127.0.0.2/slow" } });
    let caught: unknown = null;
    try {
      await handleCamouflage(req(), {} as never, s);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 502 });
  });

  it("exposes the documented timeout and cap constants", () => {
    expect(CAMO_REVERSE_TIMEOUT_MS).toBe(8000);
    expect(CAMO_REVERSE_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("rewriteReverseHosts", () => {
  it("replaces origin and bare host occurrences and never throws", () => {
    expect(
      rewriteReverseHosts(
        "go https://origin.example/a and origin.example/b",
        "https://origin.example",
        "origin.example",
        "https://panel.example",
        "panel.example",
      ),
    ).toBe("go https://panel.example/a and panel.example/b");
    expect(() => rewriteReverseHosts("", "", "", "", "")).not.toThrow();
  });
});
