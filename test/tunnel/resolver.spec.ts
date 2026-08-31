import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDnsQuery,
  clearResolverCache,
  createDnsPacketRelay,
  createResolver,
  DNS_TYPE_A,
  DNS_TYPE_AAAA,
  DNS_TYPE_TXT,
  parseDnsAnswers,
} from "../../src/tunnel/resolver";
import { concatBytes, equalsBytes, writeU16BE } from "../../src/utils/bytes";

function encodeName(name: string): Uint8Array {
  const parts = name.split(".");
  let len = 1;
  for (const p of parts) len += p.length + 1;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out[off++] = p.length;
    for (let i = 0; i < p.length; i++) out[off++] = p.charCodeAt(i);
  }
  out[off] = 0;
  return out;
}

interface AnswerSpec {
  type: number;
  rdata: Uint8Array;
}

function buildDnsResponse(name: string, answers: AnswerSpec[]): Uint8Array {
  const question = concatBytes(encodeName(name), new Uint8Array([0, 0]), new Uint8Array([0, 1]));
  const header = new Uint8Array(12);
  header[2] = 0x81;
  header[3] = 0x80;
  header[5] = 1;
  header[7] = answers.length;
  const chunks: Uint8Array[] = [header, question];
  for (const answer of answers) {
    chunks.push(new Uint8Array([0xc0, 0x0c]));
    const fixed = new Uint8Array(10);
    writeU16BE(fixed, 0, answer.type);
    writeU16BE(fixed, 2, 1);
    writeU16BE(fixed, 4, 300);
    writeU16BE(fixed, 8, answer.rdata.length);
    chunks.push(fixed, answer.rdata);
  }
  return concatBytes(...chunks);
}

function txtRdata(strings: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts = strings.map((s) => {
    const b = enc.encode(s);
    return concatBytes(new Uint8Array([b.length]), b);
  });
  return concatBytes(...parts);
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearResolverCache();
});

describe("buildDnsQuery", () => {
  it("encodes header and question section", () => {
    const q = buildDnsQuery("example.com", DNS_TYPE_A)!;
    expect(q[2]).toBe(0x01);
    expect(q[3]).toBe(0x00);
    expect(q[5]).toBe(1);
    const text = Array.from(q.subarray(12))
      .map((b) => String.fromCharCode(b))
      .join("");
    expect(text.startsWith("\u0007example\u0003com\u0000")).toBe(true);
    expect((q[q.length - 4]! << 8) | q[q.length - 3]!).toBe(DNS_TYPE_A);
    expect((q[q.length - 2]! << 8) | q[q.length - 1]!).toBe(1);
  });

  it("rejects empty names", () => {
    expect(buildDnsQuery("", DNS_TYPE_A)).toBeNull();
    expect(buildDnsQuery(".", DNS_TYPE_A)).toBeNull();
  });
});

describe("parseDnsAnswers", () => {
  it("extracts A records", () => {
    const msg = buildDnsResponse("example.com", [
      { type: DNS_TYPE_A, rdata: new Uint8Array([93, 184, 216, 34]) },
    ]);
    expect(parseDnsAnswers(msg, DNS_TYPE_A)).toEqual(["93.184.216.34"]);
  });

  it("extracts AAAA records", () => {
    const rdata = new Uint8Array(16);
    rdata[0] = 0x26;
    rdata[1] = 0x02;
    const msg = buildDnsResponse("v6.example.com", [{ type: DNS_TYPE_AAAA, rdata }]);
    expect(parseDnsAnswers(msg, DNS_TYPE_AAAA)).toEqual(["2602:" + "0:".repeat(6) + "0"]);
  });

  it("concatenates TXT character-strings", () => {
    const msg = buildDnsResponse("list.example.com", [
      { type: DNS_TYPE_TXT, rdata: txtRdata(["10.0.0.1\x0810.0", ".0.2"]) },
    ]);
    expect(parseDnsAnswers(msg, DNS_TYPE_TXT)).toEqual(["10.0.0.1\x0810.0.0.2"]);
  });

  it("skips non-matching record types like CNAME", () => {
    const cnameRdata = new Uint8Array([0x03, 0x61, 0x62, 0x63, 0x00]);
    const msg = buildDnsResponse("alias.example.com", [
      { type: 5, rdata: cnameRdata },
      { type: DNS_TYPE_A, rdata: new Uint8Array([1, 1, 1, 1]) },
    ]);
    expect(parseDnsAnswers(msg, DNS_TYPE_A)).toEqual(["1.1.1.1"]);
  });

  it("returns empty for truncated or non-response messages", () => {
    expect(parseDnsAnswers(new Uint8Array([1, 2, 3]), DNS_TYPE_A)).toEqual([]);
    const queryLike = new Uint8Array(12);
    queryLike[2] = 0x01;
    queryLike[3] = 0x00;
    expect(parseDnsAnswers(queryLike, DNS_TYPE_A)).toEqual([]);
  });
});

