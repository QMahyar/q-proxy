import type { RouteHandler } from "../../types/context";
import { AppError, BadRequestError, UpstreamError, ValidationError } from "../../core/errors";
import { jsonOk, readJsonObject } from "../../core/respond";
import { dialTcp } from "../../tunnel/egress";
import type { Socket } from "../../types/tunnel";
import { encodeUtf8Base64 } from "../../utils/base64";
import { HOSTNAME_RE, isIpLiteral, isLocalOrPrivateTarget, parseHostPort } from "../../utils/net";

export type ProxyCheckProtocol = "socks5" | "http" | "https" | "turn" | "sstp";

const PROXY_CHECK_PROTOCOLS: readonly ProxyCheckProtocol[] = ["socks5", "http", "https", "turn", "sstp"];

// Total per-check budget: dial + handshake + trace. The dial itself has no
// abort handle, so the budget is enforced by racing (mirrors tcpProbe).
export const PROXY_CHECK_BUDGET_MS = 10_000;

// The trace target. Port 80 plain HTTP is deliberate: workerd sockets cannot
// originate TLS, and /cdn-cgi/trace over HTTP carries the same ip/loc
// signal the check needs.
const TRACE_HOST = "cloudflare.com";
const TRACE_PORT = 80;

export interface ProxyCheckTarget {
  protocol: ProxyCheckProtocol;
  user: string | null;
  pass: string | null;
  host: string;
  port: number;
}

export type ProxyCheckParseResult =
  | { ok: true; value: ProxyCheckTarget }
  | { ok: false; field: "protocol" | "param"; reason: string };

const USER_RE = /^[^\s@:[\]/]{1,64}$/;
const PASS_RE = /^[^\s@]{0,128}$/;

// Parse `{protocol, param}` with `param` shaped `[user[:pass]@]host:port`.
// Pure validation only — never throws, never retains credentials in reasons.
export function parseProxyCheckInput(protocol: unknown, param: unknown): ProxyCheckParseResult {
  if (typeof protocol !== "string" || !(PROXY_CHECK_PROTOCOLS as readonly string[]).includes(protocol)) {
    return { ok: false, field: "protocol", reason: "must be one of socks5, http, https, turn, sstp" };
  }
  if (typeof param !== "string" || param.trim().length === 0 || param.trim().length > 320) {
    return { ok: false, field: "param", reason: "must be a user:pass@host:port string" };
  }
  const text = param.trim();
  let user: string | null = null;
  let pass: string | null = null;
  let hostport = text;
  const at = text.lastIndexOf("@");
  if (at !== -1) {
    const creds = text.slice(0, at);
    hostport = text.slice(at + 1);
    if (creds.length === 0 || hostport.length === 0) {
      return { ok: false, field: "param", reason: "must be a user:pass@host:port string" };
    }
    const colon = creds.indexOf(":");
    if (colon === -1) {
      user = creds;
      pass = null;
    } else {
      user = creds.slice(0, colon);
      pass = creds.slice(colon + 1);
    }
    if (user === null || !USER_RE.test(user)) {
      return { ok: false, field: "param", reason: "proxy username is invalid" };
    }
    if (pass !== null && !PASS_RE.test(pass)) {
      return { ok: false, field: "param", reason: "proxy password is invalid" };
    }
  }
  const hp = parseHostPort(hostport, 0);
  if (hp === null || hp.host.length === 0 || hp.port <= 0) {
    return { ok: false, field: "param", reason: "must be a user:pass@host:port string" };
  }
  if (hp.host.includes("*")) return { ok: false, field: "param", reason: "proxy host must be concrete" };
  if (!isIpLiteral(hp.host) && !HOSTNAME_RE.test(hp.host)) {
    return { ok: false, field: "param", reason: "proxy host must be an IP or hostname" };
  }
  return {
    ok: true,
    value: { protocol: protocol as ProxyCheckProtocol, user, pass, host: hp.host, port: hp.port },
  };
}

