import { CF_TLS_PORTS } from "../types/settings";
import { HOSTNAME_RE, isIpLiteral, parseHostPort } from "../utils/net";

export type PreferredKind = "direct" | "https" | "sub";

export interface PreferredEntry {
  kind: PreferredKind;
  /** Connect host for direct/sub; "" for https remote lists. Wildcards kept literal. */
  host: string;
  /** Explicit port, or null when the line carries none. */
  port: number | null;
  remark: string;
  /** `$proto://…` chain suffix; parsed but not consumed by node generation in B2. */
  chain: string | null;
  proxyIp: boolean;
  wildcard: boolean;
  /** Raw remote-list URL for https entries, else "". */
  url: string;
  raw: string;
}

export type PreferredParseResult = { ok: true; value: PreferredEntry } | { ok: false; reason: string };

export interface PreferredInvalid {
  line: string;
  reason: string;
}

export interface PreferredList {
  valid: PreferredEntry[];
  invalid: PreferredInvalid[];
}

const MAX_LINE_LEN = 253;
const MAX_REMARK_LEN = 64;
const CHAIN_SCHEMES = ["socks5", "http", "https", "turn", "sstp"] as const;
const PROXYIP_PARAM_RE = /^proxyip=true$/i;

function fail(reason: string): PreferredParseResult {
  return { ok: false, reason };
}

function hasWildcard(host: string): boolean {
  return host.includes("*");
}

// IPv4 with `*` octet segments, or a hostname that may carry `*` labels.
function isWildcardHost(host: string): boolean {
  if (!hasWildcard(host) || host.length === 0 || host.length > 253) return false;
  if (!/^[A-Za-z0-9.*-]+$/.test(host)) return false;
  if (!/[A-Za-z0-9]/.test(host.replace(/\*/g, ""))) return false;
  const segs = host.split(".");
  if (segs.length === 4 && segs.every((s) => s === "*" || /^\d{1,3}$/.test(s))) return true;
  return segs.every((s) => s.length > 0 && s.length <= 63 && /^[A-Za-z0-9*-]+$/.test(s));
}

function splitChain(remark: string): { remark: string; chain: string | null } | null {
  const idx = remark.indexOf("$");
  if (idx === -1) return { remark, chain: null };
  const label = remark.slice(0, idx).trim();
  const chain = remark.slice(idx + 1).trim();
  const scheme = chain.slice(0, chain.indexOf("://")).toLowerCase();
  if (!(CHAIN_SCHEMES as readonly string[]).includes(scheme) || !/^[^:]+:\/\/\S+$/.test(chain)) return null;
  return { remark: label, chain };
}

function readProxyIpQuery(query: string): { proxyIp: boolean } | null {
  let proxyIp = false;
  for (const part of query.split("&")) {
    const p = part.trim();
    if (p.length === 0) continue;
    if (PROXYIP_PARAM_RE.test(p)) {
      proxyIp = true;
      continue;
    }
    return null;
  }
  return { proxyIp };
}

interface CoreParts {
  hostport: string;
  remark: string;
  proxyIp: boolean;
}

// Shared `host[:port][#remark][$chain][?proxyip=true]` core for direct/sub
// bodies. Never throws.
function parseCore(body: string): CoreParts | null {
  let hostport = body;
  let query = "";
  const qIdx = body.indexOf("?");
  if (qIdx !== -1) {
    hostport = body.slice(0, qIdx);
    query = body.slice(qIdx + 1);
  }
  let remark = "";
  const hIdx = hostport.indexOf("#");
  if (hIdx !== -1) {
    remark = hostport.slice(hIdx + 1);
    hostport = hostport.slice(0, hIdx);
  }
  // `#remark?proxyip=true` shape: the flag may trail the fragment instead.
  if (query === "") {
    const m = remark.match(/\?proxyip=true$/i);
    if (m) {
      remark = remark.slice(0, -m[0].length);
      query = "proxyip=true";
    }
  }
  const q = readProxyIpQuery(query);
  if (q === null) return null;
  return { hostport: hostport.trim(), remark: remark.trim(), proxyIp: q.proxyIp };
}

function finishDirect(
  raw: string,
  kind: PreferredKind,
  host: string,
  port: number | null,
  remark: string,
  proxyIp: boolean,
): PreferredParseResult {
  if (remark.length > MAX_REMARK_LEN) return fail("remark is too long (max 64)");
  const chained = splitChain(remark);
  if (chained === null) return fail("invalid $chain suffix (want $socks5|http|https|turn|sstp://…)");
  const wildcard = hasWildcard(host);
  if (wildcard) {
    if (!isWildcardHost(host)) return fail("invalid wildcard host");
  } else if (!isIpLiteral(host) && !(HOSTNAME_RE.test(host) && host.length <= 253)) {
    return fail("address must be an IP, hostname, or *-wildcard");
  }
  return {
    ok: true,
    value: { kind, host, port, remark: chained.remark, chain: chained.chain, proxyIp, wildcard, url: "", raw },
  };
}

