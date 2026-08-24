import type { RouteHandler } from "../types/context";
import type { Settings } from "../types/settings";
import type { DialTarget, DnsPacketRelay } from "../types/tunnel";
import { NotFoundError } from "../core/errors";
import { log } from "../core/log";
import { identifyTunnel } from "../core/routes";
import { ByteAccumulator } from "../protocols/common";
import type {
  DownlinkEncoder,
  ParsedRequest,
  ProtocolInbound,
} from "../protocols/common";
import { createVlessInbound } from "../protocols/vless";
import { createTrojanInbound } from "../protocols/trojan";
import { createVmessInbound } from "../protocols/vmess";
import { createSSInbound } from "../protocols/shadowsocks";
import { createEgressOpener, makeFailoverStrategy } from "../tunnel/egress";
import { createRelay } from "../tunnel/relay";
import { createDnsPacketRelay } from "../tunnel/resolver";
import { matchesSpeedtestHost, speedtestResponseBytes } from "../tunnel/speedtest";
import { acceptTunnelSocket, isUpgradeRequest } from "../tunnel/websocket";
import { concatBytes, utf8Encode } from "../utils/bytes";

type TunnelKind = "vless" | "vmess" | "trojan" | "ss";
type TunnelParsed = ParsedRequest<"tcp"> | ParsedRequest<"udp">;

const HANDSHAKE_TIMEOUT_MS = 10_000;
const SPEEDTEST_CLOSE_DELAY_MS = 200;
const EMPTY_BYTES = new Uint8Array(0);

function pickCredential(kind: TunnelKind, s: Settings): string {
  switch (kind) {
    case "vless":
      return s.vlessUuid;
    case "vmess":
      return s.vmessUuid;
    case "trojan":
      return s.trojanPassword;
    case "ss":
      return s.ssPassword;
  }
}

function createInbound(kind: TunnelKind, s: Settings): ProtocolInbound<TunnelParsed> {
  const credential = pickCredential(kind, s);
  switch (kind) {
    case "vless":
      return createVlessInbound(credential);
    case "vmess":
      return createVmessInbound(credential);
    case "trojan":
      return createTrojanInbound(credential);
    case "ss":
      return createSSInbound(s.ssMethod, credential);
  }
}

export const handleTunnel: RouteHandler = async (req, _env, s) => {
  const kind = identifyTunnel(new URL(req.url).pathname, s);
  if (kind === null) throw new NotFoundError("unknown tunnel path");
  if (!isUpgradeRequest(req)) throw new NotFoundError("websocket upgrade required");
  const accepted = acceptTunnelSocket(req, {
    earlyDataEnabled: kind === "ss" ? false : s.earlyDataEnabled,
    earlyDataMaxBytes: s.earlyDataMaxBytes,
  });
  void driveSession(accepted.ws, kind, s, accepted.earlyData).catch((err: unknown) => {
    log.error("tunnel", "driveSession unhandled", String(err));
  });
  return new Response(null, { status: 101, webSocket: accepted.client });
};

