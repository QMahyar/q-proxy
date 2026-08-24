import { concatBytes, utf8Decode } from "../utils/bytes";

export interface DialTargetLite {
  host: string;
  port: number;
}

export interface ParsedRequest<C extends "tcp" | "udp"> {
  command: C;
  target: DialTargetLite;
}

export type PushOutcome<R> =
  | { state: "need-more" }
  | { state: "ready"; parsed: R; rest: Uint8Array }
  | { state: "reject"; reason: string };

export interface DownlinkEncoder {
  header(): Uint8Array | null;
  encode(chunk: Uint8Array): Promise<Uint8Array>;
}

export interface BodyCodec {
  decodeUp(chunk: Uint8Array): Promise<Uint8Array | null>;
  beginDownlink(): DownlinkEncoder;
}

export interface ProtocolInbound<R> {
  push(data: Uint8Array): Promise<PushOutcome<R>>;
  responseHeader(): Uint8Array | null;
  takeInitialPayload(): Uint8Array | null;
  bodyCodec(): BodyCodec | null;
}

export const BODY_BUFFER_CAP = 65536;

export function appendChunk(buffer: Uint8Array[], data: Uint8Array): boolean {
  if (buffer.reduce((n, c) => n + c.length, 0) + data.length > BODY_BUFFER_CAP) return false;
  buffer.push(data);
  return true;
}

export function bufferedLength(buffer: Uint8Array[]): number {
  return buffer.reduce((n, c) => n + c.length, 0);
}

export function drainChunks(buffer: Uint8Array[], length?: number): Uint8Array {
  let total = 0;
  for (const c of buffer) total += c.length;
  const take = length === undefined ? total : Math.min(total, length);
  const out = new Uint8Array(take);
  let off = 0;
  while (off < take && buffer.length > 0) {
    const c = buffer[0]!;
    const n = Math.min(c.length, take - off);
    out.set(c.subarray(0, n), off);
    off += n;
    if (n < c.length) buffer[0] = c.subarray(n);
    else buffer.shift();
  }
  return out;
}

export function peekFlat(buffer: Uint8Array[], length: number): Uint8Array | null {
  let total = 0;
  for (const c of buffer) total += c.length;
  if (total < length) return null;
  const out = new Uint8Array(length);
  let off = 0;
  for (const c of buffer) {
    const n = Math.min(c.length, length - off);
    out.set(c.subarray(0, n), off);
    off += n;
    if (off === length) break;
  }
  return out;
}

export function dropChunks(buffer: Uint8Array[], length: number): void {
  let remaining = length;
  while (remaining > 0 && buffer.length > 0) {
    const c = buffer[0]!;
    if (c.length <= remaining) {
      remaining -= c.length;
      buffer.shift();
    } else {
      buffer[0] = c.subarray(remaining);
      remaining = 0;
    }
  }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export const HANDSHAKE_CAP = 16384;

export class ByteAccumulator {
  private chunks: Uint8Array[] = [];
  private totalLen = 0;

  get length(): number {
    return this.totalLen;
  }

  append(data: Uint8Array): boolean {
    if (this.totalLen + data.length > HANDSHAKE_CAP) return false;
    this.chunks.push(data);
    this.totalLen += data.length;
    return true;
  }

  drain(): Uint8Array {
    const out = concatBytes(...this.chunks);
    this.chunks = [];
    this.totalLen = 0;
    return out;
  }
}

const ATYPE_IPV4 = 1;

function ipv4ToString(buf: Uint8Array, offset: number): string {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}

function ipv6ToString(buf: Uint8Array, offset: number): string {
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(((buf[offset + i * 2]! << 8) | buf[offset + i * 2 + 1]!).toString(16));
  }
  return groups.join(":");
}

export type AddressNumbering = "vless" | "socks";

export function parseAddressValue(
  atype: number,
  buf: Uint8Array,
  offset: number,
  numbering: AddressNumbering = "vless",
): ParseResult<{ host: string; nextOffset: number }> {
  const domainType = numbering === "vless" ? 2 : 3;
  const ipv6Type = numbering === "vless" ? 3 : 4;
  if (atype === ATYPE_IPV4) {
    if (buf.length - offset < 4) return { ok: false, reason: "truncated ipv4 address" };
    return { ok: true, value: { host: ipv4ToString(buf, offset), nextOffset: offset + 4 } };
  }
  if (atype === domainType) {
    if (buf.length - offset < 1) return { ok: false, reason: "truncated domain length" };
    const len = buf[offset]!;
    if (len === 0) return { ok: false, reason: "empty domain" };
    if (buf.length - offset - 1 < len) return { ok: false, reason: "truncated domain" };
    const raw = buf.subarray(offset + 1, offset + 1 + len);
    for (const b of raw) {
      if (b === 0) return { ok: false, reason: "invalid domain byte" };
    }
    return {
      ok: true,
      value: { host: utf8Decode(raw).toLowerCase(), nextOffset: offset + 1 + len },
    };
  }
  if (atype === ipv6Type) {
    if (buf.length - offset < 16) return { ok: false, reason: "truncated ipv6 address" };
    return { ok: true, value: { host: ipv6ToString(buf, offset), nextOffset: offset + 16 } };
  }
  return { ok: false, reason: `invalid address type ${atype}` };
}

export function parseAddress(
  atype: number,
  buf: Uint8Array,
  offset: number,
): ParseResult<{ host: string; port: number; nextOffset: number }> {
  const addr = parseAddressValue(atype, buf, offset, "socks");
  if (!addr.ok) return addr;
  const portOffset = addr.value.nextOffset;
  if (buf.length - portOffset < 2) return { ok: false, reason: "truncated port" };
  const port = (buf[portOffset]! << 8) | buf[portOffset + 1]!;
  if (port === 0) return { ok: false, reason: "invalid port 0" };
  return { ok: true, value: { ...addr.value, port, nextOffset: portOffset + 2 } };
}