function parseDirectBody(raw: string, kind: PreferredKind, body: string): PreferredParseResult {
  if (body.length === 0) return fail("missing address");
  const core = parseCore(body);
  if (core === null) return fail("unsupported query (only ?proxyip=true is allowed)");
  if (core.hostport.length === 0) return fail("missing address");
  const hp = parseHostPort(core.hostport, 0);
  if (hp === null || hp.host.length === 0) return fail("not a valid host[:port] entry");
  if (hp.port < 0 || hp.port > 65535) return fail("port must be between 1 and 65535");
  return finishDirect(raw, kind, hp.host, hp.port === 0 ? null : hp.port, core.remark, core.proxyIp);
}

// Preferred-list line syntax (additive over `host[:port]`):
// `IP:port#remark`, `sub://…[#remark][?proxyip=true]`, `https://…` remote
// lists, `*` wildcard segments, `$proto://…` chain suffixes in remarks.
// Never throws; invalid lines are reported with a reason.
export function parsePreferredLine(line: string): PreferredParseResult {
  if (typeof line !== "string") return fail("not a string");
  const raw = line.trim();
  if (raw.length === 0) return fail("empty line");
  if (raw.length > MAX_LINE_LEN) return fail("line is too long (max 253)");
  // A scheme only counts at line start (`sub://`, `https://`); chain
  // suffixes deeper in the line keep their literal `://`.
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(raw);
  if (schemeMatch !== null) {
    const scheme = schemeMatch[1]!.toLowerCase();
    const body = raw.slice(schemeMatch[0].length);
    if (scheme === "https") {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return fail("not a valid https URL");
      }
      if (url.hostname.length === 0) return fail("not a valid https URL");
      return {
        ok: true,
        value: { kind: "https", host: "", port: null, remark: "", chain: null, proxyIp: false, wildcard: false, url: raw, raw },
      };
    }
    if (scheme === "sub") return parseDirectBody(raw, "sub", body);
    return fail("unsupported scheme (want sub:// or https://)");
  }
  return parseDirectBody(raw, "direct", raw);
}

export function parsePreferredList(text: string): PreferredList {
  const valid: PreferredEntry[] = [];
  const invalid: PreferredInvalid[] = [];
  for (const line of String(text ?? "").split("\n")) {
    if (line.trim().length === 0) continue;
    const r = parsePreferredLine(line);
    if (r.ok) valid.push(r.value);
    else invalid.push({ line: line.trim(), reason: r.reason });
  }
  return { valid, invalid };
}

// Expand `*` segments to 0–255 from the injected rand source (pass
// Math.random in production; tests inject a constant). Non-wildcard hosts
// pass through untouched. Never throws.
export function expandWildcard(host: string, rand: () => number): string {
  if (!hasWildcard(host)) return host;
  const n = (): number => Math.min(255, Math.max(0, Math.floor(rand() * 256)));
  return host.replace(/\*/g, () => String(n()));
}

export function pickRandomTlsPort(rand: () => number): number {
  const ports = CF_TLS_PORTS;
  return ports[Math.min(ports.length - 1, Math.max(0, Math.floor(rand() * ports.length)))]!;
}

export interface FetchPreferredOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export const PREFERRED_FETCH_TIMEOUT_MS = 8000;
export const PREFERRED_FETCH_MAX_BYTES = 256 * 1024;

// Bounded remote-list fetch: timeout + byte cap, never throws. The caller
// must validate the URL (public http(s), no local targets) first.
export async function fetchPreferredText(
  url: string,
  fetchFn: typeof fetch = fetch,
  opts: FetchPreferredOptions = {},
): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  const maxBytes = opts.maxBytes ?? PREFERRED_FETCH_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? PREFERRED_FETCH_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, reason: "preferred list request failed" };
  }
  if (!res.ok) return { ok: false, reason: `preferred list upstream ${res.status}` };
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared.trim());
    if (Number.isInteger(n) && n > maxBytes) return { ok: false, reason: "preferred list response too large" };
  }
  try {
    const reader = res.body?.getReader() ?? null;
    if (reader === null) {
      const text = await res.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        return { ok: false, reason: "preferred list response too large" };
      }
      return { ok: true, value: text };
    }
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, reason: "preferred list response too large" };
      }
      out += decoder.decode(value, { stream: true });
    }
    return { ok: true, value: out + decoder.decode() };
  } catch {
    return { ok: false, reason: "preferred list response unreadable" };
  }
}

// `host:port` strings for proxyip=true direct/sub entries: egress-pool
// candidates. Wildcards and remote lists are skipped (not dialable without
// expansion/fetching). Never throws.
export function preferredProxyIpCandidates(lines: readonly string[], fallbackPort: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const port = Number.isInteger(fallbackPort) && fallbackPort > 0 ? fallbackPort : 443;
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const r = parsePreferredLine(line);
    if (!r.ok || !r.value.proxyIp) continue;
    const e = r.value;
    if (e.kind === "https" || e.wildcard || e.host.length === 0) continue;
    if (!isIpLiteral(e.host) && !HOSTNAME_RE.test(e.host)) continue;
    const key = `${e.host.toLowerCase()}:${e.port ?? port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${e.host}:${e.port ?? port}`);
    if (out.length >= 64) break;
  }
  return out;
}
