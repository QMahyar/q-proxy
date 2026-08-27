import type { EstablishedEgress, Socket } from "../types/tunnel";
import { log } from "../core/log";
import { concatBytes } from "../utils/bytes";

const COALESCE_TARGET_BYTES = 20480;
const COALESCE_INTERVAL_MS = 30;
const DOWNLINK_BATCH_BYTES = 32768;
const UPLINK_HARD_CAP_BYTES = 8 * 1024 * 1024;
const HALF_OPEN_GRACE_MS = 5000;

export interface RelayOptions {
  responseHeader?: Uint8Array | null;
  uplinkDecode?: ((chunk: Uint8Array) => Promise<Uint8Array | null>) | null;
  downlinkEncode?: ((chunk: Uint8Array) => Promise<Uint8Array>) | null;
  retry?: (() => Promise<EstablishedEgress | null>) | null;
}

export interface RelayClientSink {
  send(data: Uint8Array): void;
  close(code: number): void;
}

export interface RelayHandle {
  feedClient(chunk: Uint8Array): void;
  clientClosed(): void;
  run(initial: EstablishedEgress): Promise<void>;
}

interface Slot {
  socket: Socket;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  index: number;
}

export function createRelay(sink: RelayClientSink, opts: RelayOptions = {}): RelayHandle {
  let finished = false;
  let halfOpen = false;
  let retriedOnce = false;
  let headerSent = false;
  let downlinkBytes = 0;
  let graceDeadline = Number.POSITIVE_INFINITY;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  let slot: Slot | null = null;

  const upQueue: Uint8Array[] = [];
  let upQueued = 0;
  let flushScheduled = false;
  let writeBusy = false;

  const decodeQueue: Uint8Array[] = [];
  let decodeQueued = 0;
  let decoding = false;

  const pendingDown: Uint8Array[] = [];
  let pendingDownBytes = 0;

  let sendTail: Promise<void> = Promise.resolve();

  const teardownSlot = async (s: Slot): Promise<void> => {
    try {
      await s.reader.cancel().catch(() => {});
    } catch {}
    try {
      await s.writer.abort().catch(() => {});
    } catch {}
    try {
      await s.socket.close();
    } catch {}
  };

  const finish = (code: number): void => {
    if (finished) return;
    finished = true;
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    const s = slot;
    slot = null;
    if (s !== null) void teardownSlot(s);
    try {
      sink.close(code);
    } catch {}
  };

  const fail = (scope: string, err: unknown): void => {
    if (finished) return;
    log.error("relay", scope, String(err));
    finish(1011);
  };

  const scheduleFlush = (): void => {
    if (flushScheduled || finished || halfOpen) return;
    flushScheduled = true;
    setTimeout(() => {
      flushScheduled = false;
      void flushUplink();
    }, COALESCE_INTERVAL_MS);
  };

  const flushUplink = async (): Promise<void> => {
    if (finished || halfOpen) return;
    if (writeBusy || slot === null) {
      if (upQueued > 0) scheduleFlush();
      return;
    }
    if (upQueued === 0) return;
    const target = slot;
    const genBefore = generation;
    const chunks = upQueue.splice(0);
    const data = concatBytes(...chunks);
    upQueued = 0;
    writeBusy = true;
    try {
      await target.writer.write(data);
    } catch (err) {
      writeBusy = false;
      if (!finished && generation === genBefore) fail("uplink write failed", err);
      return;
    }
    writeBusy = false;
    if (!finished && !halfOpen && upQueued > 0) scheduleFlush();
  };

  const enqueueUp = (bytes: Uint8Array): void => {
    upQueue.push(bytes);
    upQueued += bytes.length;
    if (upQueued > UPLINK_HARD_CAP_BYTES) {
      fail("uplink backlog overflow", new Error(`coalesced ${upQueued} bytes`));
      return;
    }
    if (upQueued >= COALESCE_TARGET_BYTES) void flushUplink();
    else scheduleFlush();
  };

  const processDecodes = async (): Promise<void> => {
    if (decoding) return;
    decoding = true;
    try {
      while (decodeQueue.length > 0 && !finished && !halfOpen) {
        const chunk = decodeQueue.shift()!;
        decodeQueued -= chunk.length;
        const decode = opts.uplinkDecode;
        if (decode === undefined || decode === null) continue;
        const out = await decode(chunk);
        if (out !== null && out.length > 0 && !finished && !halfOpen) enqueueUp(out);
      }
    } catch (err) {
      decoding = false;
      fail("uplink decode failed", err);
      return;
    }
    decoding = false;
  };

  const feedClient = (chunk: Uint8Array): void => {
    if (finished || halfOpen) return;
    if (opts.uplinkDecode !== undefined && opts.uplinkDecode !== null) {
      decodeQueued += chunk.length;
      if (decodeQueued > UPLINK_HARD_CAP_BYTES) {
        fail("decode backlog overflow", new Error(`decode queued ${decodeQueued} bytes`));
        return;
      }
      decodeQueue.push(chunk);
      void processDecodes();
      return;
    }
    enqueueUp(chunk);
  };

  const sendDown = (data: Uint8Array): Promise<void> => {
    sendTail = sendTail
      .then(async () => {
        if (finished) return;
        const frame =
          opts.downlinkEncode !== undefined && opts.downlinkEncode !== null
            ? await opts.downlinkEncode(data)
            : data;
        if (frame.length > 0) sink.send(frame);
      })
      .catch((err: unknown) => {
        if (!finished) fail("downlink send failed", err);
      });
    return sendTail;
  };

  const flushPendingDownlink = (): Promise<void> => {
    if (pendingDownBytes === 0) return Promise.resolve();
    const payload = concatBytes(...pendingDown.splice(0));
    pendingDownBytes = 0;
    return sendDown(payload);
  };

  const clientClosed = (): void => {
    if (finished || halfOpen) return;
    halfOpen = true;
    graceDeadline = Date.now() + HALF_OPEN_GRACE_MS;
    graceTimer = setTimeout(() => {
      void flushPendingDownlink().finally(() => finish(1000));
    }, HALF_OPEN_GRACE_MS);
  };

  const handleRemoteClose = async (closed: Slot): Promise<boolean> => {
    await flushPendingDownlink();
    if (finished) return false;
    if (halfOpen) {
      finish(1000);
      return false;
    }
    const retry = opts.retry;
    const canRetry =
      retry !== undefined && retry !== null && !retriedOnce && downlinkBytes === 0;
    if (!canRetry) {
      finish(downlinkBytes === 0 ? 1011 : 1000);
      return false;
    }
    retriedOnce = true;
    generation++;
    slot = null;
    void teardownSlot(closed);
    let next: EstablishedEgress | null = null;
    try {
      next = await retry();
    } catch (err) {
      log.debug("relay", "zero-byte retry attempt failed", { reason: String(err) });
    }
    if (next === null || finished) {
      finish(1011);
      return false;
    }
    downlinkBytes = 0;
    pendingDown.splice(0);
    pendingDownBytes = 0;
    slot = {
      socket: next.socket,
      reader: next.socket.readable.getReader(),
      writer: next.socket.writable.getWriter(),
      index: next.candidateIndex,
    };
    log.info("relay", "zero-byte failover swap", { candidateIndex: next.candidateIndex });
    scheduleFlush();
    return true;
  };

  const run = async (initial: EstablishedEgress): Promise<void> => {
    slot = {
      socket: initial.socket,
      reader: initial.socket.readable.getReader(),
      writer: initial.socket.writable.getWriter(),
      index: initial.candidateIndex,
    };
    if (!headerSent) {
      headerSent = true;
      const header = opts.responseHeader;
      if (header !== undefined && header !== null && header.length > 0) sink.send(header);
    }
    let current: Slot = slot;
    while (!finished) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        const result = await current.reader.read();
        done = result.done === true;
        value = result.value;
      } catch (err) {
        if (!finished) fail("downlink read failed", err);
        return;
      }
      if (finished) return;
      if (done) {
        const swapped = await handleRemoteClose(current);
        if (!swapped || finished) return;
        const nextSlot = slot;
        if (nextSlot === null) return;
        current = nextSlot;
        continue;
      }
      if (value !== undefined && value.length > 0) {
        downlinkBytes += value.length;
        pendingDown.push(value);
        pendingDownBytes += value.length;
        if (pendingDownBytes >= DOWNLINK_BATCH_BYTES) {
          const payload = concatBytes(...pendingDown.splice(0));
          pendingDownBytes = 0;
          await sendDown(payload);
          if (finished) return;
        }
      }
      if (halfOpen && Date.now() >= graceDeadline) {
        await flushPendingDownlink();
        finish(1000);
        return;
      }
    }
  };

  return { feedClient, clientClosed, run };
}

