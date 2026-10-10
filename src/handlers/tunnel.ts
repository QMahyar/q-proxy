import type { RouteHandler } from "../types/context";
import type { Settings } from "../types/settings";
import type { TunnelKind } from "../core/routes";
import { NotFoundError, RateLimitedError } from "../core/errors";
import { log } from "../core/log";
import { clientIp } from "../auth/guard";
import { tryConsume } from "../tunnel/ratelimit";
import { identifyTunnel } from "../core/routes";
import { acceptTunnelSocket } from "../tunnel/websocket";
import { attachTunnelSocket } from "./tunnel/messages";
import { createTunnelSession } from "./tunnel/session";

export { resolveTcpFirstPacket } from "./tunnel/session";

export const handleTunnel: RouteHandler = async (req, env, s, ctx) => {
  const kind = identifyTunnel(new URL(req.url).pathname, s);
  if (kind === null) throw new NotFoundError("unknown tunnel path");
  const gate = await tryConsume(env, `tunnel:${clientIp(req)}`);
  if (!gate.allowed) throw new RateLimitedError(Math.ceil(gate.retryAfterMs / 1000));
  const accepted = acceptTunnelSocket(req, {
    earlyDataEnabled: s.earlyDataEnabled,
    earlyDataMaxBytes: s.earlyDataMaxBytes,
  });
  void driveSession(accepted.ws, kind, s, accepted.earlyData, env, ctx).catch((err: unknown) => {
    log.error("tunnel", "driveSession unhandled", String(err));
    try {
      if (accepted.ws.readyState !== 3) accepted.ws.close(1011);
    } catch {
      // Best-effort: the socket is already dead if close throws here; the
      // error above is the one that matters.
    }
  });
  return new Response(null, { status: 101, webSocket: accepted.client });
};

// Session invariants (phases live in ./tunnel/, this file only routes + drives):
// - One session carries at most one relay: TCP via createRelay, or UDP-DNS via
//   the packet relay restricted to port 53 when enableUdp53 is on.
// - Handshake must complete within 10 s and fit the 16 KiB accumulator.
// - Client messages run in order on a promise tail; early data replays first.
async function driveSession(
  ws: WebSocket,
  kind: TunnelKind,
  s: Settings,
  earlyData: Uint8Array | null,
  env: Env,
  ctx?: ExecutionContext | null,
): Promise<void> {
  const st = createTunnelSession(ws, kind, s, env, ctx);
  await attachTunnelSocket(st, earlyData);
}
