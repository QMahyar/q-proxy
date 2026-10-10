import { concatBytes } from "../../utils/bytes";
import { failRelay } from "./lifecycle";
import type { RelayState } from "./state";

export function sendDownlink(st: RelayState, data: Uint8Array): Promise<void> {
  st.sendTail = st.sendTail
    .then(async () => {
      if (st.finished) return;
      const frame =
        st.opts.downlinkEncode !== undefined && st.opts.downlinkEncode !== null
          ? await st.opts.downlinkEncode(data)
          : data;
      if (frame.length > 0) st.sink.send(frame);
    })
    .catch((err: unknown) => {
      if (!st.finished) failRelay(st, "downlink send failed", err);
    });
  return st.sendTail;
}

export function flushPendingDownlink(st: RelayState): Promise<void> {
  if (st.pendingDownBytes === 0) return Promise.resolve();
  const chunks = st.pendingDown.slice();
  st.pendingDown.length = 0;
  const payload = concatBytes(...chunks);
  st.pendingDownBytes = 0;
  return sendDownlink(st, payload);
}
