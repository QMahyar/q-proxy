import { writeU16BE } from "../utils/bytes";
import type { DnsPacketRelay } from "../types/tunnel";

export const DNS_TYPE_A = 1;
export const DNS_TYPE_TXT = 16;
export const DNS_TYPE_AAAA = 28;

const CACHE_TTL_MS = 300_000;
const CACHE_MAX_ENTRIES = 256;
const MAX_DNS_PACKET_BYTES = 4096;
const DOH_TIMEOUT_MS = 5000;

interface CacheEntry {
  value: string[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
let nextQueryId = 1;

export function clearResolverCache(): void {
  cache.clear();
}

function cacheKey(dohUrl: string, name: string, qtype: number): string {
  return `${dohUrl}|${name.toLowerCase()}|${qtype}`;
}

function cacheGet(key: string): string[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cachePut(key: string, value: string[]): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function buildDnsQuery(name: string, qtype: number): Uint8Array | null {
  const labels = name
    .replace(/^\.+|\.+$/g, "")
    .split(".")
    .filter((l) => l.length > 0);
  if (labels.length === 0) return null;
  if (labels.some((l) => l.length > 63)) return null;
  let qlen = 1;
  for (const label of labels) qlen += label.length + 1;
  const out = new Uint8Array(12 + qlen + 4);
  nextQueryId = (nextQueryId % 0xffff) + 1;
  out[0] = (nextQueryId >>> 8) & 0xff;
  out[1] = nextQueryId & 0xff;
  out[2] = 0x01;
  out[3] = 0x00;
  out[5] = 1;
  let off = 12;
  for (const label of labels) {
    out[off++] = label.length;
    for (let i = 0; i < label.length; i++) out[off++] = label.charCodeAt(i) & 0xff;
  }
  out[off++] = 0;
  writeU16BE(out, off, qtype);
  writeU16BE(out, off + 2, 1);
  return out;
}

function readName(
  buf: Uint8Array,
  offset: number,
): { name: string; next: number } | null {
  const labels: string[] = [];
  let ptr = offset;
  let next = -1;
  let jumps = 0;
  for (;;) {
    if (ptr >= buf.length) return null;
    const len = buf[ptr]!;
    if (len === 0) {
      if (next === -1) next = ptr + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (ptr + 1 >= buf.length) return null;
      const target = ((len & 0x3f) << 8) | buf[ptr + 1]!;
      if (next === -1) next = ptr + 2;
      ptr = target;
      jumps++;
      if (jumps > 32 || ptr >= buf.length) return null;
      continue;
    }
    if (len > 63 || ptr + 1 + len > buf.length) return null;
    labels.push(String.fromCharCode(...buf.subarray(ptr + 1, ptr + 1 + len)).toLowerCase());
    ptr += 1 + len;
  }
  if (next === -1) return null;
  return { name: labels.join("."), next };
}

function decodeRdata(rtype: number, rdata: Uint8Array): string | null {
  if (rtype === DNS_TYPE_A && rdata.length === 4) {
    return `${rdata[0]}.${rdata[1]}.${rdata[2]}.${rdata[3]}`;
  }
  if (rtype === DNS_TYPE_AAAA && rdata.length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push(((rdata[i]! << 8) | rdata[i + 1]!).toString(16));
    }
    return groups.join(":");
  }
  if (rtype === DNS_TYPE_TXT) {
    let text = "";
    let p = 0;
    while (p < rdata.length) {
      const l = rdata[p]!;
      p += 1;
      if (p + l > rdata.length) break;
      text += String.fromCharCode(...rdata.subarray(p, p + l));
      p += l;
    }
    return text;
  }
  return null;
}

export function parseDnsAnswers(msg: Uint8Array, wantType: number): string[] {
  if (msg.length < 12) return [];
  const flags = (msg[2]! << 8) | msg[3]!;
  if ((flags & 0x8000) === 0) return [];
  if ((flags & 0x000f) !== 0) return [];
  const qdcount = (msg[4]! << 8) | msg[5]!;
  const ancount = (msg[6]! << 8) | msg[7]!;
  let off = 12;
  for (let i = 0; i < qdcount; i++) {
    const qn = readName(msg, off);
    if (qn === null) return [];
    off = qn.next + 4;
    if (off > msg.length) return [];
  }
  const out: string[] = [];
  for (let i = 0; i < ancount && off < msg.length; i++) {
    const rn = readName(msg, off);
    if (rn === null) break;
    off = rn.next;
    if (off + 10 > msg.length) break;
    const rtype = (msg[off]! << 8) | msg[off + 1]!;
    const rdlength = (msg[off + 8]! << 8) | msg[off + 9]!;
    off += 10;
    if (off + rdlength > msg.length) break;
    if (rtype === wantType) {
      const value = decodeRdata(rtype, msg.subarray(off, off + rdlength));
      if (value !== null) out.push(value);
    }
    off += rdlength;
  }
  return out;
}

async function dohPost(dohUrl: string, query: Uint8Array): Promise<Uint8Array | null> {
  try {
    const res = await fetch(dohUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
        Accept: "application/dns-message",
      },
      body: query as unknown as BodyInit,
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 12) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export interface DohResolver {
  resolveA(name: string): Promise<string[]>;
  resolveAAAA(name: string): Promise<string[]>;
  resolveTXT(name: string): Promise<string[]>;
}

export function createResolver(dohUrl: string): DohResolver {
  const lookup = async (name: string, qtype: number): Promise<string[]> => {
    const trimmed = name.trim().replace(/\.+$/, "").toLowerCase();
    if (trimmed.length === 0) return [];
    const key = cacheKey(dohUrl, trimmed, qtype);
    const hit = cacheGet(key);
    if (hit !== null) return hit;
    const query = buildDnsQuery(trimmed, qtype);
    if (query === null) return [];
    const resp = await dohPost(dohUrl, query);
    const values = resp === null ? [] : parseDnsAnswers(resp, qtype);
    cachePut(key, values);
    return values;
  };
  return {
    resolveA: (name) => lookup(name, DNS_TYPE_A),
    resolveAAAA: (name) => lookup(name, DNS_TYPE_AAAA),
    resolveTXT: (name) => lookup(name, DNS_TYPE_TXT),
  };
}

export function createDnsPacketRelay(dohUrl: string): DnsPacketRelay {
  return async (rawDnsPacket) => {
    if (rawDnsPacket.length < 12 || rawDnsPacket.length > MAX_DNS_PACKET_BYTES) return null;
    return dohPost(dohUrl, rawDnsPacket);
  };
}
