import { describe, expect, it } from "vitest";
import { handleCamouflage } from "../../src/handlers/camouflage";
import { ASSETS } from "../../src/ui/assets";
import { makeTestSettings } from "../helpers/settings";

function settingsWith(mode: "off" | "static") {
  return makeTestSettings({ camouflage: { mode } });
}

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

  it("serves the identical static page for any unknown path (removed routes look untouched)", async () => {
    const a = await handleCamouflage(new Request("https://x/old-vm-path/abc12345"), {} as never, settingsWith("static"));
    const b = await handleCamouflage(new Request("https://x/totally-random-zzz"), {} as never, settingsWith("static"));
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });

  it("never fetches an upstream (proxy mode is removed)", async () => {
    const seen: unknown[] = [];
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async (...args: unknown[]) => {
      seen.push(args[0]);
      return new Response("evil", { status: 200 });
    };
    try {
      const res = await handleCamouflage(new Request("https://x/junk"), {} as never, settingsWith("static"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(ASSETS.camo);
    } finally {
      globalThis.fetch = origFetch;
    }
    expect(seen).toEqual([]);
  });
});