async function driveSession(
  ws: WebSocket,
  kind: TunnelKind,
  s: Settings,
  earlyData: Uint8Array | null,
): Promise<void> {
  const inbound = createInbound(kind, s);
  const acc = new ByteAccumulator();

  let phase: "handshake" | "tcp" | "udp" = "handshake";
  let relayHandle: ReturnType<typeof createRelay> | null = null;
  let dnsRelay: DnsPacketRelay | null = null;
  let downlinkEncoder: DownlinkEncoder | null = null;
  let uplinkDecode: ((chunk: Uint8Array) => Promise<Uint8Array | null>) | null = null;
  let headerBytes: Uint8Array | null = null;

  const safeClose = (code: number): void => {
    try {
      if (ws.readyState !== 3) ws.close(code);
    } catch {}
  };

  const sendRaw = (data: Uint8Array): void => {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch {}
  };

  const sendServerData = (data: Uint8Array): void => {
    if (downlinkEncoder === null) {
      sendRaw(data);
      return;
    }
    void downlinkEncoder
      .encode(data)
      .then((frame) => {
        if (frame.length > 0) sendRaw(frame);
      })
      .catch((err: unknown) => {
        log.error("tunnel", "downlink encode failed", String(err));
        safeClose(1011);
      });
  };

  const activateBodyPath = (): void => {
    const codec = inbound.bodyCodec();
    if (codec !== null) {
      const encoder = codec.beginDownlink();
      downlinkEncoder = encoder;
      headerBytes = inbound.responseHeader() ?? encoder.header();
      uplinkDecode = (chunk: Uint8Array) => codec.decodeUp(chunk);
      log.debug("tunnel", "body codec active", { kind });
    } else {
      downlinkEncoder = null;
      headerBytes = inbound.responseHeader();
      uplinkDecode = null;
    }
  };

  const handshakeTimer = setTimeout(() => {
    if (phase === "handshake") {
      log.debug("tunnel", "handshake timeout", { kind });
      safeClose(1008);
    }
  }, HANDSHAKE_TIMEOUT_MS);

  const cleanupHandshake = (): void => {
    clearTimeout(handshakeTimer);
  };

  const rejectClose = (reason: string): void => {
    cleanupHandshake();
    log.debug("tunnel", "handshake rejected", { kind, reason });
    safeClose(1008);
  };

  const startTcpSession = async (target: DialTarget, firstPacket: Uint8Array): Promise<void> => {
    if (s.speedtestIntercept && matchesSpeedtestHost(target.host)) {
      phase = "tcp";
      cleanupHandshake();
      log.debug("tunnel", "speedtest intercepted", { host: target.host });
      if (headerBytes !== null && headerBytes.length > 0) sendRaw(headerBytes);
      sendServerData(speedtestResponseBytes());
      setTimeout(() => safeClose(1000), SPEEDTEST_CLOSE_DELAY_MS);
      return;
    }
    try {
      const strategy = await makeFailoverStrategy(s, target);
      const opener = createEgressOpener(strategy);
      const packet = firstPacket.length > 0 ? firstPacket : null;
      const established = await opener.open(target, packet);
      phase = "tcp";
      cleanupHandshake();
      const encoder = downlinkEncoder;
      relayHandle = createRelay(
        { send: sendRaw, close: safeClose },
        {
          responseHeader: headerBytes,
          uplinkDecode,
          downlinkEncode:
            encoder !== null ? (chunk: Uint8Array) => encoder.encode(chunk) : null,
          retry: () => opener.retry(target, packet),
        },
      );
      void relayHandle.run(established).catch((err: unknown) => {
        log.error("tunnel", "relay crashed", String(err));
        safeClose(1011);
      });
    } catch (err) {
      cleanupHandshake();
      log.debug("tunnel", "egress failed", { kind, reason: String(err) });
      safeClose(1011);
    }
  };

  const toBytes = (data: ArrayBuffer | string | Uint8Array): Uint8Array => {
    if (typeof data === "string") return utf8Encode(data);
    if (data instanceof Uint8Array) return data;
    return new Uint8Array(data);
  };

  const handleMessage = async (data: ArrayBuffer | string | Uint8Array): Promise<void> => {
    const bytes = toBytes(data);
    if (phase === "handshake") {
      if (!acc.append(bytes)) {
        rejectClose("handshake buffer exceeded 16 KiB cap");
        return;
      }
      let outcome: Awaited<ReturnType<ProtocolInbound<TunnelParsed>["push"]>>;
      try {
        outcome = await inbound.push(acc.drain());
      } catch (err) {
        rejectClose(`inbound push error: ${String(err)}`);
        return;
      }
      if (outcome.state === "need-more") return;
      if (outcome.state === "reject") {
        rejectClose(outcome.reason);
        return;
      }
      cleanupHandshake();
      activateBodyPath();
      const parsed = outcome.parsed;
      const rest = outcome.rest ?? EMPTY_BYTES;
      const initialPayload = inbound.takeInitialPayload();
      const firstPacket = initialPayload ?? rest;
      if (parsed.command === "udp") {
        if (!s.enableUdp53 || parsed.target.port !== 53) {
          rejectClose("udp is restricted to port 53 when enabled");
          return;
        }
        phase = "udp";
        dnsRelay = createDnsPacketRelay(s.dohUpstream);
        if (headerBytes !== null && headerBytes.length > 0) sendRaw(headerBytes);
        if (firstPacket.length > 0) {
          let packet: Uint8Array | null = firstPacket;
          if (uplinkDecode !== null) packet = await uplinkDecode(packet);
          if (packet !== null && packet.length > 0) {
            try {
              const answer = await dnsRelay(packet);
              if (answer !== null && answer.length > 0) sendServerData(answer);
            } catch {}
          }
        }
        return;
      }
      await startTcpSession(parsed.target, firstPacket);
      return;
    }
    if (phase === "udp" && dnsRelay !== null) {
      let packet: Uint8Array | null = bytes;
      if (uplinkDecode !== null) packet = await uplinkDecode(bytes);
      if (packet === null || packet.length === 0) return;
      try {
        const answer = await dnsRelay(packet);
        if (answer !== null && answer.length > 0) sendServerData(answer);
      } catch {
        return;
      }
      return;
    }
    if (phase === "tcp" && relayHandle !== null) {
      relayHandle.feedClient(bytes);
    }
  };

  const onMessage = (evt: MessageEvent): void => {
    void handleMessage(evt.data as ArrayBuffer | string).catch((err: unknown) => {
      log.error("tunnel", "message handler failed", String(err));
      safeClose(1011);
    });
  };

  ws.addEventListener("message", onMessage);
  ws.addEventListener("error", () => {
    cleanupHandshake();
    safeClose(1011);
  });
  ws.addEventListener("close", () => {
    cleanupHandshake();
    relayHandle?.clientClosed();
  });

  if (earlyData !== null && earlyData.length > 0) {
    await handleMessage(earlyData);
  }
}
