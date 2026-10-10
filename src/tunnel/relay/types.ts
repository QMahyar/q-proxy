import type { EstablishedEgress, Socket } from "../../types/tunnel";

export const COALESCE_TARGET_BYTES = 20480;
export const COALESCE_INTERVAL_MS = 30;
export const DOWNLINK_BATCH_BYTES = 32768;
export const DOWNLINK_HARD_CAP_BYTES = 2 * 1024 * 1024;
export const UPLINK_HARD_CAP_BYTES = 1 * 1024 * 1024;
export const HALF_OPEN_GRACE_MS = 5000;
export const IDLE_CEILING_MS = 300_000;

export type RelayGateDecision = boolean | { allowed: boolean; retryAfterMs?: number };

export type RelayGate = () => Promise<RelayGateDecision>;

export interface RelayOptions {
  responseHeader?: Uint8Array | null;
  uplinkDecode?: ((chunk: Uint8Array) => Promise<Uint8Array | null>) | null;
  downlinkEncode?: ((chunk: Uint8Array) => Promise<Uint8Array>) | null;
  retry?: (() => Promise<EstablishedEgress | null>) | null;
  gate?: RelayGate | null;
}

export interface RelayClientSink {
  send(data: Uint8Array): void;
  close(code: number): void;
}

export interface RelayHandle {
  feedClient(chunk: Uint8Array): void;
  clientClosed(): void;
  run(initial: EstablishedEgress): Promise<void>;
  readonly bytesUp: number;
  readonly bytesDown: number;
}

export interface Slot {
  socket: Socket;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  index: number;
}
