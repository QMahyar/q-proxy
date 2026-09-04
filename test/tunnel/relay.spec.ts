import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRelay } from "../../src/tunnel/relay";
import type { RelayOptions, RelayClientSink } from "../../src/tunnel/relay";
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

describe("uplink coalescing", () => {
  it("coalesces small messages on a 30 ms timer into one socket write", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    void relay.run(establishedOf(sock.socket, 0));
    relay.feedClient(utf8Encode("aaaa"));
    relay.feedClient(utf8Encode("bbbb"));
    expect(sock.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(31);
    expect(sock.writes).toHaveLength(1);
    expect(utf8Decode(sock.writes[0]!)).toBe("aaaabbbb");
  });

  it("flushes immediately when the coalesce target is reached", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    void relay.run(establishedOf(sock.socket, 0));
    relay.feedClient(new Uint8Array(20480));
    await vi.advanceTimersByTimeAsync(5);
    expect(sock.writes).toHaveLength(1);
    expect(sock.writes[0]!.length).toBe(20480);
  });

  it("routes uplink through decodeUp when provided, dropping incomplete frames", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const seen: string[] = [];
    const relay = createRelay(sink, {
      uplinkDecode: async (chunk: Uint8Array) => {
        seen.push(utf8Decode(chunk));
        if (chunk.length < 4) return null;
        return utf8Encode(`decoded:${chunk.length}`);
      },
    });
    void relay.run(establishedOf(sock.socket, 0));
    relay.feedClient(utf8Encode("ab"));
    await vi.advanceTimersByTimeAsync(5);
    relay.feedClient(utf8Encode("abcdefgh"));
    await vi.advanceTimersByTimeAsync(40);
    expect(seen).toEqual(["ab", "abcdefgh"]);
    expect(sock.writes).toHaveLength(1);
    expect(utf8Decode(sock.writes[0]!)).toBe("decoded:8");
  });
});

describe("downlink batching", () => {
  it("batches small reads up to 32 KiB before sending", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.push(new Uint8Array(20480));
    sock.push(new Uint8Array(20480));
    await Promise.resolve();
    sock.closeRemote();
    await done;
    expect(sink.sent).toHaveLength(1);
    expect(sink.sent[0]!.length).toBe(40960);
    expect(sink.closedWith).toBe(1000);
  });

  it("flushes trailing partial batches when the remote closes", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.push(utf8Encode("tail-bytes"));
    sock.closeRemote();
    await done;
    expect(sink.sent).toHaveLength(1);
    expect(utf8Decode(sink.sent[0]!)).toBe("tail-bytes");
    expect(sink.closedWith).toBe(1000);
  });

  it("sends the response header exactly once before any payload", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const header = new Uint8Array([7, 0]);
    const relay = createRelay(sink, { responseHeader: header });
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.push(utf8Encode("body"));
    sock.closeRemote();
    await done;
    expect(sink.sent).toHaveLength(2);
    expect(Array.from(sink.sent[0]!)).toEqual([7, 0]);
    expect(utf8Decode(sink.sent[1]!)).toBe("body");
  });

  it("encodes downlink through the codec hook", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink, {
      downlinkEncode: async (chunk: Uint8Array) => utf8Encode(`<${new TextDecoder().decode(chunk)}>`),
    });
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.push(utf8Encode("x"));
    sock.closeRemote();
    await done;
    expect(utf8Decode(sink.sent[0]!)).toBe("<x>");
  });
});

