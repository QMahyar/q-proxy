import type { DialTarget } from "../../types/tunnel";
import { concatBytes, utf8Encode, writeU16BE } from "../../utils/bytes";
import { isIPv4, isIPv6 } from "../../utils/net";

export interface DuplexIO {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void> | void;
}

export interface ProxyCredentials {
  username: string | null;
  password: string | null;
}

const MAX_HANDSHAKE_BYTES = 16384;

export class BufferedByteReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private queue: Uint8Array[] = [];
  private queued = 0;
  private consumed = 0;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  get totalConsumed(): number {
    return this.consumed;
  }

  async pull(): Promise<Uint8Array | null> {
    if (this.queue.length > 0) {
      const chunk = this.queue.shift()!;
      this.queued -= chunk.length;
      this.consumed += chunk.length;
      return chunk;
    }
    const result = await this.reader.read();
    if (result.done || result.value === undefined) return null;
    this.consumed += result.value.length;
    return result.value;
  }

  async readExact(n: number): Promise<Uint8Array | null> {
    if (n <= 0) return new Uint8Array(0);
    while (this.queued < n) {
      const result = await this.reader.read();
      if (result.done || result.value === undefined) return null;
      this.queue.push(result.value);
      this.queued += result.value.length;
    }
    if (this.queue.length === 1 && this.queue[0]!.length === n) {
      const exact = this.queue.shift()!;
      this.queued -= n;
      return exact;
    }
    const taken: Uint8Array[] = [];
    const rest: Uint8Array[] = [];
    let have = 0;
    for (const chunk of this.queue) {
      if (have >= n) {
        rest.push(chunk);
        continue;
      }
      const need = n - have;
      if (chunk.length <= need) {
        taken.push(chunk);
        have += chunk.length;
      } else {
        taken.push(chunk.subarray(0, need));
        rest.push(chunk.subarray(need));
        have = n;
      }
    }
    this.queue = rest;
    this.queued -= have;
    return concatBytes(...taken);
  }

  drainLeftover(): Uint8Array | null {
    if (this.queued === 0 && this.queue.length === 0) return null;
    const out = concatBytes(...this.queue);
    this.queue = [];
    this.queued = 0;
    return out.length > 0 ? out : null;
  }

  release(): void {
    try {
      this.reader.releaseLock();
    } catch {
      return;
    }
  }
}

export function findCrlfCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

export function prependReadable(
  prefix: Uint8Array | null,
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  if (prefix === null || prefix.length === 0) return source;
  const t = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
    },
  });
  void source.pipeTo(t.writable).catch(() => {});
  return t.readable;
}

function ipv6ToBytes(host: string): Uint8Array | null {
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string): string[] | null => {
    if (s.length === 0) return [];
    const parts = s.split(":");
    if (parts.some((p) => !/^[0-9a-fA-F]{1,4}$/.test(p))) return null;
    return parts;
  };
  const head = parse(halves[0]!);
  if (head === null) return null;
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (tail === null) return null;
  const groups = new Array<number>(8).fill(0);
  if (halves.length === 2) {
    if (head.length + tail.length > 8) return null;
    head.forEach((p, i) => (groups[i] = parseInt(p, 16)));
    tail.forEach((p, i) => (groups[8 - tail.length + i] = parseInt(p, 16)));
  } else {
    if (head.length !== 8) return null;
    head.forEach((p, i) => (groups[i] = parseInt(p, 16)));
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) writeU16BE(out, i * 2, groups[i]!);
  return out;
}

function buildConnectRequest(target: DialTarget): Uint8Array {
  const head = [0x05, 0x01, 0x00];
  if (isIPv4(target.host)) {
    const octets = target.host.split(".").map(Number);
    const body = new Uint8Array(4 + 2);
    for (let i = 0; i < 4; i++) body[i] = octets[i]!;
    writeU16BE(body, 4, target.port);
    return concatBytes(new Uint8Array(head), new Uint8Array([0x01]), body);
  }
  if (isIPv6(target.host)) {
    const bytes = ipv6ToBytes(target.host);
    if (bytes !== null) {
      const body = new Uint8Array(16 + 2);
      body.set(bytes, 0);
      writeU16BE(body, 16, target.port);
      return concatBytes(new Uint8Array(head), new Uint8Array([0x04]), body);
    }
  }
  const hostBytes = utf8Encode(target.host);
  if (hostBytes.length > 255) throw new Error("socks5 target hostname too long");
  const body = new Uint8Array(1 + hostBytes.length + 2);
  body[0] = hostBytes.length;
  body.set(hostBytes, 1);
  writeU16BE(body, 1 + hostBytes.length, target.port);
  return concatBytes(new Uint8Array(head), new Uint8Array([0x03]), body);
}