// Host-only identity for errors and logs. Credentials must never flow here.
export function redactProxyTarget(t: Pick<ProxyCheckTarget, "host" | "port">): string {
  return `${t.host}:${t.port}`;
}

export interface TraceIdentity {
  ip: string;
  loc: string;
}

// Parse `ip=` / `loc=` out of a /cdn-cgi/trace body. Never throws.
export function parseTraceBody(text: string): TraceIdentity | null {
  let ip: string | null = null;
  let loc: string | null = null;
  for (const line of String(text ?? "").split("\n")) {
    const t = line.trim();
    if (t.startsWith("ip=") && ip === null) ip = t.slice(3).trim();
    else if (t.startsWith("loc=") && loc === null) loc = t.slice(4).trim();
  }
  if (ip === null || ip.length === 0 || loc === null || loc.length === 0) return null;
  return { ip, loc };
}

// Minimal byte-stream view over a proxied socket. `timeoutMs` bounds every
// blocking read; leftover bytes stay buffered across calls.
export interface CheckSocket {
  write(data: Uint8Array, timeoutMs?: number): Promise<void>;
  readExactly(n: number, timeoutMs?: number): Promise<Uint8Array>;
  readUntil(delim: Uint8Array, maxBytes: number, timeoutMs?: number): Promise<Uint8Array>;
  readAvailable(maxBytes: number, timeoutMs?: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface ProxyCheckDeps {
  connect(host: string, port: number, timeoutMs: number): Promise<CheckSocket>;
  now(): number;
}

export interface ProxyCheckResult {
  ip: string;
  loc: string;
  responseTimeMs: number;
}

export type ProxyCheckOutcome =
  | { ok: true; value: ProxyCheckResult }
  | { ok: false; reason: string };

const TE = new TextEncoder();
const TD = new TextDecoder();
const CRLF2 = TE.encode("\r\n\r\n");

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

function indexOfDelim(hay: Uint8Array, needle: Uint8Array): number {
  if (needle.byteLength === 0 || hay.byteLength < needle.byteLength) return -1;
  for (let i = 0; i <= hay.byteLength - needle.byteLength; i++) {
    let hit = true;
    for (let j = 0; j < needle.byteLength; j++) {
      if (hay[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

async function socks5Handshake(sock: CheckSocket, t: ProxyCheckTarget, timeoutMs: number): Promise<void> {
  const authed = t.user !== null;
  await sock.write(new Uint8Array(authed ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]), timeoutMs);
  const method = await sock.readExactly(2, timeoutMs);
  if (method[0] !== 0x05) throw new Error("proxy handshake failed");
  if (method[1] === 0x02) {
    if (t.user === null) throw new Error("proxy refused authentication");
    const u = TE.encode(t.user);
    const p = TE.encode(t.pass ?? "");
    if (u.byteLength > 255 || p.byteLength > 255) throw new Error("proxy credentials too long");
    await sock.write(concatBytes([new Uint8Array([0x01, u.byteLength]), u, new Uint8Array([p.byteLength]), p]), timeoutMs);
    const auth = await sock.readExactly(2, timeoutMs);
    if (auth[0] !== 0x01 || auth[1] !== 0x00) throw new Error("proxy refused authentication");
  } else if (method[1] !== 0x00) {
    throw new Error("proxy refused authentication");
  }
  const hostBytes = TE.encode(TRACE_HOST);
  if (hostBytes.byteLength > 255) throw new Error("proxy connect failed");
  await sock.write(
    concatBytes([
      new Uint8Array([0x05, 0x01, 0x00, 0x03, hostBytes.byteLength]),
      hostBytes,
      new Uint8Array([(TRACE_PORT >> 8) & 0xff, TRACE_PORT & 0xff]),
    ]),
    timeoutMs,
  );
  const rep = await sock.readExactly(4, timeoutMs);
  if (rep[0] !== 0x05 || rep[1] !== 0x00) throw new Error("proxy connect failed");
  const atyp = rep[3];
  if (atyp === 0x01) await sock.readExactly(6, timeoutMs);
  else if (atyp === 0x03) {
    const len = await sock.readExactly(1, timeoutMs);
    await sock.readExactly(len[0]! + 2, timeoutMs);
  } else if (atyp === 0x04) await sock.readExactly(18, timeoutMs);
  else throw new Error("proxy connect failed");
}

async function httpConnect(sock: CheckSocket, t: ProxyCheckTarget, timeoutMs: number): Promise<void> {
  let req = `CONNECT ${TRACE_HOST}:${TRACE_PORT} HTTP/1.1\r\nHost: ${TRACE_HOST}:${TRACE_PORT}\r\n`;
  if (t.user !== null) req += `Proxy-Authorization: Basic ${encodeUtf8Base64(`${t.user}:${t.pass ?? ""}`)}\r\n`;
  req += "\r\n";
  await sock.write(TE.encode(req), timeoutMs);
  const head = TD.decode(await sock.readUntil(CRLF2, 8192, timeoutMs));
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(head.split("\r\n", 1)[0] ?? "");
  if (status === null) throw new Error("proxy connect failed");
  if (status[1] === "407") throw new Error("proxy authentication failed");
  if (status[1] !== "200") throw new Error("proxy connect failed");
}

// Drive one proxied trace check. Returns a reason on every failure path and
// never throws; reasons are static strings (no credentials, no host).
export async function runProxyCheck(
  t: ProxyCheckTarget,
  deps: ProxyCheckDeps,
  opts?: { budgetMs?: number },
): Promise<ProxyCheckOutcome> {
  const budget = opts?.budgetMs ?? PROXY_CHECK_BUDGET_MS;
  const started = deps.now();
  const remaining = (): number => Math.max(0, started + budget - deps.now());
  let socket: CheckSocket | null = null;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetAbort = new Promise<never>((_, reject) => {
    budgetTimer = setTimeout(() => reject(new Error("proxy check timed out")), Math.max(0, budget));
  });
  try {
    socket = await Promise.race([deps.connect(t.host, t.port, remaining()), budgetAbort]);
  } catch {
    if (budgetTimer !== undefined) clearTimeout(budgetTimer);
    return { ok: false, reason: "proxy connection failed" };
  }
  if (budgetTimer !== undefined) clearTimeout(budgetTimer);
  try {
    if (remaining() <= 0) throw new Error("proxy check timed out");
    if (t.protocol === "socks5") await socks5Handshake(socket, t, remaining());
    else await httpConnect(socket, t, remaining());
    if (remaining() <= 0) throw new Error("proxy check timed out");
    await socket.write(
      TE.encode(`GET /cdn-cgi/trace HTTP/1.0\r\nHost: ${TRACE_HOST}\r\nConnection: close\r\n\r\n`),
      remaining(),
    );
    const raw = TD.decode(await socket.readAvailable(65536, remaining()));
    if (raw.trim().length === 0) throw new Error("empty trace response");
    const body = raw.includes("\r\n\r\n") ? raw.slice(raw.indexOf("\r\n\r\n") + 4) : raw;
    const id = parseTraceBody(body);
    if (id === null) throw new Error("trace is missing ip/loc");
    return { ok: true, value: { ...id, responseTimeMs: Math.max(0, deps.now() - started) } };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "proxy check failed" };
  } finally {
    await socket.close().catch(() => {});
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(0, ms));
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function adaptSocket(raw: Socket): CheckSocket {
  const writer = raw.writable.getWriter();
  const reader = raw.readable.getReader();
  let buf = new Uint8Array(0);
  let ended = false;
  const fill = async (): Promise<boolean> => {
    if (ended) return false;
    const next = await reader.read();
    if (next.done || next.value === undefined) {
      ended = true;
      return false;
    }
    const merged = new Uint8Array(buf.byteLength + next.value.byteLength);
    merged.set(buf, 0);
    merged.set(next.value, buf.byteLength);
    buf = merged;
    return true;
  };
  const take = (n: number): Uint8Array => {
    const out = buf.slice(0, n);
    buf = buf.slice(n);
    return out;
  };
  return {
    async write(data: Uint8Array): Promise<void> {
      await writer.write(data);
    },
    async readExactly(n: number, timeoutMs = PROXY_CHECK_BUDGET_MS): Promise<Uint8Array> {
      const stop = Date.now() + Math.max(0, timeoutMs);
      for (;;) {
        if (buf.byteLength >= n) return take(n);
        if (ended) throw new Error("proxy connection closed");
        if (Date.now() >= stop) throw new Error("proxy read timed out");
        await withTimeout(fill(), Math.max(0, stop - Date.now()), "proxy read timed out").catch((err: unknown) => {
          if (err instanceof Error && err.message === "proxy read timed out") throw err;
          ended = true;
        });
      }
    },
    async readUntil(delim: Uint8Array, maxBytes: number, timeoutMs = PROXY_CHECK_BUDGET_MS): Promise<Uint8Array> {
      const stop = Date.now() + Math.max(0, timeoutMs);
      for (;;) {
        const at = indexOfDelim(buf, delim);
        if (at !== -1) return take(at + delim.byteLength);
        if (buf.byteLength >= maxBytes) throw new Error("proxy response too large");
        if (ended) throw new Error("proxy connection closed");
        if (Date.now() >= stop) throw new Error("proxy read timed out");
        await withTimeout(fill(), Math.max(0, stop - Date.now()), "proxy read timed out").catch((err: unknown) => {
          if (err instanceof Error && err.message === "proxy read timed out") throw err;
          ended = true;
        });
      }
    },
    async readAvailable(maxBytes: number, timeoutMs = PROXY_CHECK_BUDGET_MS): Promise<Uint8Array> {
      const stop = Date.now() + Math.max(0, timeoutMs);
      for (;;) {
        if (ended) return take(Math.min(buf.byteLength, maxBytes));
        if (buf.byteLength >= maxBytes) return take(maxBytes);
        if (Date.now() >= stop) {
          if (buf.byteLength > 0) return take(Math.min(buf.byteLength, maxBytes));
          throw new Error("proxy read timed out");
        }
        await withTimeout(fill(), Math.max(0, stop - Date.now()), "proxy read timed out").catch((err: unknown) => {
          if (err instanceof Error && err.message === "proxy read timed out") {
            if (buf.byteLength > 0) return;
            throw err;
          }
          ended = true;
        });
      }
    },
    async close(): Promise<void> {
      try {
        reader.cancel().catch(() => {});
      } catch {
        // Best-effort: the reader may already be released.
      }
      try {
        writer.close().catch(() => {});
      } catch {
        // Best-effort: the writer may already be closed.
      }
      await raw.close().catch(() => {});
    },
  };
}

export const handleProxyCheck: RouteHandler = async (req) => {
  const body = await readJsonObject(req);
  const parsed = parseProxyCheckInput(body.protocol, body.param);
  if (!parsed.ok) throw new ValidationError({ [parsed.field]: parsed.reason });
  const t = parsed.value;
  if (t.protocol === "https" || t.protocol === "turn" || t.protocol === "sstp") {
    throw new AppError(`${t.protocol} proxy check is not supported yet`, 501, "NOT_IMPLEMENTED");
  }
  if (isLocalOrPrivateTarget(t.host)) {
    throw new BadRequestError("proxy host must not be a local or private address");
  }
  const outcome = await runProxyCheck(t, {
    connect: async (host, port, timeoutMs) =>
      adaptSocket(await withTimeout(dialTcp(host, port), timeoutMs, "proxy dial timed out")),
    now: () => Date.now(),
  });
  if (!outcome.ok) {
    // Host-only: credentials never reach errors or logs.
    throw new UpstreamError(`proxy check failed for ${redactProxyTarget(t)} (${outcome.reason})`);
  }
  return jsonOk({ ok: true, ip: outcome.value.ip, loc: outcome.value.loc, responseTimeMs: outcome.value.responseTimeMs });
};
