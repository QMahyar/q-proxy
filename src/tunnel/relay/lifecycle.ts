import { log } from "../../core/log";
import type { RelayState } from "./state";
import type { Slot } from "./types";

export async function teardownSlot(s: Slot): Promise<void> {
  try {
    await s.reader.cancel().catch(() => {
      // Best-effort: reader may already be released by a concurrent failover.
    });
  } catch {
    // Best-effort teardown: cancel itself must never throw past finishRelay.
  }
  try {
    await s.writer.abort().catch(() => {
      // Best-effort: writer may already be released; abort is idempotent.
    });
  } catch {
    // Best-effort teardown: abort must never throw past finishRelay.
  }
  try {
    await s.socket.close();
  } catch {
    // Best-effort: the socket may already be closed by the remote end.
  }
}

// Single-finish invariant: the first finish() wins; every later call is a no-op.
export function finishRelay(st: RelayState, code: number): void {
  if (st.finished) return;
  st.finished = true;
  if (st.graceTimer !== null) {
    clearTimeout(st.graceTimer);
    st.graceTimer = null;
  }
  if (st.idleTimer !== null) {
    clearTimeout(st.idleTimer);
    st.idleTimer = null;
  }
  const s = st.slot;
  st.slot = null;
  if (s !== null) void teardownSlot(s);
  try {
    st.sink.close(code);
  } catch {
    // Best-effort: the client socket may already be gone; finish is terminal.
  }
}

export function failRelay(st: RelayState, scope: string, err: unknown): void {
  if (st.finished) return;
  log.error("relay", scope, String(err));
  finishRelay(st, 1011);
}
