import { log } from "../../core/log";
import { createDnsPacketRelay } from "../../tunnel/resolver";
import {
  closeTunnelSocket,
  sendServerData,
  sendTunnelRaw,
  type TunnelSession,
} from "./session";

// UDP phase: DNS-only relay. Entered once from the handshake with the initial
// packet, then fed per message by handleTunnelMessage.
export async function startUdpSession(st: TunnelSession, rest: Uint8Array): Promise<void> {
  st.phase = "udp";
  st.dnsRelay = createDnsPacketRelay(st.settings.dohUpstream);
  if (st.headerBytes !== null && st.headerBytes.length > 0) sendTunnelRaw(st, st.headerBytes);
  let packet: Uint8Array | null = st.inbound.takeInitialPayload() ?? rest;
  if (st.uplinkDecode !== null && packet !== null) {
    try {
      packet = await st.uplinkDecode(packet);
    } catch (err) {
      log.debug("tunnel", "udp uplink decode failed", { kind: st.kind, reason: String(err) });
      closeTunnelSocket(st, 1008);
      return;
    }
  }
  if (packet !== null && packet.length > 0) {
    try {
      const answer = await st.dnsRelay(packet);
      if (answer !== null && answer.length > 0) sendServerData(st, answer);
    } catch {
      // Best-effort DNS answer: upstream DoH failures just drop this packet;
      // the session stays open for the next query.
    }
  }
}

export async function relayUdpPacket(st: TunnelSession, bytes: Uint8Array): Promise<void> {
  let packet: Uint8Array | null = bytes;
  if (st.uplinkDecode !== null) {
    try {
      packet = await st.uplinkDecode(bytes);
    } catch (err) {
      log.debug("tunnel", "udp uplink decode failed", { kind: st.kind, reason: String(err) });
      closeTunnelSocket(st, 1008);
      return;
    }
  }
  if (packet === null || packet.length === 0) return;
  const relay = st.dnsRelay;
  if (relay === null) return;
  try {
    const answer = await relay(packet);
    if (answer !== null && answer.length > 0) sendServerData(st, answer);
  } catch {
    // Best-effort DNS answer: same drop-packet policy as startUdpSession.
    return;
  }
}