export async function connectOverSocks5(
  io: DuplexIO,
  creds: ProxyCredentials,
  target: DialTarget,
  firstPacket: Uint8Array | null,
): Promise<DuplexIO & { close(): Promise<void> | void }> {
  if (target.port < 1 || target.port > 65535) throw new Error("invalid target port");
  const writer = io.writable.getWriter();
  try {
    const methods = creds.username !== null ? [0x00, 0x02] : [0x00];
    await writer.write(concatBytes(new Uint8Array([0x05, methods.length]), new Uint8Array(methods)));
    const reader = new BufferedByteReader(io.readable);
    let greet: Uint8Array | null;
    try {
      greet = await reader.readExact(2);
    } catch (err) {
      throw new Error(`socks5 greeting read failed: ${String(err)}`);
    }
    if (greet === null) throw new Error("socks5 closed during greeting");
    if (greet[0] !== 0x05) throw new Error("socks5 bad version in reply");
    const method = greet[1]!;
    if (method === 0xff) throw new Error("socks5 no acceptable method");
    if (method === 0x02) {
      if (creds.username === null) throw new Error("socks5 server demanded auth");
      const user = utf8Encode(creds.username);
      const pass = utf8Encode(creds.password ?? "");
      if (user.length > 255 || pass.length > 255) throw new Error("socks5 credentials too long");
      const authReq = concatBytes(
        new Uint8Array([0x01, user.length]),
        user,
        new Uint8Array([pass.length]),
        pass,
      );
      await writer.write(authReq);
      const authReply = await reader.readExact(2);
      if (authReply === null) throw new Error("socks5 closed during auth");
      if (authReply[0] !== 0x01 || authReply[1] !== 0x00) throw new Error("socks5 auth rejected");
    } else if (method !== 0x00) {
      throw new Error(`socks5 unsupported method ${method}`);
    }
    await writer.write(buildConnectRequest(target));
    let replyHead: Uint8Array | null;
    try {
      replyHead = await reader.readExact(4);
    } catch (err) {
      throw new Error(`socks5 connect read failed: ${String(err)}`);
    }
    if (replyHead === null) throw new Error("socks5 closed during connect");
    if (replyHead[0] !== 0x05) throw new Error("socks5 bad version in connect reply");
    if (replyHead[1] !== 0x00) throw new Error(`socks5 connect failed code ${replyHead[1]}`);
    const atyp = replyHead[3]!;
    let boundExtra = 0;
    if (atyp === 0x01) boundExtra = 4;
    else if (atyp === 0x04) boundExtra = 16;
    else if (atyp === 0x03) {
      const lenByte = await reader.readExact(1);
      if (lenByte === null) throw new Error("socks5 truncated domain bound address");
      boundExtra = lenByte[0]!;
    } else {
      throw new Error(`socks5 invalid bound atyp ${atyp}`);
    }
    if (boundExtra + 2 > MAX_HANDSHAKE_BYTES) throw new Error("socks5 bound address too large");
    const tail = await reader.readExact(boundExtra + 2);
    if (tail === null) throw new Error("socks5 truncated bound address");
    const leftover = reader.drainLeftover();
    reader.release();
    if (firstPacket !== null && firstPacket.length > 0) await writer.write(firstPacket);
    writer.releaseLock();
    return {
      readable: prependReadable(leftover, io.readable),
      writable: io.writable,
      close: () => io.close(),
    };
  } catch (err) {
    try {
      writer.releaseLock();
    } catch {}
    throw err instanceof Error ? err : new Error(String(err));
  }
}
