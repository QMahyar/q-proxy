import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDoh } from "../../src/handlers/doh";
import { makeTestSettings } from "../helpers/settings";

const settings = makeTestSettings();

function dnsResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]).buffer, {
    status: 200,
    headers: { "Content-Type": "application/dns-message", "Cache-Control": "max-age=30" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleDoh", () => {
  it("GET forwards only the dns parameter and passes the answer through", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => dnsResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleDoh(
      new Request("https://panel.example/doh?dns=AAAA&foo=bar&ec=1"),
      {} as never,
      settings,
    );
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toBe("https://cloudflare-dns.com/dns-query?dns=AAAA");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/dns-message");
  });

  it("POST with declared content-length over the cap rejects before fetching", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("upstream must not be called");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      handleDoh(
        new Request("https://panel.example/doh", {
          method: "POST",
          headers: { "Content-Length": String(64 * 1024 + 1) },
          body: "tiny",
        }),
        {} as never,
        settings,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST without a content-length header proceeds to upstream", async () => {
    const fetchMock = vi.fn(async () => dnsResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleDoh(
      new Request("https://panel.example/doh", {
        method: "POST",
        body: new Uint8Array(16),
      }),
      {} as never,
      settings,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("POST with a non-numeric content-length rejects", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      handleDoh(
        new Request("https://panel.example/doh", {
          method: "POST",
          headers: { "Content-Length": "many" },
          body: "tiny",
        }),
        {} as never,
        settings,
      ),
    ).rejects.toMatchObject({ status: 400, message: "invalid content-length" });
  });

  it("POST with an undersized declared length but oversized buffered body rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("upstream must not be called");
      }),
    );
    await expect(
      handleDoh(
        new Request("https://panel.example/doh", {
          method: "POST",
          headers: { "Content-Length": "16" },
          body: new Uint8Array(64 * 1024 + 1),
        }),
        {} as never,
        settings,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("POST with an empty body rejects", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      handleDoh(
        new Request("https://panel.example/doh", {
          method: "POST",
          headers: { "Content-Length": "0" },
          body: "",
        }),
        {} as never,
        settings,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("non-ok upstream becomes UpstreamError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(
      handleDoh(new Request("https://panel.example/doh?dns=AAAA"), {} as never, settings),
    ).rejects.toMatchObject({ status: 502, expose: false });
  });

  it("non-GET/POST methods get a 405 envelope", async () => {
    const res = await handleDoh(new Request("https://panel.example/doh", { method: "DELETE" }), {} as never, settings);
    expect(res.status).toBe(405);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
    const res2 = await handleDoh(new Request("https://panel.example/doh", { method: "PUT" }), {} as never, settings);
    expect(res2.status).toBe(405);
  });

  it("rejects local or private upstream targets before fetching", async () => {
    const fetchMock = vi.fn(async () => dnsResponse());
    vi.stubGlobal("fetch", fetchMock);
    for (const upstream of ["http://127.0.0.1:53/dns-query", "https://localhost/dns-query", "http://169.254.169.254/dns-query", "http://10.0.0.5/dns-query", "http://[::1]/dns-query", "http://[fc00::1]/dns-query", "http://0.0.0.0/dns-query"]) {
      const privateSettings = makeTestSettings({ dohUpstream: upstream });
      await expect(
        handleDoh(new Request("https://panel.example/doh?dns=AAAA"), {} as never, privateSettings),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a GET without a dns parameter untouched", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => dnsResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleDoh(new Request("https://panel.example/doh"), {} as never, settings);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://cloudflare-dns.com/dns-query");
    expect(res.status).toBe(200);
  });
});
