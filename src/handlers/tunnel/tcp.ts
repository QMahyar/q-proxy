import type { DialTarget } from "../../types/tunnel";
import { log } from "../../core/log";
import { recordBytes } from "../../core/counters";
import { openEgressWithSpeculativeDirect } from "../../tunnel/egress";
import { createRelay } from "../../tunnel/relay";
import {
  clearHandshakeTimer,
  closeTunnelSocket,
  sendTunnelRaw,
  type TunnelSession,
} from "./session";

export async function startTcpSession(
  st: TunnelSession,
  target: DialTarget,
  firstPacket: Uint8Array,
): Promise<void> {
  try {
    const packet = firstPacket.length > 0 ? firstPacket : null;
    const { established, opener } = await openEgressWithSpeculativeDirect(st.settings, target, packet);
    if (st.clientGone) {
      // Best-effort: client vanished during dial; discard the fresh socket.
      void established.socket.close().catch(() => {});
      return;
    }
    st.phase = "tcp";
    clearHandshakeTimer(st);
    const encoder = st.downlinkEncoder;
    st.relayHandle = createRelay(
      { send: (data) => sendTunnelRaw(st, data), close: (code) => closeTunnelSocket(st, code) },
      {
        responseHeader: st.headerBytes,
        uplinkDecode: st.uplinkDecode,
        downlinkEncode:
          encoder !== null ? (chunk: Uint8Array) => encoder.encode(chunk) : null,
        retry: () => opener.retry(target, packet),
      },
    );
    const handle = st.relayHandle;
    void st.relayHandle.run(established).then(
      () => {
        void recordBytes(st.env, { bytesUp: handle.bytesUp, bytesDown: handle.bytesDown }, st.ctx).catch(
          (err: unknown) => log.error("counters", "record bytes failed", String(err)),
        );
      },
      (err: unknown) => {
        log.error("tunnel", "relay crashed", String(err));
        // Best-effort: usage counters must not mask the relay crash logged
        // above; the socket close below is the terminal action.
        void recordBytes(st.env, { bytesUp: handle.bytesUp, bytesDown: handle.bytesDown }, st.ctx).catch(() => {});
        closeTunnelSocket(st, 1011);
      },
    );
  } catch (err) {
    clearHandshakeTimer(st);
    log.debug("tunnel", "egress failed", { kind: st.kind, reason: String(err) });
    closeTunnelSocket(st, 1011);
  }
}
