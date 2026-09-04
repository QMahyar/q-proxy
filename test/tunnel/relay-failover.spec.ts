import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRelay, type RelayClientSink } from "../../src/tunnel/relay";
import type { EstablishedEgress, EgressVia, Socket } from "../../src/types/tunnel";
import { concatBytes, utf8Decode, utf8Encode } from "../../src/utils/bytes";

interface ManualSocket {
  socket: Socket;
  writes: Uint8Array[];
  push(chunk: Uint8Array): void;
  closeRemote(): void;
  failRemote(err?: Error): void;
}

function manualSocket(): ManualSocket {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const writes: Uint8Array[] = [];
  const socket: Socket = {
    readable,
    writable: new WritableStream<Uint8Array>({ write: (c) => void writes.push(c) }),
    close: async () => {},
  };
  return {
    socket,
    writes,
    push: (chunk) => controller.enqueue(chunk),
    closeRemote: () => {
      try {
        controller.close();
      } catch {}
    },
    failRemote: (err) => {
      try {
        controller.error(err ?? new Error("remote failure"));
      } catch {}
    },
  };
}

class RecordingSink implements RelayClientSink {
  sent: Uint8Array[] = [];
  closedWith: number | null = null;

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(code: number): void {
    if (this.closedWith === null) this.closedWith = code;
  }
}

function establishedOf(socket: Socket, index: number, via: EgressVia = "direct"): EstablishedEgress {
  return { socket, via, candidateIndex: index };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("zero-byte failover via opener retry", () => {
  it("calls opener.retry once and swaps to the replacement socket", async () => {
    const dead = manualSocket();
    const next = manualSocket();
    const sink = new RecordingSink();
    const opener = {
      attempts: 0,
      retry: (): Promise<EstablishedEgress | null> => {
        opener.attempts++;
        next.push(utf8Encode("after-failover"));
        next.closeRemote();
        return Promise.resolve(establishedOf(next.socket, 2, "proxyip"));
      },
    };
    const header = new Uint8Array([9, 9]);
    const relay = createRelay(sink, { responseHeader: header, retry: () => opener.retry() });
    const done = relay.run(establishedOf(dead.socket, 0));
    dead.closeRemote();
    await done;
    expect(opener.attempts).toBe(1);
    expect(sink.closedWith).toBe(1000);
    expect(sink.sent).toHaveLength(2);
    expect(Array.from(sink.sent[0]!)).toEqual([9, 9]);
    expect(utf8Decode(sink.sent[1]!)).toBe("after-failover");
  });

  it("gives up with 1011 when the opener has no more candidates", async () => {
    const dead = manualSocket();
    const sink = new RecordingSink();
    const opener = {
      attempts: 0,
      retry: (): Promise<EstablishedEgress | null> => {
        opener.attempts++;
        return Promise.resolve(null);
      },
    };
    const relay = createRelay(sink, { retry: () => opener.retry() });
    const done = relay.run(establishedOf(dead.socket, 0));
    dead.closeRemote();
    await done;
    expect(opener.attempts).toBe(1);
    expect(sink.sent).toHaveLength(0);
    expect(sink.closedWith).toBe(1011);
  });
});

describe("half-open grace drain", () => {
  it("drains buffered downlink after the client half-closes, then closes 1000", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    relay.clientClosed();
    sock.push(utf8Encode("first-"));
    sock.push(utf8Encode("second"));
    await vi.advanceTimersByTimeAsync(200);
    expect(sink.sent).toHaveLength(0);
    expect(sink.closedWith).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(utf8Decode(concatBytes(...sink.sent))).toBe("first-second");
    expect(sink.closedWith).toBe(1000);
  });

  it("drops uplink fed after the half-close while still draining", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    relay.clientClosed();
    relay.feedClient(utf8Encode("too-late"));
    await vi.advanceTimersByTimeAsync(60);
    expect(sock.writes).toHaveLength(0);
    sock.push(utf8Encode("drained"));
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(utf8Decode(concatBytes(...sink.sent))).toBe("drained");
    expect(sink.closedWith).toBe(1000);
  });
});

describe("idle timeout", () => {
  it("stays open inside the window and fires at 300 s of silence", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    await vi.advanceTimersByTimeAsync(299_999);
    expect(sink.closedWith).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(sink.sent).toHaveLength(0);
    expect(sink.closedWith).toBe(1000);
  });
});

describe("uplink backlog cap", () => {
  it("terminates with 1011 when queued uplink passes the hard cap", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const blocked = new WritableStream<Uint8Array>({ write: () => new Promise<void>(() => {}) });
    const stuck: Socket = { ...sock.socket, writable: blocked };
    const relay = createRelay(sink);
    void relay.run(establishedOf(stuck, 0));
    for (let i = 0; i < 64; i++) relay.feedClient(new Uint8Array(20480));
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.closedWith).toBe(1011);
    relay.feedClient(new Uint8Array(8));
    await Promise.resolve();
    expect(sink.closedWith).toBe(1011);
  });
});
