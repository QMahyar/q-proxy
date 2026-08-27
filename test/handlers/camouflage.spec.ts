import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCamouflage } from "../../src/handlers/camouflage";
import { ASSETS } from "../../src/ui/assets";
import { makeTestSettings } from "../helpers/settings";

function settingsWith(mode: "off" | "static" | "proxy", url = "") {
  return makeTestSettings({ camouflage: { mode, url } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleCamouflage", () => {
  it("throws NotFoundError when the mode is off", async () => {
    await expect(handleCamouflage(new Request("https://x/"), {} as never, settingsWith("off"))).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("serves the static camo asset", async () => {
    const res = await handleCamouflage(new Request("https://x/junk"), {} as never, settingsWith("static"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toBe(ASSETS.camo);
  });

  it("passes an ok upstream response through in proxy mode", async () => {
    const upstream = new Response("<h1>upstream page</h1>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => upstream),
    );
    const res = await handleCamouflage(
      new Request("https://x/junk"),
      {} as never,
      settingsWith("proxy", "https://camo.example/page"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>upstream page</h1>");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("https://camo.example/page/junk");
  });

  it("resolves asset-looking paths against the configured origin and base path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("icon", { status: 200 })),
    );
    await handleCamouflage(
      new Request("https://x/favicon.ico"),
      {} as never,
      settingsWith("proxy", "https://camo.example/page"),
    );
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("https://camo.example/page/favicon.ico");
  });

  it("keeps the query string and root base path when resolving the upstream url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("post", { status: 200 })),
    );
    await handleCamouflage(
      new Request("https://x/post/2?q=1"),
      {} as never,
      settingsWith("proxy", "https://camo.example"),
    );
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("https://camo.example/post/2?q=1");
  });

  it("falls back to the static asset when upstream is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const res = await handleCamouflage(
      new Request("https://x/junk"),
      {} as never,
      settingsWith("proxy", "https://camo.example/page"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ASSETS.camo);
  });

  it("falls back to the static asset when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const res = await handleCamouflage(
      new Request("https://x/junk"),
      {} as never,
      settingsWith("proxy", ""),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ASSETS.camo);
  });
});