describe("zero-byte failover", () => {
  it("swaps to the next socket mid-session and keeps relaying", async () => {
    const dead = manualSocket();
    const healthy = manualSocket();
    const sink = new RecordingSink();
    let retries = 0;
    const opts: RelayOptions = {
      responseHeader: new Uint8Array([1]),
      retry: () => {
        retries++;
        healthy.push(utf8Encode("payload"));
        healthy.closeRemote();
        return Promise.resolve(establishedOf(healthy.socket, 1, "proxyip"));
      },
    };
    const relay = createRelay(sink, opts);
    const done = relay.run(establishedOf(dead.socket, 0));
    dead.closeRemote();
    await done;
    expect(retries).toBe(1);
    expect(sink.closedWith).toBe(1000);
    expect(sink.sent).toHaveLength(2);
    expect(Array.from(sink.sent[0]!)).toEqual([1]);
    expect(utf8Decode(sink.sent[1]!)).toBe("payload");
  });

  it("retries at most once before giving up with 1011", async () => {
    const first = manualSocket();
    const second = manualSocket();
    const sink = new RecordingSink();
    let retries = 0;
    const relay = createRelay(sink, {
      retry: () => {
        retries++;
        return Promise.resolve(establishedOf(second.socket, 1));
      },
    });
    const done = relay.run(establishedOf(first.socket, 0));
    first.closeRemote();
    await vi.advanceTimersByTimeAsync(5);
    second.closeRemote();
    await vi.advanceTimersByTimeAsync(5);
    await done;
    expect(retries).toBe(1);
    expect(sink.closedWith).toBe(1011);
  });

  it("does not retry when actual bytes were received", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const retry = vi.fn(() => Promise.resolve<EstablishedEgress | null>(null));
    const relay = createRelay(sink, { retry });
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.push(utf8Encode("some data"));
    sock.closeRemote();
    await done;
    expect(retry).not.toHaveBeenCalled();
    expect(sink.closedWith).toBe(1000);
  });

  it("falls back to 1011 when the retry callback returns null", async () => {
    const dead = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink, { retry: () => Promise.resolve(null) });
    const done = relay.run(establishedOf(dead.socket, 0));
    dead.closeRemote();
    await done;
    expect(sink.closedWith).toBe(1011);
  });
});

describe("half-open drain", () => {
  it("keeps flushing downlink after the client closes and enforces the 5 s cap", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    relay.clientClosed();
    sock.push(utf8Encode("late-flush"));
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(utf8Decode(concatBytes(...sink.sent))).toBe("late-flush");
    expect(sink.closedWith).toBe(1000);
    expect(sock.writes).toHaveLength(0);
  });

  it("stops accepting client uplink after the client half-closes", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    void relay.run(establishedOf(sock.socket, 0));
    relay.clientClosed();
    relay.feedClient(utf8Encode("dropped"));
    await vi.advanceTimersByTimeAsync(60);
    expect(sock.writes).toHaveLength(0);
  });

  it("flushes already-queued uplink to origin when the client half-closes", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    void relay.run(establishedOf(sock.socket, 0));
    relay.feedClient(utf8Encode("tail-bytes"));
    relay.clientClosed();
    await vi.advanceTimersByTimeAsync(60);
    expect(utf8Decode(concatBytes(...sock.writes))).toBe("tail-bytes");
    expect(sink.closedWith).toBeNull();
    sock.closeRemote();
    await vi.advanceTimersByTimeAsync(100);
    expect(sink.closedWith).toBe(1000);
  });
});

describe("failure handling", () => {
  it("closes with 1011 when the remote read fails", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.failRemote(new Error("boom"));
    await done;
    expect(sink.closedWith).toBe(1011);
  });

  it("closes with 1011 when the uplink backlog exceeds the hard cap", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const blockedWriter = new WritableStream<Uint8Array>({
      write: () => new Promise<void>(() => {}),
    });
    const stuck: Socket = {
      ...sock.socket,
      writable: blockedWriter,
    };
    const relay = createRelay(sink);
    void relay.run(establishedOf(stuck, 0));
    for (let i = 0; i < 60; i++) relay.feedClient(new Uint8Array(20480));
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.closedWith).toBe(1011);
  });

  it("closes with 1011 when the pre-decode backlog exceeds the hard cap", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink, {
      uplinkDecode: () => new Promise<Uint8Array | null>(() => {}),
    });
    void relay.run(establishedOf(sock.socket, 0));
    for (let i = 0; i < 60; i++) relay.feedClient(new Uint8Array(20480));
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.closedWith).toBe(1011);
  });

  it("closes with 1009 when pending downlink exceeds the 2MB hard cap", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.push(new Uint8Array(2 * 1024 * 1024 + 1));
    await done;
    expect(sink.closedWith).toBe(1009);
  });

  it("keeps accepting decoded traffic because the pre-decode counter drains", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    let decodes = 0;
    const relay = createRelay(sink, {
      uplinkDecode: async () => {
        decodes++;
        return null;
      },
    });
    void relay.run(establishedOf(sock.socket, 0));
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 50; i++) relay.feedClient(new Uint8Array(20480));
      await vi.advanceTimersByTimeAsync(35);
    }
    expect(decodes).toBe(150);
    expect(sink.closedWith).toBeNull();
  });
});

