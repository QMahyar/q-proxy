import { concatBytes } from "../utils/bytes";
import { sha224Hex } from "../utils/sha224";
import {
  ByteAccumulator,
  parseAddress,
  type BodyCodec,
  type DownlinkEncoder,
  type ParsedRequest,
  type ProtocolInbound,
  type PushOutcome,
} from "./common";

type TrojanRequest = ParsedRequest<"tcp"> | ParsedRequest<"udp">;

const CMD_TCP = 0x01;
const CMD_UDP = 0x03;

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)!;
  return diff === 0;
}

export function createTrojanInbound(password: string): ProtocolInbound<TrojanRequest> {
  let acc = new ByteAccumulator();
  let done = false;
  let initialPayload: Uint8Array | null = null;
  let udpMode = false;
  let udpAddr: Uint8Array | null = null;

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
      return outcome;
    },
    responseHeader(): Uint8Array | null {
      // Trojan sends no response header.
      return null;
    },
    takeInitialPayload(): Uint8Array | null {
      const p = initialPayload;
      initialPayload = null;
      return p;
    },
    bodyCodec(): BodyCodec | null {
      if (!done) return null;
      if (udpMode) return createTrojanUdpCodec();
      return null;
    },
  };

  function tryParse(buf: Uint8Array): PushOutcome<TrojanRequest> {
    // password hex (56) + CRLF + CMD + ADDR + PORT + CRLF at minimum.
    if (buf.length < 56 + 2 + 1) return { state: "need-more" };
    const hex = String.fromCharCode(...buf.subarray(0, 56));
    if (!/^[0-9a-f]{56}$/.test(hex)) return { state: "reject", reason: "invalid trojan password encoding" };
    if (buf[56] !== 0x0d || buf[57] !== 0x0a) return { state: "reject", reason: "invalid trojan framing" };
    if (!timingSafeEqualHex(hex, sha224Hex(password))) {
      return { state: "reject", reason: "invalid user" };
    }
    const cmdOffset = 58;
    if (buf.length < cmdOffset + 1) return { state: "need-more" };
    const cmd = buf[cmdOffset]!;
    if (cmd !== CMD_TCP && cmd !== CMD_UDP) {
      return { state: "reject", reason: `unsupported command ${cmd}` };
    }
    const addr = parseAddress(buf[cmdOffset + 1]!, buf, cmdOffset + 2);
    if (!addr.ok) {
      return addr.reason.startsWith("truncated")
        ? { state: "need-more" }
        : { state: "reject", reason: addr.reason };
    }
    const afterAddr = addr.value.nextOffset;
    if (buf.length < afterAddr + 2) return { state: "need-more" };
    if (buf[afterAddr] !== 0x0d || buf[afterAddr + 1] !== 0x0a) {
      return { state: "reject", reason: "invalid trojan framing" };
    }
    udpMode = cmd === CMD_UDP;
    const rest = buf.subarray(afterAddr + 2);
    if (udpMode) {
      // The associate target is the proxy endpoint itself; the DNS-only
      // relay ignores it (like the vless single-target model), so report
      // port 53 to satisfy the session's DNS-only gate.
      udpAddr = buf.subarray(cmdOffset + 1, afterAddr);
    }
    initialPayload = rest;
    return {
      state: "ready",
      parsed: udpMode
        ? { command: "udp", target: { host: addr.value.host, port: 53 } }
        : { command: "tcp", target: { host: addr.value.host, port: addr.value.port } },
      rest: initialPayload,
    };
  }

  function createTrojanUdpCodec(): BodyCodec {
    let header = udpAddr ?? new Uint8Array(0);
    const encoder: DownlinkEncoder = {
      header(): Uint8Array | null {
        return null;
      },
      async encode(chunk: Uint8Array): Promise<Uint8Array> {
        return concatBytes(new Uint8Array([0x00, 0x00, 0x00]), header, chunk);
      },
    };
    return {
      async decodeUp(chunk: Uint8Array): Promise<Uint8Array | null> {
        // SOCKS-UDP datagram: RSV RSV FRAG ATYP ADDR PORT DATA.
        if (chunk.length < 2 + 1 + 1 + 2) throw new Error("trojan udp datagram too short");
        if (chunk[0] !== 0x00 || chunk[1] !== 0x00) throw new Error("trojan udp reserved bytes invalid");
        if (chunk[2] !== 0x00) throw new Error("trojan udp fragmentation unsupported");
        const addr = parseAddress(chunk[3]!, chunk, 4);
        if (!addr.ok) throw new Error(`trojan udp address invalid: ${addr.reason}`);
        header = chunk.subarray(3, addr.value.nextOffset);
        const payload = chunk.subarray(addr.value.nextOffset);
        return payload.length === 0 ? new Uint8Array(0) : payload;
      },
      beginDownlink(): DownlinkEncoder {
        return encoder;
      },
    };
  }
}
