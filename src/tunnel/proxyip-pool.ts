import type { Settings } from "../types/settings";
import { isCloudflareIp, isIPv4, isIPv6, isLocalOrPrivateTarget, parseHostPort } from "../utils/net";
import { dialTcp } from "./chain";
import { expandProxyIps, hashSeed, shuffleDeterministic } from "./proxyip";
import { createResolver } from "./resolver";
import type { DohResolver } from "./resolver";

export interface RelayEndpoint {
  ip: string;
  port: number;
}

export type PoolSource = "list" | "url" | "doh";

export interface ProxyPoolResult {
  endpoints: RelayEndpoint[];
  source: PoolSource;
}

const DEFAULT_DOH_UPSTREAM = "https://cloudflare-dns.com/dns-query";
const DEFAULT_RELAY_PORT = 443;
const MAX_POOL_ENDPOINTS = 64;
const MAX_RELAY_CANDIDATES = 8;
const MAX_POOL_TEXT_BYTES = 256 * 1024;
const POOL_FETCH_TIMEOUT_MS = 10_000;
const RELAY_CACHE_TTL_MS = 300_000;
const RELAY_CACHE_MAX = 16;
const TCP_PROBE_TIMEOUT_MS = 4000;
const CMLIUSSS_RELAY_DOMAIN = "proxyip.cmliussss.net";
const TP_RELAY_DOMAIN = "proxyip.tp1.090227.xyz";

interface RelayCacheEntry {
  endpoints: RelayEndpoint[];
  expiresAt: number;
}

const relayCache = new Map<string, RelayCacheEntry>();

export function clearRelayEndpointCache(): void {
  relayCache.clear();
}

function normalizeColo(colo: string): string {
  return colo.trim().toLowerCase();
}

function relayDomains(colo: string): string[] {
  const primary = colo.length > 0 ? `${colo}.${CMLIUSSS_RELAY_DOMAIN}` : CMLIUSSS_RELAY_DOMAIN;
  return [primary, TP_RELAY_DOMAIN];
}

function relayCachePut(key: string, endpoints: RelayEndpoint[]): void {
  if (endpoints.length === 0) return;
  if (relayCache.size >= RELAY_CACHE_MAX) {
    const oldest = relayCache.keys().next();
    if (!oldest.done) relayCache.delete(oldest.value);
  }
  relayCache.set(key, { endpoints, expiresAt: Date.now() + RELAY_CACHE_TTL_MS });
}

function relayCacheGet(key: string): RelayEndpoint[] | null {
  const entry = relayCache.get(key);
  if (entry === undefined) return null;
  if (Date.now() > entry.expiresAt) {
    relayCache.delete(key);
    return null;
  }
  return entry.endpoints;
}

function endpointKey(ep: RelayEndpoint): string {
  return `${ep.ip}:${ep.port}`;
}

export async function resolveRelayEndpoints(
  settings: Settings,
  colo: string,
  doh?: DohResolver,
  seedHost?: string,
): Promise<RelayEndpoint[]> {
  const key = normalizeColo(colo);
  const domains = relayDomains(key);
  const seed = hashSeed(seedHost ?? domains.join("|"));
  const cached = relayCacheGet(key);
  if (cached !== null) {
    return shuffleDeterministic(cached, seed).slice(0, MAX_RELAY_CANDIDATES);
  }
  const resolver = doh ?? createResolver(settings.dohUpstream || DEFAULT_DOH_UPSTREAM);
  const entries = await expandProxyIps(domains, { resolver });
  const endpoints = entries.map((e) => ({ ip: e.host, port: e.port }));
  relayCachePut(key, endpoints);
  return shuffleDeterministic(endpoints, seed).slice(0, MAX_RELAY_CANDIDATES);
}

function extractPoolTokens(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {}
  }
  return trimmed.split(/[\n\r,;]+/);
}

function parsePoolToken(token: string): RelayEndpoint | null {
  const t = token.trim().replace(/^["']+|["']+$/g, "").toLowerCase();
  if (t.length === 0 || /\s/.test(t)) return null;
  const hp = parseHostPort(t, DEFAULT_RELAY_PORT);
  if (hp === null || hp.host.length === 0) return null;
  if (!isIPv4(hp.host) && !isIPv6(hp.host) && !/^[a-z0-9.-]+$/.test(hp.host)) return null;
  return { ip: hp.host, port: hp.port };
}

export function parsePoolEndpoints(text: string): RelayEndpoint[] {
  const out: RelayEndpoint[] = [];
  const seen = new Set<string>();
  for (const token of extractPoolTokens(text)) {
    const ep = parsePoolToken(token);
    if (ep === null) continue;
    if (isLocalOrPrivateTarget(ep.ip) || isCloudflareIp(ep.ip)) continue;
    const key = endpointKey(ep);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ep);
    if (out.length >= MAX_POOL_ENDPOINTS) break;
  }
  return out;
}

function isFetchableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (isLocalOrPrivateTarget(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchPoolUrl(url: string): Promise<RelayEndpoint[]> {
  if (!isFetchableUrl(url)) return [];
  let text: string;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
      signal: AbortSignal.timeout(POOL_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }
  if (text.length > MAX_POOL_TEXT_BYTES) text = text.slice(0, MAX_POOL_TEXT_BYTES);
  return parsePoolEndpoints(text);
}

export async function tcpProbe(host: string, port: number): Promise<number | null> {
  const started = Date.now();
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const pending = dialTcp(host, port);
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`tcp probe timed out after ${TCP_PROBE_TIMEOUT_MS}ms`)), TCP_PROBE_TIMEOUT_MS);
  });
  try {
    await Promise.race([pending, timeout]);
    return Date.now() - started;
  } catch {
    return null;
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
    void pending
      .then((socket) => socket.close().catch(() => {}))
      .catch(() => {});
  }
}

export async function collectProxyPoolDetailed(settings: Settings, colo: string): Promise<ProxyPoolResult> {
  const resolver = createResolver(settings.dohUpstream || DEFAULT_DOH_UPSTREAM);
  const listEntries = await expandProxyIps(settings.proxyIps, { resolver });
  const seen = new Set<string>();
  const endpoints: RelayEndpoint[] = [];
  const pushAll = (items: readonly RelayEndpoint[]): void => {
    for (const ep of items) {
      const key = endpointKey(ep);
      if (seen.has(key)) continue;
      seen.add(key);
      endpoints.push(ep);
    }
  };
  pushAll(listEntries.map((e) => ({ ip: e.host, port: e.port })));
  const poolUrl = settings.proxyIpPoolUrl.trim();
  if (poolUrl.length > 0) pushAll(await fetchPoolUrl(poolUrl));
  let source: PoolSource = "list";
  if (endpoints.length === 0) {
    source = "doh";
    pushAll(await resolveRelayEndpoints(settings, colo));
  } else if (listEntries.length === 0) {
    source = "url";
  }
  return { endpoints: endpoints.slice(0, MAX_POOL_ENDPOINTS), source };
}

export async function collectProxyPool(settings: Settings, colo: string): Promise<RelayEndpoint[]> {
  return (await collectProxyPoolDetailed(settings, colo)).endpoints;
}
