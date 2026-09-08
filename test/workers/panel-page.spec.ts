import { describe, expect, it } from "vitest";
import { servePanelPage, serveLoginPage } from "../../src/handlers/panel-page";
import { ASSETS } from "../../src/ui/assets";
import type { Env } from "../../src/types/env";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

const env = {} as Env;
const settings = { ...DEFAULT_SETTINGS, securePath: "etagpath" } as Parameters<typeof servePanelPage>[2];

const get = (headers: Record<string, string> = {}) => {
  const req = new Request("https://example.com/etagpath/panel", { headers });
  return servePanelPage(req, env, settings);
};

describe("panel-page asset caching", () => {
  it("serves the panel with a strong ETag and private no-cache revalidation", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("revalidates: If-None-Match on the current ETag short-circuits to an empty 304", async () => {
    const first = await get();
    const etag = first.headers.get("ETag") ?? "";
    const second = await get({ "If-None-Match": etag });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("only revalidates on an entity-tag match: a different tag gets the full body, weak form matches (RFC 7232)", async () => {
    const first = await get();
    const etag = first.headers.get("ETag") ?? "";
    const wrong = `"${"0".repeat(32)}"`;
    expect(wrong).not.toBe(etag);
    const stale = await get({ "If-None-Match": wrong });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe(ASSETS.panel);
    const weak = await get({ "If-None-Match": `W/${etag}` });
    expect(weak.status).toBe(304);
  });

  it("is stable across requests in the same isolate (memoized, not recomputed)", async () => {
    const [a, b] = await Promise.all([get(), get()]);
    expect(a.headers.get("ETag")).toBe(b.headers.get("ETag"));
  });

  it("covers the login page with the same treatment", async () => {
    const req = new Request("https://example.com/etagpath/login");
    const res = await serveLoginPage(req, env, settings);
    expect(res.status).toBe(200);
    const etag = res.headers.get("ETag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const revalidated = await serveLoginPage(
      new Request("https://example.com/etagpath/login", { headers: { "If-None-Match": etag } }),
      env,
      settings,
    );
    expect(revalidated.status).toBe(304);
  });

  it("derives the ETag from the served bytes, not a fixed constant", async () => {
    const etag = (await get()).headers.get("ETag") ?? "";
    const loginEtag = await serveLoginPage(new Request("https://example.com/etagpath/login"), env, settings);
    expect(loginEtag.headers.get("ETag")).not.toBe("");
    expect(loginEtag.headers.get("ETag")).not.toBe(etag);
  });
});
