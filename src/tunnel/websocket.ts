import { decodeBase64Url } from "../utils/base64";

export interface AcceptedTunnelSocket {
  ws: WebSocket;
  client: WebSocket;
  earlyData: Uint8Array | null;
}

export interface AcceptOptions {
  earlyDataEnabled: boolean;
  earlyDataMaxBytes: number;
}

const ABSOLUTE_EARLY_DATA_CAP = 8192;

export function isUpgradeRequest(req: Request): boolean {
  return (req.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
}

export function extractEarlyData(
  headerValue: string | null,
  maxBytes: number,
): Uint8Array | null {
  if (headerValue === null || headerValue.length === 0) return null;
  const first = headerValue.split(",")[0]!.trim();
  if (first.length === 0) return null;
  const decoded = decodeBase64Url(first);
  if (!decoded.ok) return null;
  if (decoded.value.length === 0) return null;
  const cap = Math.max(1, Math.min(maxBytes, ABSOLUTE_EARLY_DATA_CAP));
  if (decoded.value.length > cap) return null;
  return decoded.value;
}

export function acceptTunnelSocket(req: Request, opts: AcceptOptions): AcceptedTunnelSocket {
  const pair = new WebSocketPair();
  const server: WebSocket = pair[1];
  server.binaryType = "arraybuffer";
  server.accept({ allowHalfOpen: true });
  const earlyData = opts.earlyDataEnabled
    ? extractEarlyData(req.headers.get("sec-websocket-protocol"), opts.earlyDataMaxBytes)
    : null;
  return { ws: server, client: pair[0], earlyData };
}
