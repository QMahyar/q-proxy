import type { TunnelKind } from "../../core/routes";
import type { Settings } from "../../types/settings";
import type { DnsPacketRelay } from "../../types/tunnel";
import { log } from "../../core/log";
import { ByteAccumulator } from "../../protocols/common";
import type {
  DownlinkEncoder,
  ParsedRequest,
  ProtocolInbound,
} from "../../protocols/common";
import { createVlessInbound } from "../../protocols/vless";
import { createRelay } from "../../tunnel/relay";
import { concatBytes, utf8Encode } from "../../utils/bytes";

export type TunnelParsed = ParsedRequest<"tcp"> | ParsedRequest<"udp">;
export type TunnelPhase = "handshake" | "tcp" | "udp";

export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const EMPTY_BYTES = new Uint8Array(0);

export interface TunnelSession {
  ws: WebSocket;
  kind: TunnelKind;
  settings: Settings;
  env: Env;
  ctx?: ExecutionContext | null;
  inbound: ProtocolInbound<TunnelParsed>;
  acc: ByteAccumulator;
  phase: TunnelPhase;
  relayHandle: ReturnType<typeof createRelay> | null;
  dnsRelay: DnsPacketRelay | null;
  downlinkEncoder: DownlinkEncoder | null;
  uplinkDecode: ((chunk: Uint8Array) => Promise<Uint8Array | null>) | null;
  headerBytes: Uint8Array | null;
  clientGone: boolean;
  handshakeTimer: ReturnType<typeof setTimeout>;
}

function createInbound(kind: TunnelKind, s: Settings): ProtocolInbound<TunnelParsed> {
  void kind;
  return createVlessInbound(s.vlessUuid);
}

export function createTunnelSession(
  ws: WebSocket,
  kind: TunnelKind,
  s: Settings,
  env: Env,
  ctx?: ExecutionContext | null,
): TunnelSession {
  const st: TunnelSession = {
    ws,
    kind,
    settings: s,
    env,
    ctx,
    inbound: createInbound(kind, s),
    acc: new ByteAccumulator(),
    phase: "handshake",
    relayHandle: null,
    dnsRelay: null,
    downlinkEncoder: null,
    uplinkDecode: null,
    headerBytes: null,
    clientGone: false,
    handshakeTimer: setTimeout(() => {
      if (st.phase === "handshake") {
        log.debug("tunnel", "handshake timeout", { kind });
        closeTunnelSocket(st, 1008);
      }
    }, HANDSHAKE_TIMEOUT_MS),
  };
  return st;
}

export async function resolveTcpFirstPacket(
  inbound: ProtocolInbound<ParsedRequest<"tcp"> | ParsedRequest<"udp">>,
  uplinkDecode: ((chunk: Uint8Array) => Promise<Uint8Array | null>) | null,
  rest: Uint8Array,
): Promise<Uint8Array> {
  let firstPacket = inbound.takeInitialPayload() ?? rest;
  if (uplinkDecode !== null) {
    const drained = await uplinkDecode(EMPTY_BYTES);
    if (drained !== null && drained.length > 0) firstPacket = concatBytes(firstPacket, drained);
  }
  return firstPacket;
}

export function closeTunnelSocket(st: TunnelSession, code: number): void {
  try {
    if (st.ws.readyState !== 3) st.ws.close(code);
  } catch {
    // Best-effort: safeClose is called on already-dead sockets; throwing
    // would turn a cleanup path into a crash.
  }
}

export function sendTunnelRaw(st: TunnelSession, data: Uint8Array): void {
  try {
    if (st.ws.readyState === 1) st.ws.send(data);
  } catch {
    // Best-effort: the client may vanish mid-send; the relay finish path
    // (not this throw) owns session teardown.
  }
}

export function sendServerData(st: TunnelSession, data: Uint8Array): void {
  if (st.downlinkEncoder === null) {
    sendTunnelRaw(st, data);
    return;
  }
  void st.downlinkEncoder
    .encode(data)
    .then((frame) => {
      if (frame.length > 0) sendTunnelRaw(st, frame);
    })
    .catch((err: unknown) => {
      log.error("tunnel", "downlink encode failed", String(err));
      closeTunnelSocket(st, 1011);
    });
}

export function activateBodyCodec(st: TunnelSession): void {
  const codec = st.inbound.bodyCodec();
  if (codec !== null) {
    const encoder = codec.beginDownlink();
    st.downlinkEncoder = encoder;
    st.headerBytes = st.inbound.responseHeader() ?? encoder.header();
    st.uplinkDecode = (chunk: Uint8Array) => codec.decodeUp(chunk);
    log.debug("tunnel", "body codec active", { kind: st.kind });
  } else {
    st.downlinkEncoder = null;
    st.headerBytes = st.inbound.responseHeader();
    st.uplinkDecode = null;
  }
}

export function clearHandshakeTimer(st: TunnelSession): void {
  clearTimeout(st.handshakeTimer);
}

export function rejectHandshake(st: TunnelSession, reason: string): void {
  clearHandshakeTimer(st);
  log.debug("tunnel", "handshake rejected", { kind: st.kind, reason });
  closeTunnelSocket(st, 1008);
}

export function toSessionBytes(data: ArrayBuffer | string | Uint8Array): Uint8Array {
  if (typeof data === "string") return utf8Encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}
