import { describe, expect, it } from "vitest";
import {
  PROXY_CHECK_BUDGET_MS,
  handleProxyCheck,
  parseProxyCheckInput,
  parseTraceBody,
  redactProxyTarget,
  runProxyCheck,
  type CheckSocket,
  type ProxyCheckTarget,
} from "../../src/handlers/api/proxy-check";

function target(over: Partial<ProxyCheckTarget> = {}): ProxyCheckTarget {
  return { protocol: "socks5", user: null, pass: null, host: "203.0.113.7", port: 1080, ...over };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// Scripted socket: queued reads, captured writes. Never resolves more than queued.
function scriptSocket(chunks: Uint8Array[]): CheckSocket & { written: Uint8Array[] } {
  const queue = chunks.slice();
  const written: Uint8Array[] = [];
  return {
    written,
    async write(data: Uint8Array): Promise<void> {
      written.push(data);
    },
    async readExactly(n: number): Promise<Uint8Array> {
      let have = concat([]);
      while (have.byteLength < n) {
        const next = queue.shift();
        if (next === undefined) throw new Error("eof");
        have = concat([have, next]);
      }
      if (have.byteLength > n) queue.unshift(have.slice(n));
      return have.slice(0, n);
    },
    async readAvailable(_maxBytes: number): Promise<Uint8Array> {
      return concat(queue.splice(0, queue.length));
    },
    async readUntil(delim: Uint8Array): Promise<Uint8Array> {
      const all = concat(queue.splice(0, queue.length));
      for (let i = 0; i + delim.byteLength <= all.byteLength; i++) {
        let hit = true;
        for (let j = 0; j < delim.byteLength; j++) {
          if (all[i + j] !== delim[j]) {
            hit = false;
            break;
          }
        }
        if (hit) {
          queue.unshift(all.slice(i + delim.byteLength));
          return all.slice(0, i + delim.byteLength);
        }
      }
      throw new Error("eof");
    },
    async close(): Promise<void> {},
  };
}

describe("parseProxyCheckInput", () => {
  it("accepts all five protocols with user:pass@host:port", () => {
    for (const protocol of ["socks5", "http", "https", "turn", "sstp"]) {
      const r = parseProxyCheckInput(protocol, "user:pass@203.0.113.7:1080");
      expect(r.ok, protocol).toBe(true);
      if (r.ok) {
        expect(r.value).toMatchObject({ protocol, user: "user", pass: "pass", host: "203.0.113.7", port: 1080 });
      }
    }
  });

  it("accepts credential-less host:port", () => {
    const r = parseProxyCheckInput("http", "203.0.113.7:8080");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ user: null, pass: null, host: "203.0.113.7", port: 8080 });
  });

  it("rejects bad protocols, shapes, and ports with field reasons and never throws", () => {
    expect(parseProxyCheckInput("socks4", "u:p@h:1")).toMatchObject({ ok: false, field: "protocol" });
    expect(parseProxyCheckInput("http", "")).toMatchObject({ ok: false, field: "param" });
    expect(parseProxyCheckInput("http", "not a proxy")).toMatchObject({ ok: false, field: "param" });
    expect(parseProxyCheckInput("http", "u:p@h")).toMatchObject({ ok: false, field: "param" });
    expect(parseProxyCheckInput("http", "u:p@h:99999")).toMatchObject({ ok: false, field: "param" });
    expect(parseProxyCheckInput("http", "@h:1080")).toMatchObject({ ok: false, field: "param" });
    expect(parseProxyCheckInput("http", "u:p@*:1080")).toMatchObject({ ok: false, field: "param" });
    expect(() => parseProxyCheckInput(null, null)).not.toThrow();
  });
});

describe("redactProxyTarget", () => {
  it("drops credentials, keeping host:port for errors and logs", () => {
    expect(redactProxyTarget(target({ user: "u", pass: "p" }))).toBe("203.0.113.7:1080");
    expect(redactProxyTarget(target())).toBe("203.0.113.7:1080");
  });
});

describe("parseTraceBody", () => {
  it("extracts ip and loc from a trace body", () => {
    expect(parseTraceBody("fl=1\nh=cloudflare.com\nip=198.51.100.9\nts=1\nvisit_scheme=http\nloc=DE\n")).toEqual({
      ip: "198.51.100.9",
      loc: "DE",
    });
  });

  it("returns null when ip or loc is missing", () => {
    expect(parseTraceBody("fl=1\nloc=DE\n")).toBeNull();
    expect(parseTraceBody("")).toBeNull();
  });
});

