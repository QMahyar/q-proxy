import { log } from "../../core/log";
import type { EstablishedEgress } from "../../types/tunnel";
import { flushPendingDownlink } from "./downlink";
import { finishRelay, teardownSlot } from "./lifecycle";
import { flushUplink } from "./uplink";
import type { RelayState } from "./state";
import type { Slot } from "./types";

// Zero-byte failover invariant: retry at most once, and only before any
// downlink byte has been delivered. Totals (bytesUp/bytesDown) survive the swap.
export async function handleRemoteClose(st: RelayState, closed: Slot, viaError = false): Promise<boolean> {
  await flushPendingDownlink(st);
  if (st.finished) return false;
  if (st.halfOpen) {
    finishRelay(st, 1000);
    return false;
  }
  const retry = st.opts.retry;
  const canRetry =
    retry !== undefined && retry !== null && !st.retriedOnce && st.downlinkBytes === 0;
  if (!canRetry) {
    finishRelay(st, st.downlinkBytes === 0 ? 1011 : 1000);
    return false;
  }
  st.retriedOnce = true;
  st.generation++;
  st.slot = null;
  void teardownSlot(closed);
  let next: EstablishedEgress | null = null;
  try {
    next = await retry();
  } catch (err) {
    log.debug("relay", "zero-byte retry attempt failed", { reason: String(err) });
  }
  if (next === null || st.finished) {
    finishRelay(st, 1011);
    return false;
  }
  st.downlinkBytes = 0;
  st.pendingDown.length = 0;
  st.pendingDownBytes = 0;
  st.slot = {
    socket: next.socket,
    reader: next.socket.readable.getReader(),
    writer: next.socket.writable.getWriter(),
    index: next.candidateIndex,
  };
  log.info("relay", "zero-byte failover swap", {
    candidateIndex: next.candidateIndex,
    via: viaError ? "read-error" : "eof",
  });
  void flushUplink(st);
  return true;
}