describe("createResolver", () => {
  it("queries DoH over POST and parses A answers", async () => {
    clearResolverCache();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(buildDnsResponse("target.example", [
          { type: DNS_TYPE_A, rdata: new Uint8Array([9, 9, 9, 9]) },
        ]));
      }),
    );
    const resolver = createResolver("https://dns.example/dns-query");
    const ips = await resolver.resolveA("target.example");
    expect(ips).toEqual(["9.9.9.9"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://dns.example/dns-query");
    expect(calls[0]!.init?.method).toBe("POST");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("content-type")).toBe("application/dns-message");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("caches lookups per isolate until cleared", async () => {
    clearResolverCache();
    const fetchMock = vi.fn(async () =>
      new Response(buildDnsResponse("cached.example", [
        { type: DNS_TYPE_A, rdata: new Uint8Array([4, 4, 4, 4]) },
      ])),
    );
    vi.stubGlobal("fetch", fetchMock);
    const resolver = createResolver("https://dns.example/dns-query");
    await resolver.resolveA("cached.example");
    await resolver.resolveA("cached.example");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearResolverCache();
    await resolver.resolveA("cached.example");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not share cache entries across different DoH URLs", async () => {
    clearResolverCache();
    const fetchMock = vi.fn(async (url: string) =>
      new Response(buildDnsResponse("shared.example", [
        { type: DNS_TYPE_A, rdata: new Uint8Array([url.startsWith("https://one") ? 1 : 2, 0, 0, 1]) },
      ])),
    );
    vi.stubGlobal("fetch", fetchMock);
    const one = createResolver("https://one.example/dns-query");
    const two = createResolver("https://two.example/dns-query");
    await one.resolveA("shared.example");
    await two.resolveA("shared.example");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await one.resolveA("shared.example"))[0]).toBe("1.0.0.1");
    expect((await two.resolveA("shared.example"))[0]).toBe("2.0.0.1");
  });

  it("returns [] silently when upstream fails", async () => {
    clearResolverCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    const resolver = createResolver("https://dns.example/dns-query");
    expect(await resolver.resolveTXT("gone.example")).toEqual([]);
  });

  it("does not cache empty answers so a transient failure re-fetches", async () => {
    clearResolverCache();
    const fetchMock = vi.fn(async () =>
      new Response(buildDnsResponse("flaky.example", [])),
    );
    vi.stubGlobal("fetch", fetchMock);
    const resolver = createResolver("https://dns.example/dns-query");
    expect(await resolver.resolveA("flaky.example")).toEqual([]);
    expect(await resolver.resolveA("flaky.example")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("createDnsPacketRelay", () => {
  it("forwards the raw DNS packet verbatim via POST and returns the answer bytes", async () => {
    const packet = buildDnsQuery("whois.example", DNS_TYPE_A)!;
    const answer = buildDnsResponse("whois.example", [
      { type: DNS_TYPE_A, rdata: new Uint8Array([203, 0, 113, 1]) },
    ]);
    let seenBody: Uint8Array | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        seenBody = init?.body as Uint8Array;
        return new Response(answer as unknown as BodyInit);
      }),
    );
    const relay = createDnsPacketRelay("https://doh.example/dns-query");
    const result = await relay(packet);
    expect(result).not.toBeNull();
    expect(equalsBytes(result!, answer)).toBe(true);
    expect(equalsBytes(seenBody!, packet)).toBe(true);
  });

  it("returns null for malformed packets or failed upstreams", async () => {
    const relay = createDnsPacketRelay("https://doh.example/dns-query");
    expect(await relay(new Uint8Array([1, 2]))).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    const packet = buildDnsQuery("x.example", DNS_TYPE_A)!;
    expect(await relay(packet)).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await relay(packet)).toBeNull();
  });
});
