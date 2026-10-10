import { concatBytes } from "../../utils/bytes";
import { failRelay } from "./lifecycle";
import type { RelayState } from "./state";
import { COALESCE_INTERVAL_MS, COALESCE_TARGET_BYTES, UPLINK_HARD_CAP_BYTES } from "./types";

export function scheduleUplinkFlush(st: RelayState): void {
  if (st.flushScheduled || st.finished) return;
  st.flushScheduled = true;
  setTimeout(() => {
    st.flushScheduled = false;
    void flushUplink(st);
  }, COALESCE_INTERVAL_MS);
}

export async function flushUplink(st: RelayState): Promise<void> {
  if (st.finished) return;
  if (st.writeBusy || st.slot === null) {
    if (st.upQueued > 0) scheduleUplinkFlush(st);
    return;
  }
  if (st.upQueued === 0) return;
  const target = st.slot;
  const genBefore = st.generation;
  const chunks = st.upQueue.slice();
  st.upQueue.length = 0;
  const data = concatBytes(...chunks);
  st.upQueued = 0;
  st.writeBusy = true;
  try {
    await target.writer.write(data);
  } catch (err) {
    st.writeBusy = false;
    if (st.finished) return;
    st.upQueue.unshift(data);
    st.upQueued += data.length;
    if (st.upQueued > UPLINK_HARD_CAP_BYTES) {
      failRelay(st, "uplink backlog overflow", new Error(`coalesced ${st.upQueued} bytes`));
      return;
    }
    const retry = st.opts.retry;
    if (
      st.generation === genBefore &&
      retry !== undefined && retry !== null &&
      !st.retriedOnce && !st.halfOpen && st.downlinkBytes === 0
    ) {
      try {
        await target.reader.cancel();
      } catch {
        // Best-effort: the reader may already be disturbed by the failed
        // write; zero-byte failover proceeds regardless.
      }
      return;
    }
    if (st.generation !== genBefore) scheduleUplinkFlush(st);
    else failRelay(st, "uplink write failed", err);
    return;
  }
  st.writeBusy = false;
  if (!st.finished && st.upQueued > 0) scheduleUplinkFlush(st);
}

export function enqueueUplink(st: RelayState, bytes: Uint8Array): void {
  st.upQueue.push(bytes);
  st.upQueued += bytes.length;
  if (st.upQueued > UPLINK_HARD_CAP_BYTES) {
    failRelay(st, "uplink backlog overflow", new Error(`coalesced ${st.upQueued} bytes`));
    return;
  }
  if (st.upQueued >= COALESCE_TARGET_BYTES) void flushUplink(st);
  else scheduleUplinkFlush(st);
}

export async function processDecodeQueue(st: RelayState): Promise<void> {
  if (st.decoding) return;
  st.decoding = true;
  try {
    while (st.decodeHead < st.decodeQueue.length && !st.finished) {
      const chunk = st.decodeQueue[st.decodeHead++]!;
      st.decodeQueued -= chunk.length;
      const decode = st.opts.uplinkDecode;
      if (decode === undefined || decode === null) continue;
      const out = await decode(chunk);
      if (out !== null && out.length > 0 && !st.finished) enqueueUplink(st, out);
    }
    if (st.decodeHead > 0) {
      if (st.decodeHead >= st.decodeQueue.length) {
        st.decodeQueue.length = 0;
        st.decodeHead = 0;
      } else if (st.decodeHead > 32) {
        st.decodeQueue.copyWithin(0, st.decodeHead);
        st.decodeQueue.length -= st.decodeHead;
        st.decodeHead = 0;
      }
    }
  } catch (err) {
    st.decoding = false;
    failRelay(st, "uplink decode failed", err);
    return;
  }
  st.decoding = false;
}

export function feedClientChunk(st: RelayState, chunk: Uint8Array): void {
  if (st.finished || st.halfOpen) return;
  st.lastActivityMs = Date.now();
  st.bytesUp += chunk.length;
  if (st.opts.uplinkDecode !== undefined && st.opts.uplinkDecode !== null) {
    st.decodeQueued += chunk.length;
    if (st.decodeQueued > UPLINK_HARD_CAP_BYTES) {
      failRelay(st, "decode backlog overflow", new Error(`decode queued ${st.decodeQueued} bytes`));
      return;
    }
    st.decodeQueue.push(chunk);
    void processDecodeQueue(st);
    return;
  }
  enqueueUplink(st, chunk);
}
