import type { DialTarget, Socket } from "../../types/tunnel";
import { parseHostPort } from "../../utils/net";
import { isIPv4, isIPv6 } from "../../utils/net";
import { connectOverSocks5 } from "./socks5";
import type { DuplexIO, ProxyCredentials } from "./socks5";
import { connectOverHttpConnect } from "./http-connect";

export type ChainKind = "socks5" | "http";

export interface ChainDescriptor {
  kind: ChainKind;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export type ChainConnector = (target: DialTarget, firstPacket: Uint8Array | null) => Promise<Socket>;

const SCHEME_PORTS: Record<string, number> = {
  socks5: 1080,
  socks: 1080,
  http: 80,
  https: 443,
};

const SCHEME_RE = /^(socks5|socks|https|http):\/\//i;
const HOSTNAME_RE = /^[a-z0-9.-]+$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseChainUri(uri: string): ChainDescriptor | null {
  const trimmed = uri.trim();
  if (trimmed.length === 0) return null;
  const match = SCHEME_RE.exec(trimmed);
  if (match === null) return null;
  const scheme = match[1]!.toLowerCase();
  const kind: ChainKind = scheme === "socks5" || scheme === "socks" ? "socks5" : "http";
  const rest = trimmed.slice(match[0].length);
  const atIdx = rest.indexOf("@");
  const userinfo = atIdx === -1 ? null : rest.slice(0, atIdx);
  const hostPart = atIdx === -1 ? rest : rest.slice(atIdx + 1);
  let username: string | null = null;
  let password: string | null = null;
  if (userinfo !== null && userinfo.length > 0) {
    const decoded = safeDecode(userinfo);
    const sep = decoded.indexOf(":");
    username = sep === -1 ? decoded : decoded.slice(0, sep);
    password = sep === -1 ? null : decoded.slice(sep + 1);
    if (username.length === 0) username = null;
    if (password !== null && password.length === 0) password = null;
  }
  const defaultPort = SCHEME_PORTS[scheme]!;
  const hp = parseHostPort(hostPart, defaultPort);
  if (hp === null || hp.host.length === 0) return null;
  if (!isIPv4(hp.host) && !isIPv6(hp.host) && !HOSTNAME_RE.test(hp.host.toLowerCase())) return null;
  if (hp.port < 1 || hp.port > 65535) return null;
  return { kind, host: hp.host, port: hp.port, username, password };
}

export async function dialTcp(host: string, port: number): Promise<Socket> {
  const { connect } = await import("cloudflare:sockets");
  const address = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
  return connect(address, { allowHalfOpen: true }) as unknown as Socket;
}

function asDuplex(socket: Socket): DuplexIO & { close(): Promise<void> } {
  return {
    readable: socket.readable as unknown as ReadableStream<Uint8Array>,
    writable: socket.writable as unknown as WritableStream<Uint8Array>,
    close: () => socket.close(),
  };
}

export function createChainConnector(desc: ChainDescriptor): ChainConnector {
  return async (target: DialTarget, firstPacket: Uint8Array | null): Promise<Socket> => {
    const raw = await dialTcp(desc.host, desc.port);
    const creds: ProxyCredentials = { username: desc.username, password: desc.password };
    try {
      const io =
        desc.kind === "socks5"
          ? await connectOverSocks5(asDuplex(raw), creds, target, firstPacket)
          : await connectOverHttpConnect(asDuplex(raw), creds, target, firstPacket);
      return io as unknown as Socket;
    } catch (err) {
      try {
        await raw.close();
      } catch {}
      throw err instanceof Error ? err : new Error(String(err));
    }
  };
}
