import { equalsBytes, readU16BE, u16be } from "../utils/bytes";
import { concatBytes } from "../utils/bytes";
import { parseUuid } from "../utils/uuid";
import {
  ByteAccumulator,
  parseAddressValue,
  type BodyCodec,
  type DownlinkEncoder,
  type ParsedRequest,
  type ProtocolInbound,
  type PushOutcome,
} from "./common";

type VlessRequest = ParsedRequest<"tcp"> | ParsedRequest<"udp">;

const CMD_TCP = 1;
const CMD_UDP = 2;
const DNS_PORT = 53;
const UDP_BUFFER_CAP = 65536;

export function createVlessInbound(expectedUuid: string): ProtocolInbound<VlessRequest> {
  const expectedBytes = parseUuid(expectedUuid);
  let acc = new ByteAccumulator();
  let done = false;
  let responseVersion = 0;
  let initialPayload: Uint8Array | null = null;
  let udpMode = false;

  return {
    async push(data: Uint8Array): Promise<PushOutcome<VlessRequest>> {
      if (done) return { state: "reject", reason: "data after completed handshake" };
      if (!acc.append(data)) return { state: "reject", reason: "handshake too large" };
      const buf = acc.drain();
      const outcome = tryParse(buf);
      if (outcome.state === "need-more") {
        acc.append(buf);
        return outcome;
      }
      done = true;
      return outcome;
    },
    responseHeader(): Uint8Array | null {
      if (!done) return null;
      return new Uint8Array([responseVersion, 0x00]);
    },
    takeInitialPayload(): Uint8Array | null {
      const p = initialPayload;
      initialPayload = null;
      return p;
    },
    bodyCodec(): BodyCodec | null {
      if (!done || !udpMode) return null;
      return createVlessUdpCodec();
    },
  };

  function tryParse(buf: Uint8Array): PushOutcome<VlessRequest> {
    if (buf.length < 1 + 16 + 1 + 1) return { state: "need-more" };
    responseVersion = buf[0]!;
    const uuidBytes = buf.subarray(1, 17);
    if (expectedBytes === null || !equalsBytes(uuidBytes, expectedBytes)) {
      return { state: "reject", reason: "invalid user" };
    }
    const addonsLen = buf[17]!;
    const cmdOffset = 18 + addonsLen;
    if (buf.length < cmdOffset + 1) return { state: "need-more" };
    const cmd = buf[cmdOffset]!;
    if (cmd !== CMD_TCP && cmd !== CMD_UDP) {
      return { state: "reject", reason: `unsupported command ${cmd}` };
    }
    const portOffset = cmdOffset + 1;
    if (buf.length < portOffset + 2) return { state: "need-more" };
    const port = readU16BE(buf, portOffset);
    if (port === 0) return { state: "reject", reason: "invalid port 0" };
    const atypeOffset = portOffset + 2;
    if (buf.length < atypeOffset + 1) return { state: "need-more" };
    const atype = buf[atypeOffset]!;
    const addr = parseAddressValue(atype, buf, atypeOffset + 1);
    if (!addr.ok) {
      return addr.reason.startsWith("truncated")
        ? { state: "need-more" }
        : { state: "reject", reason: addr.reason };
    }
    if (cmd === CMD_UDP && port !== DNS_PORT) {
      return { state: "reject", reason: "udp proxy only allowed for port 53" };
    }
    udpMode = cmd === CMD_UDP;
    initialPayload = buf.subarray(addr.value.nextOffset);
    return {
      state: "ready",
      parsed: {
        command: cmd === CMD_TCP ? "tcp" : "udp",
        target: { host: addr.value.host, port },
      },
      rest: initialPayload,
    };
  }

  function createVlessUdpCodec(): BodyCodec {
    let buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    const encoder: DownlinkEncoder = {
      header(): Uint8Array | null {
        return null;
      },
      async encode(chunk: Uint8Array): Promise<Uint8Array> {
        if (chunk.length === 0) return new Uint8Array(0);
        if (chunk.length > 0xffff) return new Uint8Array(0);
        return concatBytes(u16be(chunk.length), chunk);
      },
    };
    return {
      async decodeUp(chunk: Uint8Array): Promise<Uint8Array | null> {
        if (chunk.length > 0) {
          if (buf.length + chunk.length > UDP_BUFFER_CAP) {
            throw new Error("vless udp frame buffer exceeded 64 KiB cap");
          }
          buf = concatBytes(buf as Uint8Array, chunk as Uint8Array) as Uint8Array<ArrayBufferLike>;
        }
        const parts: Uint8Array[] = [];
        let off = 0;
        while (buf.length - off >= 2) {
          const len = readU16BE(buf, off);
          if (buf.length - off < 2 + len) break;
          parts.push(buf.subarray(off + 2, off + 2 + len));
          off += 2 + len;
        }
        if (off > 0) buf = buf.slice(off);
        return parts.length === 0 ? new Uint8Array(0) : concatBytes(...parts);
      },
      beginDownlink(): DownlinkEncoder {
        return encoder;
      },
    };
  }
}