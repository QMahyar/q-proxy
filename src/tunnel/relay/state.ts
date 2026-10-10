import type { RelayClientSink, RelayOptions, Slot } from "./types";

// Mutable session state shared by all relay phases. One RelayState is created
// per createRelay() call and never shared across sessions.
export interface RelayState {
  sink: RelayClientSink;
  opts: RelayOptions;
  finished: boolean;
  halfOpen: boolean;
  retriedOnce: boolean;
  headerSent: boolean;
  downlinkBytes: number;
  bytesUp: number;
  bytesDown: number;
  lastActivityMs: number;
  graceDeadline: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
  slot: Slot | null;
  upQueue: Uint8Array[];
  upQueued: number;
  flushScheduled: boolean;
  writeBusy: boolean;
  decodeQueue: Uint8Array[];
  decodeHead: number;
  decodeQueued: number;
  decoding: boolean;
  pendingDown: Uint8Array[];
  pendingDownBytes: number;
  sendTail: Promise<void>;
}

export function createRelayState(sink: RelayClientSink, opts: RelayOptions): RelayState {
  return {
    sink,
    opts,
    finished: false,
    halfOpen: false,
    retriedOnce: false,
    headerSent: false,
    downlinkBytes: 0,
    bytesUp: 0,
    bytesDown: 0,
    lastActivityMs: Date.now(),
    graceDeadline: Number.POSITIVE_INFINITY,
    graceTimer: null,
    idleTimer: null,
    generation: 0,
    slot: null,
    upQueue: [],
    upQueued: 0,
    flushScheduled: false,
    writeBusy: false,
    decodeQueue: [],
    decodeHead: 0,
    decodeQueued: 0,
    decoding: false,
    pendingDown: [],
    pendingDownBytes: 0,
    sendTail: Promise.resolve(),
  };
}
