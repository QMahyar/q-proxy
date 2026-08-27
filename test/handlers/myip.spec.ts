import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMyIp, parseTraceIp } from "../../src/handlers/myip";
import { makeTestSettings } from "../helpers/settings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseTraceIp", () => {
  it("extracts the ip line from a cdn-cgi/trace payload", () => {
    const trace = "fl=123\nh=www.cloudflare.com\nip=203.0.113.7\nts=1700000000\nloc=DE\ncolo=FRA";
    expect(parseTraceIp(trace)).toBe("203.0.113.7");
  });

  it("handles ipv6 egress addresses", () => {
    expect(parseTraceIp("ip=2606:4700:4700::1111\n")).toBe("2606:4700:4700::1111");
  });

  it("returns null when the ip line is missing or empty", () => {
    expect(parseTraceIp("fl=1\nloc=US")).toBeNull();
    expect(parseTraceIp("ip=\n")).toBeNull();
    expect(parseTraceIp("")).toBeNull();
  });
});

describe("handleMyIp", () => {
  const settings = makeTestSettings();

  function requestWith(accept?: string, city = "Test City"): Request {
    const headers: Record<string, string> = { "CF-Connecting-IP": "203.0.113.9" };
    if (accept !== undefined) headers.Accept = accept;
    const req = new Request("https://panel.example/my-ip", { headers });
    Object.defineProperty(req, "cf", { value: { colo: "FRA", country: "DE", city, asn: 13335 } });
    return req;
  }

  function stubTrace(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ip=198.51.100.5\nloc=DE", { status: 200 })),
    );
  }

  it("html response is no-store and escapes apostrophes in geo values", async () => {
    stubTrace();
    const res = await handleMyIp(requestWith(undefined, "O'Connell St"), {} as never, settings);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("O&#39;Connell St");
    expect(html).not.toContain("[dir=");
  });

  it("json response is no-store", async () => {
    stubTrace();
    const res = await handleMyIp(requestWith("application/json"), {} as never, settings);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data["ip"]).toBe("203.0.113.9");
  });
});
