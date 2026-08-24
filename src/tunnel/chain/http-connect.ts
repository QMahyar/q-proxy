import type { DialTarget } from "../../types/tunnel";
import { concatBytes, utf8Encode } from "../../utils/bytes";
import { bracketIpv6 } from "../../utils/net";
import { BufferedByteReader, findCrlfCrlf, prependReadable } from "./socks5";
import type { DuplexIO, ProxyCredentials } from "./socks5";

const MAX_RESPONSE_HEADER_BYTES = 16384;

function buildConnectRequest(target: DialTarget, creds: ProxyCredentials): Uint8Array {
  const hostPort = `${bracketIpv6(target.host)}:${target.port}`;
  const lines = [`CONNECT ${hostPort} HTTP/1.1`, `Host: ${hostPort}`];
  if (creds.username !== null) {
    const raw = `${creds.username}:${creds.password ?? ""}`;
    let binary = "";
    for (let i = 0; i < raw.length; i += 0x8000) {
      binary += String.fromCharCode(...utf8Encode(raw.slice(i, i + 0x8000)));
    }
    lines.push(`Proxy-Authorization: Basic ${btoa(binary)}`);
  }
  lines.push("Proxy-Connection: keep-alive");
  return utf8Encode(`${lines.join("\r\n")}\r\n\r\n`);
}

export async function connectOverHttpConnect(
  io: DuplexIO,
  creds: ProxyCredentials,
  target: DialTarget,
  firstPacket: Uint8Array | null,
): Promise<DuplexIO & { close(): Promise<void> | void }> {
  const writer = io.writable.getWriter();
  const reader = new BufferedByteReader(io.readable);
  try {
    await writer.write(buildConnectRequest(target, creds));
    let acc: Uint8Array = new Uint8Array(0);
    let end = -1;
    for (;;) {
      const chunk = await reader.pull();
      if (chunk === null) throw new Error("http proxy closed before response");
      acc = concatBytes(acc, chunk);
      end = findCrlfCrlf(acc);
      if (end !== -1) break;
      if (acc.length > MAX_RESPONSE_HEADER_BYTES) throw new Error("http proxy response too large");
    }
    const statusLine = new TextDecoder().decode(acc.subarray(0, acc.indexOf(13))).trim();
    const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
    if (match === null) throw new Error(`http proxy malformed status line: ${statusLine}`);
    const code = Number(match[1]);
    if (code < 200 || code >= 300) throw new Error(`http proxy CONNECT failed with status ${code}`);
    const leftoverBytes = acc.subarray(end + 4);
    const bufferedLeftover = reader.drainLeftover();
    const pipelined =
      leftoverBytes.length > 0
        ? bufferedLeftover === null
          ? leftoverBytes
          : concatBytes(leftoverBytes, bufferedLeftover)
        : bufferedLeftover;
    if (firstPacket !== null && firstPacket.length > 0) await writer.write(firstPacket);
    reader.release();
    writer.releaseLock();
    return {
      readable: prependReadable(pipelined, io.readable),
      writable: io.writable,
      close: () => io.close(),
    };
  } catch (err) {
    try {
      reader.release();
    } catch {}
    try {
      writer.releaseLock();
    } catch {}
    throw err instanceof Error ? err : new Error(String(err));
  }
}
