import { log } from "../../core/log";
import { handleHandshakeMessage } from "./handshake";
import {
  clearHandshakeTimer,
  closeTunnelSocket,
  toSessionBytes,
  type TunnelSession,
} from "./session";
import { relayUdpPacket } from "./udp";

export async function handleTunnelMessage(
  st: TunnelSession,
  data: ArrayBuffer | string | Uint8Array,
): Promise<void> {
  const bytes = toSessionBytes(data);
  // Non-ws transports frame every message; ws passes through untouched.
  const chunks = st.transportFramer === null ? [bytes] : st.transportFramer.pushUp(bytes);
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    if (st.phase === "handshake") {
      await handleHandshakeMessage(st, chunk);
      continue;
    }
    if (st.phase === "udp" && st.dnsRelay !== null) {
      await relayUdpPacket(st, chunk);
      continue;
    }
    if (st.phase === "tcp" && st.relayHandle !== null) {
      st.relayHandle.feedClient(chunk);
    }
  }
}

// Socket wiring: messages are processed strictly in arrival order through a
// promise tail; 0-RTT early data replays through the same path first.
export function attachTunnelSocket(st: TunnelSession, earlyData: Uint8Array | null): Promise<void> {
  let msgTail: Promise<void> = Promise.resolve();

  const onMessage = (evt: MessageEvent): void => {
    msgTail = msgTail
      .then(() => handleTunnelMessage(st, evt.data as ArrayBuffer | string))
      .catch((err: unknown) => {
        log.error("tunnel", "message handler failed", String(err));
        closeTunnelSocket(st, 1011);
      });
  };

  st.ws.addEventListener("message", onMessage);
  st.ws.addEventListener("error", () => {
    st.clientGone = true;
    clearHandshakeTimer(st);
    closeTunnelSocket(st, 1011);
  });
  st.ws.addEventListener("close", () => {
    st.clientGone = true;
    clearHandshakeTimer(st);
    st.relayHandle?.clientClosed();
  });

  if (earlyData !== null && earlyData.length > 0) {
    const first = earlyData;
    msgTail = msgTail
      .then(() => handleTunnelMessage(st, first))
      .catch((err: unknown) => {
        log.error("tunnel", "message handler failed", String(err));
        closeTunnelSocket(st, 1011);
      });
  }
  return msgTail;
}
