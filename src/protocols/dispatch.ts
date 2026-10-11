import type { BodyCodec, ProtocolInbound, PushOutcome } from "./common";

// Race two handshake parsers over the same bytes: the first to reach `ready`
// wins. Used for the shared vless/shadowsocks WebSocket path — vless stays
// canonical (checked first), ss engages only when vless cannot complete.
// Both handshakes resolve within a few hundred bytes and each inbound
// buffers internally, so every message is simply offered to both parsers.
// Never throws; a double reject surfaces the primary reason to preserve the
// existing error surface.
export function createFallbackInbound<R>(
  primary: () => ProtocolInbound<R>,
  fallback: () => ProtocolInbound<R>,
): ProtocolInbound<R> {
  const first = primary();
  const second = fallback();
  let committed: ProtocolInbound<R> | null = null;

  return {
    async push(data: Uint8Array): Promise<PushOutcome<R>> {
      if (committed !== null) return committed.push(data);
      const a = await first.push(data);
      if (a.state === "ready") {
        committed = first;
        return a;
      }
      const b = await second.push(data);
      if (b.state === "ready") {
        committed = second;
        return b;
      }
      if (a.state === "reject" && b.state === "reject") return a;
      return { state: "need-more" };
    },
    responseHeader(): Uint8Array | null {
      return (committed ?? first).responseHeader();
    },
    takeInitialPayload(): Uint8Array | null {
      return (committed ?? first).takeInitialPayload();
    },
    bodyCodec(): BodyCodec | null {
      return (committed ?? first).bodyCodec();
    },
  };
}
