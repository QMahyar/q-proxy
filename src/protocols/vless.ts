import { equalsBytes, hexToBytes, readU16BE } from "../utils/bytes";
import {
  ByteAccumulator,
  parseAddressValue,
  type BodyCodec,
  type ParsedRequest,
  type ProtocolInbound,
  type PushOutcome,
} from "./common";

type VlessRequest = ParsedRequest<"tcp"> | ParsedRequest<"udp">;

const CMD_TCP = 1;
const CMD_UDP = 2;
const DNS_PORT = 53;

export function createVlessInbound(expectedUuid: string): ProtocolInbound<VlessRequest> {
  const expectedBytes = parseUuid(expectedUuid);
  let acc = new ByteAccumulator();
  let done = false;
  let responseVersion = 0;
  let initialPayload: Uint8Array | null = null;

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
      return null;
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
}

function parseUuid(uuid: string): Uint8Array | null {
  const compact = uuid.replaceAll("-", "");
  if (compact.length !== 32) return null;
  return hexToBytes(compact);
}
