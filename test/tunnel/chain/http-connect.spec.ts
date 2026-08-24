import { describe, expect, it } from "vitest";
import { connectOverHttpConnect } from "../../../src/tunnel/chain/http-connect";
import type { DuplexIO } from "../../../src/tunnel/chain/socks5";
import { concatBytes, utf8Decode, utf8Encode, equalsBytes } from "../../../src/utils/bytes";
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

describe("connectOverHttpConnect framing", () => {
  it("sends a CONNECT request and treats a 2xx as established", async () => {
    const mock = scriptDuplex([utf8Encode("HTTP/1.1 200 Connection established\r\n\r\n")]);
    const result = await connectOverHttpConnect(
      mock.io,
      { username: null, password: null },
      TARGET,
      null,
    );
    const request = utf8Decode(mock.clientBytes[0]!);
    expect(request).toContain("CONNECT dest.example.com:443 HTTP/1.1\r\n");
    expect(request).toContain("Host: dest.example.com:443\r\n");
    expect(request).not.toContain("Proxy-Authorization");
    expect(request.endsWith("\r\n\r\n")).toBe(true);
    expect(result.writable).toBe(mock.io.writable);
  });

  it("adds a Basic Proxy-Authorization header when credentials exist", async () => {
    const mock = scriptDuplex([utf8Encode("HTTP/1.0 200 OK\r\n\r\n")]);
    await connectOverHttpConnect(
      mock.io,
      { username: "user", password: "pass" },
      TARGET,
      null,
    );
    const request = utf8Decode(mock.clientBytes[0]!);
    const expected = "Basic dXNlcjpwYXNz";
    expect(request).toContain(`Proxy-Authorization: ${expected}\r\n`);
  });

  it("prepends bytes pipelined after the response terminator", async () => {
    const mock = scriptDuplex([
      concatBytes(
        utf8Encode("HTTP/1.1 200 Connection established\r\n\r\n"),
        utf8Encode("hello"),
      ),
    ]);
    const result = await connectOverHttpConnect(
      mock.io,
      { username: null, password: null },
      TARGET,
      null,
    );
    expect(utf8Decode(await drain(result.readable))).toBe("hello");
  });

  it("writes the first packet after the tunnel is confirmed", async () => {
    const mock = scriptDuplex([utf8Encode("HTTP/1.1 200 Connection established\r\n\r\n")]);
    const payload = utf8Encode("payload-after-connect");
    await connectOverHttpConnect(
      mock.io,
      { username: null, password: null },
      TARGET,
      payload,
    );
    expect(mock.clientBytes).toHaveLength(2);
    expect(equalsBytes(mock.clientBytes[1]!, payload)).toBe(true);
  });

  it("rejects non-2xx proxy responses", async () => {
    const mock = scriptDuplex([utf8Encode("HTTP/1.1 403 Forbidden\r\n\r\n")]);
    await expect(
      connectOverHttpConnect(mock.io, { username: null, password: null }, TARGET, null),
    ).rejects.toThrow(/status 403/);
  });
});
