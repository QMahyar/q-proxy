import type { EstablishedEgress } from "../types/tunnel";
import { clientHalfClosed, runRelay } from "./relay/runner";
import { createRelayState } from "./relay/state";
import { feedClientChunk } from "./relay/uplink";
import type { RelayClientSink, RelayHandle, RelayOptions } from "./relay/types";

export type {
  RelayGateDecision,
  RelayGate,
  RelayOptions,
  RelayClientSink,
  RelayHandle,
} from "./relay/types";

// Relay invariants (phases live in ./relay/, this file only composes them):
// - finish-once: the first finishRelay() wins; later calls are no-ops.
// - Zero-byte failover: a single retry, only before any downlink byte lands.
// - Response header (VLESS reply) is sent at most once, before any payload.
// - Uplink coalesces to ~20 KiB / 30 ms; hard caps are 1 MiB up, 2 MiB down.
// - Client half-close starts a 5 s grace drain; idle sessions die at 300 s.
// - Admission gate runs once pre-header; deny closes 1008, throw fails open.
export function createRelay(sink: RelayClientSink, opts: RelayOptions = {}): RelayHandle {
  const st = createRelayState(sink, opts);
  return {
    feedClient: (chunk: Uint8Array): void => feedClientChunk(st, chunk),
    clientClosed: (): void => clientHalfClosed(st),
    run: (initial: EstablishedEgress): Promise<void> => runRelay(st, initial),
    get bytesUp(): number {
      return st.bytesUp;
    },
    get bytesDown(): number {
      return st.bytesDown;
    },
  };
}
