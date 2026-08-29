import { constantTimeEqual } from "../utils/random";
import { sha224Hex } from "../crypto/sha224";
import {
  ByteAccumulator,
  parseAddress,
  type BodyCodec,
  type DownlinkEncoder,
  type ParsedRequest,
  type ProtocolInbound,
  type PushOutcome,
} from "./common";
import { concatBytes, u16be, utf8Encode, writeU16BE } from "../utils/bytes";

type TrojanRequest = ParsedRequest<"tcp"> | ParsedRequest<"udp">;

const AUTH_HASH_LEN = 56;
const CMD_CONNECT = 0x01;
const CMD_UDP_ASSOCIATE = 0x03;
const DNS_PORT = 53;

interface UdpSource {
  atype: number;
  host: string;
  port: number;
  rawAddr?: Uint8Array;
}

const DEFAULT_UDP_SOURCE: UdpSource = { atype: 1, host: "0.0.0.0", port: DNS_PORT };

export function createTrojanInbound(password: string): ProtocolInbound<TrojanRequest> {
  const expectedHash = sha224Hex(password);
  let acc = new ByteAccumulator();
  let done = false;
  let handshakeOk = false;
  let initialPayload: Uint8Array | null = null;
  let udpMode = false;

  return {
    async push(data: Uint8Array): Promise<PushOutcome<TrojanRequest>> {
      if (done) return { state: "reject", reason: "data after completed handshake" };
      if (!acc.append(data)) return { state: "reject", reason: "handshake too large" };
      const buf = acc.drain();
      const outcome = tryParse(buf);
      if (outcome.state === "need-more") {
        acc.append(buf);
        return outcome;
      }
      done = true;
      if (outcome.state === "ready") handshakeOk = true;
      return outcome;
    },
    responseHeader(): Uint8Array | null {
      return null;
    },
    takeInitialPayload(): Uint8Array | null {
      const p = initialPayload;
      initialPayload = null;
      return p;
    },
    bodyCodec(): BodyCodec | null {
      if (!handshakeOk) return null;
      if (!udpMode) return null;
      return createTrojanUdpCodec();
    },
  };

  function tryParse(buf: Uint8Array): PushOutcome<TrojanRequest> {
    if (buf.length < AUTH_HASH_LEN + 2) return { state: "need-more" };
    if (buf[AUTH_HASH_LEN] !== 0x0d || buf[AUTH_HASH_LEN + 1] !== 0x0a) {
      return { state: "reject", reason: "invalid header format (missing CR LF)" };
    }
    const presented = utf8Lowercase(buf.subarray(0, AUTH_HASH_LEN));
    if (!constantTimeEqual(presented, expectedHash)) {
      return { state: "reject", reason: "invalid password" };
    }
    const socksOffset = AUTH_HASH_LEN + 2;
    if (buf.length < socksOffset + 1) return { state: "need-more" };
    const cmd = buf[socksOffset]!;
    if (cmd !== CMD_CONNECT && cmd !== CMD_UDP_ASSOCIATE) {
      return { state: "reject", reason: `unsupported command ${cmd}` };
    }
    const atypeOffset = socksOffset + 1;
    if (buf.length < atypeOffset + 1) return { state: "need-more" };
    const atype = buf[atypeOffset]!;
    const addr = parseAddress(atype, buf, atypeOffset + 1);
    if (!addr.ok) {
      return addr.reason.startsWith("truncated")
        ? { state: "need-more" }
        : { state: "reject", reason: addr.reason };
    }
    if (cmd === CMD_UDP_ASSOCIATE && addr.value.port !== DNS_PORT) {
      return { state: "reject", reason: "udp proxy only allowed for port 53" };
    }
    const crlfOffset = addr.value.nextOffset;
    if (buf.length < crlfOffset + 2) return { state: "need-more" };
    if (buf[crlfOffset] !== 0x0d || buf[crlfOffset + 1] !== 0x0a) {
      return { state: "reject", reason: "invalid header format (missing CR LF)" };
    }
    udpMode = cmd === CMD_UDP_ASSOCIATE;
    initialPayload = buf.subarray(crlfOffset + 2);
    return {
      state: "ready",
      parsed: {
        command: cmd === CMD_CONNECT ? "tcp" : "udp",
        target: { host: addr.value.host, port: addr.value.port },
      },
      rest: initialPayload,
    };
  }

  function createTrojanUdpCodec(): BodyCodec {
    let buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let alive = true;
    const srcQueue: UdpSource[] = [];
    let currentSrc: UdpSource = DEFAULT_UDP_SOURCE;
    return {
      async decodeUp(chunk: Uint8Array): Promise<Uint8Array | null> {
        if (!alive) return null;
        if (chunk.length > 0) {
          if (buf.length + chunk.length > 65536) {
            alive = false;
            return null;
          }
          buf = concatBytes(buf as Uint8Array, chunk as Uint8Array) as Uint8Array<ArrayBufferLike>;
        }
        const parts: Uint8Array[] = [];
        let off = 0;
        while (off < buf.length) {
          const atype = buf[off]!;
          const addr = parseAddress(atype, buf, off + 1);
          if (!addr.ok) {
            if (addr.reason.startsWith("truncated")) break;
            alive = false;
            return null;
          }
          const afterAddr = addr.value.nextOffset;
          if (buf.length - afterAddr < 4) break;
          const len = (buf[afterAddr]! << 8) | buf[afterAddr + 1]!;
          if (buf[afterAddr + 2] !== 0x0d || buf[afterAddr + 3] !== 0x0a) {
            alive = false;
            return null;
          }
          const total = afterAddr + 4 + len;
          if (buf.length < total) break;
          parts.push(buf.subarray(afterAddr + 4, total));
          srcQueue.push({
            atype,
            host: addr.value.host,
            port: addr.value.port,
            rawAddr: buf.subarray(off, afterAddr).slice(),
          });
          off = total;
        }
        if (off > 0) buf = buf.subarray(off);
        if (parts.length === 0) return new Uint8Array(0);
        return concatBytes(...parts);
      },
      beginDownlink(): DownlinkEncoder {
        return {
          header(): Uint8Array | null {
            return null;
          },
          async encode(chunk: Uint8Array): Promise<Uint8Array> {
            if (chunk.length === 0) return new Uint8Array(0);
            if (chunk.length > 0xffff) return new Uint8Array(0);
            const next = srcQueue.shift();
            if (next !== undefined) currentSrc = next;
            const src = currentSrc;
            const addrPart = src.rawAddr ?? encodeAddressPart(src.atype, src.host, src.port);
            const tail = new Uint8Array(4);
            writeU16BE(tail, 0, chunk.length);
            tail[2] = 0x0d;
            tail[3] = 0x0a;
            return concatBytes(addrPart, tail, chunk);
          },
        };
      },
    };
  }
}

function encodeAddressPart(atype: number, host: string, port: number): Uint8Array {
  if (atype === 1) {
    const o = host.split(".");
    return concatBytes(
      new Uint8Array([1, Number(o[0]!), Number(o[1]!), Number(o[2]!), Number(o[3]!)]),
      u16be(port),
    );
  }
  if (atype === 4) {
    const g = host.split(":");
    const head = new Uint8Array(17);
    head[0] = 4;
    for (let i = 0; i < 8; i++) writeU16BE(head, 1 + i * 2, Number.parseInt(g[i]!, 16));
    return concatBytes(head, u16be(port));
  }
  const raw = utf8Encode(host);
  return concatBytes(new Uint8Array([3, raw.length]), raw, u16be(port));
}

function utf8Lowercase(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s.toLowerCase();
}
