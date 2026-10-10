import type { EstablishedEgress } from "../../types/tunnel";
import { log } from "../../core/log";
import { concatBytes } from "../../utils/bytes";
import { flushPendingDownlink, sendDownlink } from "./downlink";
import { handleRemoteClose } from "./failover";
import { failRelay, finishRelay } from "./lifecycle";
import type { RelayState } from "./state";
import {
  DOWNLINK_BATCH_BYTES,
  DOWNLINK_HARD_CAP_BYTES,
  HALF_OPEN_GRACE_MS,
  IDLE_CEILING_MS,
  type RelayGateDecision,
  type Slot,
} from "./types";
import { flushUplink, processDecodeQueue } from "./uplink";

function checkRelayIdle(st: RelayState): void {
  st.idleTimer = null;
  if (st.finished) return;
  const idleFor = Date.now() - st.lastActivityMs;
  if (idleFor < IDLE_CEILING_MS) {
    st.idleTimer = setTimeout(() => checkRelayIdle(st), IDLE_CEILING_MS - idleFor);
    return;
  }
  void flushPendingDownlink(st).finally(() => finishRelay(st, 1000));
}

export function clientHalfClosed(st: RelayState): void {
  if (st.finished || st.halfOpen) return;
  st.halfOpen = true;
  void flushUplink(st);
  void processDecodeQueue(st);
  st.graceDeadline = Date.now() + HALF_OPEN_GRACE_MS;
  st.graceTimer = setTimeout(() => {
    void flushPendingDownlink(st).finally(() => finishRelay(st, 1000));
  }, HALF_OPEN_GRACE_MS);
}

// Admission gate runs once before the header goes out; a denial closes with
// 1008 without sending anything, a throwing gate fails open.
async function runAdmissionGate(st: RelayState): Promise<boolean> {
  const gate = st.opts.gate;
  if (gate === undefined || gate === null) return true;
  let decision: RelayGateDecision;
  try {
    decision = await gate();
  } catch {
    // Fail-open admission gate: a throwing gate must not blackhole traffic.
    decision = true;
  }
  const allowed = typeof decision === "boolean" ? decision : decision.allowed;
  if (!allowed) {
    finishRelay(st, 1008);
    return false;
  }
  return true;
}

// Downlink pump: batch small reads, enforce the 2 MiB cap, and route EOF and
// read errors through zero-byte failover. Returns when the session is done.
async function pumpDownlink(st: RelayState, first: Slot): Promise<void> {
  let current: Slot = first;
  while (!st.finished) {
    let done: boolean;
    let value: Uint8Array | undefined;
    try {
      const result = await current.reader.read();
      done = result.done === true;
      value = result.value;
    } catch (err) {
      if (!st.finished) {
        const retry = st.opts.retry;
        const canRetry =
          retry !== undefined &&
          retry !== null &&
          !st.retriedOnce &&
          !st.halfOpen &&
          st.downlinkBytes === 0;
        if (canRetry) {
          const swapped = await handleRemoteClose(st, current, true);
          if (!swapped || st.finished) return;
          const nextSlot = st.slot;
          if (nextSlot === null) return;
          current = nextSlot;
          continue;
        }
        failRelay(st, "downlink read failed", err);
      }
      return;
    }
    if (st.finished) return;
    st.lastActivityMs = Date.now();
    if (done) {
      const swapped = await handleRemoteClose(st, current);
      if (!swapped || st.finished) return;
      const nextSlot = st.slot;
      if (nextSlot === null) return;
      current = nextSlot;
      continue;
    }
    if (value !== undefined && value.length > 0) {
      st.downlinkBytes += value.length;
      st.bytesDown += value.length;
      st.pendingDown.push(value);
      st.pendingDownBytes += value.length;
      if (st.pendingDownBytes > DOWNLINK_HARD_CAP_BYTES) {
        log.error("relay", "downlink backlog overflow", `buffered ${st.pendingDownBytes} bytes`);
        finishRelay(st, 1009);
        return;
      }
      if (st.pendingDownBytes >= DOWNLINK_BATCH_BYTES) {
        const chunks = st.pendingDown.slice();
        st.pendingDown.length = 0;
        const payload = concatBytes(...chunks);
        st.pendingDownBytes = 0;
        await sendDownlink(st, payload);
        if (st.finished) return;
      }
    }
    if (st.halfOpen && Date.now() >= st.graceDeadline) {
      await flushPendingDownlink(st);
      finishRelay(st, 1000);
      return;
    }
  }
}

export async function runRelay(st: RelayState, initial: EstablishedEgress): Promise<void> {
  // NB: no await may run before the slot opens when there is no gate, so a
  // feedClient() issued right after run() sees the slot synchronously.
  if (st.opts.gate !== undefined && st.opts.gate !== null) {
    if (!(await runAdmissionGate(st))) return;
  }
  st.slot = {
    socket: initial.socket,
    reader: initial.socket.readable.getReader(),
    writer: initial.socket.writable.getWriter(),
    index: initial.candidateIndex,
  };
  if (!st.headerSent) {
    st.headerSent = true;
    const header = st.opts.responseHeader;
    if (header !== undefined && header !== null && header.length > 0) st.sink.send(header);
  }
  st.idleTimer = setTimeout(() => checkRelayIdle(st), IDLE_CEILING_MS);
  const opened = st.slot;
  if (opened === null) return;
  await pumpDownlink(st, opened);
}
