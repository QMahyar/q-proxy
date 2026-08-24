import { describe, expect, it } from "vitest";
import { connectOverSocks5 } from "../../../src/tunnel/chain/socks5";
import type { DuplexIO } from "../../../src/tunnel/chain/socks5";
import { concatBytes, equalsBytes, utf8Decode, utf8Encode } from "../../../src/utils/bytes";
import type { DialTarget } from "../../../src/types/tunnel";

const TARGET: DialTarget = { host: "dest.example.com", port: 443 };

interface ScriptedMock {
  io: DuplexIO & { close(): Promise<void> };
  clientBytes: Uint8Array[];
}

function scriptDuplex(replies: Uint8Array[]): ScriptedMock {
  const clientBytes: Uint8Array[] = [];
  const toClient = new TransformStream<Uint8Array, Uint8Array>();
  void (async () => {
    const writer = toClient.writable.getWriter();
    for (const reply of replies) await writer.write(reply);
    try {
      await writer.close();
    } catch {}
  })();
  const toServer = new TransformStream<Uint8Array, Uint8Array>();
  void toServer.readable
    .pipeTo(new WritableStream<Uint8Array>({ write: (c) => void clientBytes.push(c) }))
    .catch(() => {});
  return {
    io: {
      readable: toClient.readable,
      writable: toServer.writable,
      close: async () => {},
    },
    clientBytes,
  };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value!);
  }
  return concatBytes(...chunks);
}

describe("connectOverSocks5 framing", () => {
  it("negotiates no-auth and sends a domain CONNECT request", async () => {
    const mock = scriptDuplex([
      new Uint8Array([0x05, 0x00]),
      new Uint8Array([0x05, 0x00, 0x00, 0x01, 10, 0, 0, 1, 0x00, 0x50]),
    ]);
    const result = await connectOverSocks5(mock.io, { username: null, password: null }, TARGET, null);
    expect(mock.clientBytes).toHaveLength(2);
    expect(Array.from(mock.clientBytes[0]!)).toEqual([0x05, 0x01, 0x00]);
    const req = mock.clientBytes[1]!;
    expect(req[0]).toBe(0x05);
    expect(req[1]).toBe(0x01);
    expect(req[2]).toBe(0x00);
    expect(req[3]).toBe(0x03);
    expect(req[4]).toBe(16);
    expect(utf8Decode(req.subarray(5, 21))).toBe("dest.example.com");
    expect((req[req.length - 2]! << 8) | req[req.length - 1]!).toBe(443);
    expect(result.writable).toBe(mock.io.writable);
  });

  it("prepends bytes pipelined after the CONNECT reply into the readable side", async () => {
    const mock = scriptDuplex([
      concatBytes(
        new Uint8Array([0x05, 0x00]),
        new Uint8Array([0x05, 0x00, 0x00, 0x01, 10, 0, 0, 1, 0x00, 0x50]),
        utf8Encode("XY"),
      ),
    ]);
    const result = await connectOverSocks5(mock.io, { username: null, password: null }, TARGET, null);
    const drained = await drain(result.readable);
    expect(utf8Decode(drained)).toBe("XY");
  });

  it("performs RFC1929 username/password auth when the server picks method 2", async () => {
    const mock = scriptDuplex([
      new Uint8Array([0x05, 0x02]),
      new Uint8Array([0x01, 0x00]),
      new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 80]),
    ]);
    const result = await connectOverSocks5(
      mock.io,
      { username: "user", password: "pass" },
      TARGET,
      null,
    );
    expect(Array.from(mock.clientBytes[0]!)).toEqual([0x05, 0x02, 0x00, 0x02]);
    const auth = mock.clientBytes[1]!;
    expect(auth[0]).toBe(0x01);
    expect(auth[1]).toBe(4);
    expect(utf8Decode(auth.subarray(2, 6))).toBe("user");
    expect(auth[6]).toBe(4);
    expect(utf8Decode(auth.subarray(7, 11))).toBe("pass");
    expect(result.readable).toBeDefined();
  });

  it("writes the first packet only after a successful CONNECT reply", async () => {
    const mock = scriptDuplex([
      new Uint8Array([0x05, 0x00]),
      new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 80]),
    ]);
    const payload = utf8Encode("GET / HTTP/1.1\r\n\r\n");
    await connectOverSocks5(mock.io, { username: null, password: null }, TARGET, payload);
    expect(mock.clientBytes).toHaveLength(3);
    expect(equalsBytes(mock.clientBytes[2]!, payload)).toBe(true);
  });

  it("uses the IPv4 binary address type for literal IPv4 targets", async () => {
    const mock = scriptDuplex([
      new Uint8Array([0x05, 0x00]),
      new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 53]),
    ]);
    await connectOverSocks5(
      mock.io,
      { username: null, password: null },
      { host: "9.9.9.9", port: 53 },
      null,
    );
    const req = mock.clientBytes[1]!;
    expect(req[3]).toBe(0x01);
    expect(Array.from(req.subarray(4, 8))).toEqual([9, 9, 9, 9]);
    expect((req[req.length - 2]! << 8) | req[req.length - 1]!).toBe(53);
  });

  it("rejects servers that answer with an error code", async () => {
    const mock = scriptDuplex([
      new Uint8Array([0x05, 0x00]),
      new Uint8Array([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
    ]);
    await expect(
      connectOverSocks5(mock.io, { username: null, password: null }, TARGET, null),
    ).rejects.toThrow(/connect failed code 1/);
  });

  it("rejects servers offering no acceptable auth method", async () => {
    const mock = scriptDuplex([new Uint8Array([0x05, 0xff])]);
    await expect(
      connectOverSocks5(mock.io, { username: null, password: null }, TARGET, null),
    ).rejects.toThrow(/no acceptable method/);
  });
});
