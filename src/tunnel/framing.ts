import type { TunnelTransport } from "../types/settings";
import { concatBytes } from "../utils/bytes";

export interface TransportFramer {
  readonly transport: Exclude<TunnelTransport, "ws">;
  /** Decode one inbound message into zero or more payload chunks. May throw on malformed frames (the session closes). */
  pushUp(data: Uint8Array): Uint8Array[];
  /** Wrap one outbound payload into a single message. Never throws. */
  frameDown(data: Uint8Array): Uint8Array;
}

const GRPC_MAX_FRAME = 4 * 1024 * 1024;
const XHTTP_SIZE_LINE_CAP = 64;

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) | (buf[offset + 1]! << 16) | (buf[offset + 2]! << 8) | buf[offset + 3]!) >>> 0
  );
}

// gRPC gun framing: [compressed-flag:1][len:u32be][payload]. Multi streams
// use the same framing (grpcMode is accepted and reserved; gun applied).
function createGrpcFramer(): TransportFramer {
  let buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  return {
    transport: "grpc",
    pushUp(data: Uint8Array): Uint8Array[] {
      buf = concatBytes(buf, data);
      const out: Uint8Array[] = [];
      for (;;) {
        if (buf.length < 5) return out;
        if (buf[0] !== 0) throw new Error("grpc compressed frames unsupported");
        const len = readU32BE(buf, 1);
        if (len > GRPC_MAX_FRAME) throw new Error("grpc frame too large");
        if (buf.length < 5 + len) return out;
        out.push(buf.slice(5, 5 + len));
        buf = buf.slice(5 + len);
      }
    },
    frameDown(data: Uint8Array): Uint8Array {
      const head = new Uint8Array(5);
      head[0] = 0;
      new DataView(head.buffer).setUint32(1, data.byteLength);
      return concatBytes(head, data);
    },
  };
}

const CRLF = new Uint8Array([0x0d, 0x0a]);

// XHTTP-style HTTP/1.1 chunked framing: `<hex>\r\n<payload>\r\n`, terminal
// `0\r\n\r\n` resets the stream. Binary-safe (length-delimited).
function createXhttpFramer(): TransportFramer {
  let buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  return {
    transport: "xhttp",
    pushUp(data: Uint8Array): Uint8Array[] {
      buf = concatBytes(buf, data);
      const out: Uint8Array[] = [];
      for (;;) {
        const eol = indexOfCrlf(buf);
        if (eol === -1) {
          if (buf.length > XHTTP_SIZE_LINE_CAP) throw new Error("xhttp chunk line too long");
          return out;
        }
        const line = new TextDecoder().decode(buf.subarray(0, eol)).trim();
        if (!/^[0-9a-fA-F]+$/.test(line)) throw new Error("xhttp chunk size invalid");
        const len = parseInt(line, 16);
        if (!Number.isSafeInteger(len) || len > GRPC_MAX_FRAME) throw new Error("xhttp chunk too large");
        if (buf.length < eol + 2 + len + 2) return out;
        const payload = buf.subarray(eol + 2, eol + 2 + len);
        if (buf[eol + 2 + len] !== 0x0d || buf[eol + 2 + len + 1] !== 0x0a) {
          throw new Error("xhttp chunk terminator invalid");
        }
        buf = buf.slice(eol + 2 + len + 2);
        if (len > 0) out.push(payload);
      }
    },
    frameDown(data: Uint8Array): Uint8Array {
      const head = new TextEncoder().encode(`${data.byteLength.toString(16)}\r\n`);
      return concatBytes(head, data, CRLF);
    },
  };
}

function indexOfCrlf(buf: Uint8Array): number {
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) return i;
  }
  return -1;
}

// Null for "ws" (the identity path stays byte-identical); a framer for
// grpc/xhttp. Never throws.
export function createTransportFramer(transport: TunnelTransport): TransportFramer | null {
  if (transport === "grpc") return createGrpcFramer();
  if (transport === "xhttp") return createXhttpFramer();
  return null;
}
