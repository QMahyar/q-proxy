import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRemoteSubLines } from "../../src/subscription/merge";
import { encodeBase64, encodeBase64Url } from "../../src/utils/base64";

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

describe("fetchRemoteSubLines", () => {
  it("returns empty for an empty url list without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRemoteSubLines([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts plaintext uri lists line by line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse("vless://a@h:1#A\n\nvmess://YWJj\ntrojan://x")),
    );
    expect(await fetchRemoteSubLines(["https://r/sub"])).toEqual([
      "vless://a@h:1#A",
      "vmess://YWJj",
      "trojan://x",
    ]);
  });

  it("autodetects standard padded base64 bodies", async () => {
    const payload = encodeBase64(new TextEncoder().encode("ss://one@h:2#1\nvless://two@h:3#2"));
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(`  ${payload}  \n`)));
    expect(await fetchRemoteSubLines(["https://r/sub"])).toEqual(["ss://one@h:2#1", "vless://two@h:3#2"]);
  });

  it("autodetects url-safe unpadded base64 bodies", async () => {
    const payload = encodeBase64Url(new TextEncoder().encode("trojan://url+safe/q?ed=1#T"));
    expect(payload).not.toContain("=");
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(payload)));
    expect(await fetchRemoteSubLines(["https://r/sub"])).toEqual(["trojan://url+safe/q?ed=1#T"]);
  });

  it("silently skips failures, non-ok statuses and garbage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        if (u.endsWith("bad")) throw new Error("boom");
        if (u.endsWith("404")) return new Response("nope", { status: 404 });
        return okResponse("this is not a subscription");
      }),
    );
    expect(
      await fetchRemoteSubLines(["https://r/bad", "https://r/404", "https://r/garbage"]),
    ).toEqual([]);
  });

  it("dedupes identical lines across urls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        okResponse(String(input).endsWith("1") ? "vless://dup@h:1#D" : "vless://dup@h:1#D"),
      ),
    );
    expect(await fetchRemoteSubLines(["https://r/1", "https://r/2"])).toEqual(["vless://dup@h:1#D"]);
  });

  it("enforces the 1 MiB total budget across parallel fetches", async () => {
    const bigLine = (n: number): string => `vless://${String(n).padStart(3, "0")}-${"a".repeat(900_000)}@h:1#N`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => okResponse(bigLine(String(input).endsWith("1") ? 1 : 2))),
    );
    const lines = await fetchRemoteSubLines(["https://r/1", "https://r/2"]);
    expect(lines.length).toBe(2);
    expect(lines[0]!.length).toBeGreaterThan(900_000);
    expect(lines[1]!.length).toBeLessThan(lines[0]!.length);
    expect(lines[1]!.startsWith("vless://002")).toBe(true);
  });

  it("counts the byte budget in bytes and truncates on a code-point boundary when there is no reader", async () => {
    const raw = `vless://${"é".repeat(600_000)}@h:1#U\nvless://tail@h:1#T`;
    const readerLess = { ok: true, status: 200, body: null, text: async () => raw } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => readerLess));
    const lines = await fetchRemoteSubLines(["https://r/1"]);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe(`vless://${"é".repeat(524_284)}`);
    expect(new TextEncoder().encode(lines[0]!).byteLength).toBeLessThanOrEqual(1024 * 1024);
  });

  it("fetches urls in parallel while keeping url order and deduping", async () => {
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const u = String(input);
        if (u.endsWith("1")) await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        return okResponse(
          u.endsWith("1") ? "vless://dup@h:1#D\nvless://one@h:1#1" : "vless://dup@h:1#D\nvless://two@h:1#2",
        );
      }),
    );
    expect(await fetchRemoteSubLines(["https://r/1", "https://r/2"])).toEqual([
      "vless://dup@h:1#D",
      "vless://one@h:1#1",
      "vless://two@h:1#2",
    ]);
    expect(maxActive).toBe(2);
  });

  it("does not let a hung url block others beyond the shared total budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("slow") ? new Promise<Response>(() => {}) : okResponse("vless://fast@h:1#F"),
      ),
    );
    const start = Date.now();
    const lines = await fetchRemoteSubLines(["https://r/slow", "https://r/fast"], 0, {
      perFetchMs: 5000,
      totalMs: 100,
    });
    expect(lines).toEqual(["vless://fast@h:1#F"]);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("drops a hung url at the per-fetch timeout without blocking others", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).endsWith("slow") ? new Promise<Response>(() => {}) : okResponse("vless://fast@h:1#F"),
      ),
    );
    const start = Date.now();
    const lines = await fetchRemoteSubLines(["https://r/slow", "https://r/fast"], 0, {
      perFetchMs: 50,
      totalMs: 5000,
    });
    expect(lines).toEqual(["vless://fast@h:1#F"]);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
