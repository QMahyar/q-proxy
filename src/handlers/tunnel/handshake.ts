import {
  activateBodyCodec,
  clearHandshakeTimer,
  EMPTY_BYTES,
  rejectHandshake,
  resolveTcpFirstPacket,
  type TunnelSession,
} from "./session";
import { startTcpSession } from "./tcp";
import { startUdpSession } from "./udp";

// Handshake phase: buffer until the VLESS header parses (16 KiB cap enforced by
// the accumulator), then branch into exactly one of TCP relay or UDP-DNS relay.
export async function handleHandshakeMessage(st: TunnelSession, bytes: Uint8Array): Promise<void> {
  if (!st.acc.append(bytes)) {
    rejectHandshake(st, "handshake buffer exceeded 16 KiB cap");
    return;
  }
  let outcome: Awaited<ReturnType<typeof st.inbound.push>>;
  try {
    outcome = await st.inbound.push(st.acc.drain());
  } catch (err) {
    rejectHandshake(st, `inbound push error: ${String(err)}`);
    return;
  }
  if (outcome.state === "need-more") return;
  if (outcome.state === "reject") {
    rejectHandshake(st, outcome.reason);
    return;
  }
  clearHandshakeTimer(st);
  activateBodyCodec(st);
  const parsed = outcome.parsed;
  const rest = outcome.rest ?? EMPTY_BYTES;
  if (parsed.command === "udp") {
    if (!st.settings.enableUdp53 || parsed.target.port !== 53) {
      rejectHandshake(st, "udp is restricted to port 53 when enabled");
      return;
    }
    await startUdpSession(st, rest);
    return;
  }
  const firstPacket = await resolveTcpFirstPacket(st.inbound, st.uplinkDecode, rest);
  await startTcpSession(st, parsed.target, firstPacket);
}