describe("read-error failover", () => {
  it("swaps sockets on a downlink read error with zero bytes received", async () => {
    const dead = manualSocket();
    const healthy = manualSocket();
    const sink = new RecordingSink();
    let retries = 0;
    const relay = createRelay(sink, {
      retry: () => {
        retries++;
        healthy.push(utf8Encode("recovered"));
        healthy.closeRemote();
        return Promise.resolve(establishedOf(healthy.socket, 1, "proxyip"));
      },
    });
    const done = relay.run(establishedOf(dead.socket, 0));
    dead.failRemote(new Error("connection reset"));
    await done;
    expect(retries).toBe(1);
    expect(sink.closedWith).toBe(1000);
    expect(utf8Decode(sink.sent[0]!)).toBe("recovered");
  });

  it("still closes 1011 on a read error after bytes were received", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const retry = vi.fn(() => Promise.resolve<EstablishedEgress | null>(null));
    const relay = createRelay(sink, { retry });
    const done = relay.run(establishedOf(sock.socket, 0));
    sock.push(utf8Encode("data"));
    await vi.advanceTimersByTimeAsync(1);
    sock.failRemote(new Error("connection reset"));
    await done;
    expect(retry).not.toHaveBeenCalled();
    expect(sink.closedWith).toBe(1011);
  });
});

describe("idle ceiling", () => {
  it("closes with 1000 after 300 s with no activity in either direction", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    await vi.advanceTimersByTimeAsync(300_000);
    await done;
    expect(sink.closedWith).toBe(1000);
  });

  it("extends the ceiling on activity and closes after the next full idle window", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    await vi.advanceTimersByTimeAsync(250_000);
    sock.push(utf8Encode("keepalive"));
    await vi.advanceTimersByTimeAsync(250_000);
    expect(sink.closedWith).toBeNull();
    await vi.advanceTimersByTimeAsync(50_000);
    await done;
    expect(sink.closedWith).toBe(1000);
  });
});

describe("byte accounting", () => {
  it("counts accepted uplink bytes and delivered downlink bytes", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    expect(relay.bytesUp).toBe(0);
    expect(relay.bytesDown).toBe(0);
    const done = relay.run(establishedOf(sock.socket, 0));
    relay.feedClient(utf8Encode("aaaa"));
    relay.feedClient(new Uint8Array(10));
    expect(relay.bytesUp).toBe(14);
    sock.push(utf8Encode("hello"));
    sock.push(new Uint8Array(7));
    sock.closeRemote();
    await done;
    expect(relay.bytesDown).toBe(12);
    expect(relay.bytesUp).toBe(14);
    expect(sink.closedWith).toBe(1000);
  });

  it("counts raw client bytes even when the decode hook drops the frame", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink, { uplinkDecode: async () => null });
    const done = relay.run(establishedOf(sock.socket, 0));
    relay.feedClient(utf8Encode("dropped-frame"));
    await vi.advanceTimersByTimeAsync(40);
    expect(relay.bytesUp).toBe(13);
    sock.closeRemote();
    await done;
    expect(sink.closedWith).toBe(1011);
  });

  it("stops counting uplink once the client half-closes", async () => {
    const sock = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink);
    const done = relay.run(establishedOf(sock.socket, 0));
    relay.feedClient(utf8Encode("kept"));
    relay.clientClosed();
    relay.feedClient(utf8Encode("dropped"));
    await vi.advanceTimersByTimeAsync(60);
    expect(relay.bytesUp).toBe(4);
    sock.closeRemote();
    await done;
    expect(sink.closedWith).toBe(1000);
  });

  it("accumulates totals across the zero-byte failover swap", async () => {
    const dead = manualSocket();
    const healthy = manualSocket();
    const sink = new RecordingSink();
    const relay = createRelay(sink, {
      retry: () => {
        healthy.push(utf8Encode("payload"));
        healthy.closeRemote();
        return Promise.resolve(establishedOf(healthy.socket, 1, "proxyip"));
      },
    });
    const done = relay.run(establishedOf(dead.socket, 0));
    relay.feedClient(utf8Encode("up-bytes"));
    await vi.advanceTimersByTimeAsync(40);
    dead.closeRemote();
    await done;
    expect(relay.bytesUp).toBe(8);
    expect(relay.bytesDown).toBe(7);
    expect(sink.closedWith).toBe(1000);
  });
});
