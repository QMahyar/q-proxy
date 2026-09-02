import { isCloudflareIp, isIPv4, isIPv6, isLocalOrPrivateTarget, parseHostPort } from "../utils/net";
import { createResolver } from "./resolver";
import type { DohResolver } from "./resolver";

export interface ProxyIpEntry {
  host: string;
  port: number;
  label: string;
}

export interface ExpandOptions {
  resolver?: DohResolver;
}

const DEFAULT_PROXY_PORT = 443;
const TP_PORT_RE = /\.tp(\d{1,5})$/;

type Classified =
  | { kind: "addr"; host: string; port: number }
  | { kind: "domain"; host: string; port: number };

function classifyToken(token: string): Classified | null {
  let t = token.trim().replace(/^["']+|["']+$/g, "").toLowerCase();
  if (t.length === 0) return null;
  let portOverride: number | null = null;
  const tp = TP_PORT_RE.exec(t);
  if (tp !== null) {
    const p = Number(tp[1]);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
    portOverride = p;
    t = t.slice(0, tp.index);
    if (t.length === 0) return null;
  }
  const hp = parseHostPort(t, DEFAULT_PROXY_PORT);
  if (hp === null) return null;
  const port = portOverride ?? hp.port;
  if (isIPv4(hp.host) || isIPv6(hp.host)) return { kind: "addr", host: hp.host, port };
  if (!/^[a-z0-9.-]+$/.test(hp.host)) return null;
  return { kind: "domain", host: hp.host, port };
}

function tokenizeEntry(entry: string): string[] {
  return entry
    .replace(/\\010/gi, "\n")
    .split(/[\n\r,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function splitTxtList(txt: string): string[] {
  return txt
    .replace(/\\010/gi, "\n")
    .split(/[\n\r\x08,;]+/)
    .map((t) => t.trim().replace(/^["']+|["']+$/g, ""))
    .filter((t) => t.length > 0);
}

async function expandDomain(
  domain: { host: string; port: number },
  resolver: DohResolver,
  push: (host: string, port: number, label: string) => void,
): Promise<void> {
  let expanded = false;
  try {
    const records = await resolver.resolveTXT(domain.host);
    for (const record of records) {
      for (const token of splitTxtList(record)) {
        const inner = classifyToken(token);
        if (inner === null) continue;
        push(inner.host, inner.port, `${inner.host}:${inner.port} txt:${domain.host}`);
        expanded = true;
      }
    }
  } catch {
    expanded = false;
  }
  if (expanded) return;
  try {
    const aRecords = await resolver.resolveA(domain.host);
    for (const ip of aRecords) {
      if (!isIPv4(ip)) continue;
      push(ip, domain.port, `${ip}:${domain.port} a:${domain.host}`);
      expanded = true;
    }
    if (expanded) return;
    const aaaa = await resolver.resolveAAAA(domain.host);
    for (const ip of aaaa) {
      if (!isIPv6(ip)) continue;
      push(ip, domain.port, `${ip}:${domain.port} aaaa:${domain.host}`);
    }
  } catch {
    return;
  }
}

export async function expandProxyIps(
  entries: readonly string[],
  opts?: ExpandOptions,
): Promise<ProxyIpEntry[]> {
  const resolver = opts?.resolver ?? createResolver("https://cloudflare-dns.com/dns-query");
  const out: ProxyIpEntry[] = [];
  const seen = new Set<string>();
  const push = (host: string, port: number, label: string): void => {
    const bare = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (isLocalOrPrivateTarget(bare) || isCloudflareIp(bare)) return;
    const key = `${host}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ host, port, label });
  };
  const domainTasks: Array<Promise<void>> = [];
  for (const entry of entries) {
    for (const token of tokenizeEntry(entry)) {
      const classified = classifyToken(token);
      if (classified === null) continue;
      if (classified.kind === "addr") {
        push(classified.host, classified.port, `${classified.host}:${classified.port}`);
      } else {
        domainTasks.push(expandDomain(classified, resolver, push));
      }
    }
  }
  await Promise.all(domainTasks);
  return out;
}

export function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleDeterministic<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1 > 0 ? arr.length - 1 : 0; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
