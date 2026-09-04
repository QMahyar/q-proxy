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

type EarlyDataParse =
  | { status: "absent" }
  | { status: "too-big" }
  | { status: "ok"; data: Uint8Array };

function parseEarlyData(headerValue: string | null, maxBytes: number): EarlyDataParse {
  if (headerValue === null || headerValue.length === 0) return { status: "absent" };
  const first = headerValue.split(",")[0]!.trim();
  if (first.length === 0) return { status: "absent" };
  const decoded = decodeBase64Url(first);
  if (!decoded.ok) return { status: "absent" };
  if (decoded.value.length === 0) return { status: "absent" };
  const cap = Math.max(1, Math.min(maxBytes, ABSOLUTE_EARLY_DATA_CAP));
  if (decoded.value.length > cap) return { status: "too-big" };
  return { status: "ok", data: decoded.value };
}

export function extractEarlyData(
  headerValue: string | null,
  maxBytes: number,
): Uint8Array | null {
  const parsed = parseEarlyData(headerValue, maxBytes);
  return parsed.status === "ok" ? parsed.data : null;
}

export function acceptTunnelSocket(req: Request, opts: AcceptOptions): AcceptedTunnelSocket {
  const pair = new WebSocketPair();
  const server: WebSocket = pair[1];
  server.binaryType = "arraybuffer";
  server.accept({ allowHalfOpen: true });
  if (!opts.earlyDataEnabled) return { ws: server, client: pair[0], earlyData: null };
  const parsed = parseEarlyData(
    req.headers.get("sec-websocket-protocol"),
    opts.earlyDataMaxBytes,
  );
  if (parsed.status === "too-big") {
    try {
      server.close(1009);
    } catch {}
    return { ws: server, client: pair[0], earlyData: null };
  }
  return { ws: server, client: pair[0], earlyData: parsed.status === "ok" ? parsed.data : null };
}