describe("runProxyCheck over socks5", () => {
  const TRACE = "HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nfl=1\nip=198.51.100.9\nloc=DE\n";

  it("completes a no-auth handshake and returns ip/loc with timing", async () => {
    const sock = scriptSocket([
      new Uint8Array([0x05, 0x00]),
      new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      enc(TRACE),
    ]);
    const r = await runProxyCheck(target(), {
      connect: async () => sock,
      now: (() => {
        let t = 1000;
        return () => (t += 25);
      })(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ip).toBe("198.51.100.9");
    expect(r.value.loc).toBe("DE");
    expect(r.value.responseTimeMs).toBeGreaterThanOrEqual(0);
    const first = sock.written[0]!;
    expect([...first]).toEqual([0x05, 0x01, 0x00]);
  });

  it("does the username/password sub-handshake when credentials are set", async () => {
    const sock = scriptSocket([
      new Uint8Array([0x05, 0x02]),
      new Uint8Array([0x01, 0x00]),
      new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      enc(TRACE),
    ]);
    const r = await runProxyCheck(target({ user: "u", pass: "p" }), { connect: async () => sock, now: () => 0 });
    expect(r.ok).toBe(true);
    expect([...sock.written[1]!]).toEqual([0x01, 0x01, 0x75, 0x01, 0x70]);
  });

  it("fails closed when the proxy refuses auth or the connect", async () => {
    const refused = scriptSocket([new Uint8Array([0x05, 0xff])]);
    expect((await runProxyCheck(target(), { connect: async () => refused, now: () => 0 })).ok).toBe(false);
    const denied = scriptSocket([new Uint8Array([0x05, 0x00]), new Uint8Array([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])]);
    const deniedRes = await runProxyCheck(target(), { connect: async () => denied, now: () => 0 });
    expect(deniedRes.ok).toBe(false);
    if (!deniedRes.ok) expect(deniedRes.reason).not.toMatch(/u\b.*p\b/);
  });

  it("maps a dead socket to a credential-free reason", async () => {
    const dead = scriptSocket([]);
    const r = await runProxyCheck(target({ user: "u", pass: "p" }), { connect: async () => dead, now: () => 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toContain("u");
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("runProxyCheck over http CONNECT", () => {
  it("sends CONNECT with basic auth and parses the trace", async () => {
    const TRACE = "HTTP/1.1 200 OK\r\n\r\nfl=1\nip=198.51.100.9\nloc=FR\n";
    const sock = scriptSocket([enc("HTTP/1.1 200 Connection established\r\n\r\n"), enc(TRACE)]);
    const r = await runProxyCheck(target({ protocol: "http", user: "u", pass: "p", port: 8080 }), {
      connect: async () => sock,
      now: () => 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ ip: "198.51.100.9", loc: "FR" });
    const req = new TextDecoder().decode(concat(sock.written));
    expect(req).toContain("CONNECT cloudflare.com:80 HTTP/1.1");
    expect(req).toContain("Proxy-Authorization: Basic");
    expect(req).toContain("GET /cdn-cgi/trace HTTP/1.0");
  });

  it("rejects non-200 connects without leaking the credential", async () => {
    const sock = scriptSocket([enc("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")]);
    const r = await runProxyCheck(target({ protocol: "http", user: "u", pass: "secret" }), {
      connect: async () => sock,
      now: () => 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain("secret");
  });
});

describe("handleProxyCheck mapping", () => {
  function req(body: unknown): Request {
    return new Request("https://panel.example/api/proxy-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects local proxy hosts before dialing", async () => {
    let caught: unknown = null;
    try {
      await handleProxyCheck(req({ protocol: "socks5", param: "u:p@127.0.0.1:1080" }), {} as never, {} as never);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("reports unsupported check protocols as not implemented", async () => {
    for (const protocol of ["https", "turn", "sstp"]) {
      let caught: unknown = null;
      try {
        await handleProxyCheck(req({ protocol, param: "u:p@203.0.113.7:1080" }), {} as never, {} as never);
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught, protocol).toMatchObject({ status: 501, code: "NOT_IMPLEMENTED" });
    }
  });

  it("maps dial failure to a 502 that keeps host but drops credentials", async () => {
    // Node has no cloudflare:sockets, so the dial fails fast and
    // deterministically here; in the worker it races the real dial.
    let caught: unknown = null;
    try {
      await handleProxyCheck(
        req({ protocol: "socks5", param: "myuser:s3cret@203.0.113.7:1080" }),
        {} as never,
        {} as never,
      );
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 502, code: "UPSTREAM" });
    const message = (caught as Error).message;
    expect(message).toContain("203.0.113.7:1080");
    expect(message).not.toContain("myuser");
    expect(message).not.toContain("s3cret");
  });
});

describe("runProxyCheck budget", () => {
  it("stays within the documented budget constant", () => {
    expect(PROXY_CHECK_BUDGET_MS).toBe(10_000);
  });

  it("gives up on a hanging connect within the injected budget", async () => {
    const started = Date.now();
    const r = await runProxyCheck(
      target(),
      { connect: () => new Promise<CheckSocket>(() => {}), now: () => Date.now() },
      { budgetMs: 40 },
    );
    expect(r).toEqual({ ok: false, reason: "proxy connection failed" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
