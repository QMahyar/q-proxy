import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { concatBytes, hexToBytes, u16be, utf8Encode } from "../../src/utils/bytes";
import { seed, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const kv = testKv(env);

const SP = "transportpath";
const PASSWORD = "transport-horse-42";
const VLESS_UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
};

function post(json: unknown, extra: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(json),
  };
}

function put(json: unknown, extra: Record<string, string> = {}): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(json),
  };
}

async function setupAdmin(): Promise<Record<string, string>> {
  await seed(kv, SP, { vlessUuid: VLESS_UUID });
  const res = await SELF.fetch(`https://example.com/${SP}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
  expect(res.status).toBe(200);
  const raw = JSON.parse((await kv.get("qproxy:settings")) as string) as { data: Record<string, unknown> };
  raw.data.passwordIsBootstrap = false;
  await kv.put("qproxy:settings", JSON.stringify(raw));
  invalidateSettingsCache();
  const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  return { Cookie: cookie, "X-Q-Panel": "1" };
}

async function saveSettings(csrf: Record<string, string>, patch: Record<string, unknown>): Promise<void> {
  const res = await SELF.fetch(`https://example.com/${SP}/api/settings/save`, put(patch, csrf));
  expect(res.status).toBe(200);
}

// Handshake for 127.0.0.1:80: the address is dial-blocked, so a *parsed*
// handshake races the (empty) egress pool and closes 1011 almost
// immediately — no live network needed. A rejected handshake closes 1008.
function vlessTcpHandshake(uuid = VLESS_UUID): Uint8Array {
  const uuidBytes = hexToBytes(uuid.replaceAll("-", ""))!;
  return concatBytes(new Uint8Array([0]), uuidBytes, new Uint8Array([0, 1]), u16be(80), new Uint8Array([1, 127, 0, 0, 1]));
}

function grpcFrame(payload: Uint8Array): Uint8Array {
  const head = new Uint8Array(5);
  head[0] = 0;
  new DataView(head.buffer).setUint32(1, payload.byteLength);
  return concatBytes(head, payload);
}

function xhttpChunk(payload: Uint8Array): Uint8Array {
  return concatBytes(utf8Encode(`${payload.byteLength.toString(16)}\r\n`), payload, utf8Encode("\r\n"));
}

async function openTunnelSocket(): Promise<WebSocket> {
  const res = await SELF.fetch("https://example.com/vl/abcd1234efgh5678", { headers: UPGRADE_HEADERS });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).not.toBeNull();
  ws!.accept();
  return ws!;
}

function awaitCloseCode(ws: WebSocket, ms = 8000): Promise<number | null> {
  if (ws.readyState === 3) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    ws.addEventListener("close", (ev) => {
      clearTimeout(timer);
      resolve((ev as CloseEvent).code);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

describe("tunnel transport selection", () => {
  it("parses a ws vless handshake by default (1011 relay attempt, not 1008)", async () => {
    await setupAdmin();
    const ws = await openTunnelSocket();
    const closed = awaitCloseCode(ws);
    ws.send(vlessTcpHandshake().buffer as ArrayBuffer);
    expect(await closed).toBe(1011);
  });

  it("still rejects a bad-uuid handshake with 1008", async () => {
    await setupAdmin();
    const ws = await openTunnelSocket();
    const closed = awaitCloseCode(ws);
    ws.send(vlessTcpHandshake("00000000-0000-0000-0000-000000000000").buffer as ArrayBuffer);
    expect(await closed).toBe(1008);
  });

  it("decodes grpc-framed handshakes only when transport=grpc", async () => {
    const csrf = await setupAdmin();
    // Default ws transport cannot complete a grpc-framed handshake: the
    // frame bytes fail vless identity and the socket closes 1008.
    const wsPlain = await openTunnelSocket();
    const plainClosed = awaitCloseCode(wsPlain);
    wsPlain.send(grpcFrame(vlessTcpHandshake()).buffer as ArrayBuffer);
    expect(await plainClosed).toBe(1008);

    await saveSettings(csrf, { transport: "grpc" });
    const ws = await openTunnelSocket();
    const closed = awaitCloseCode(ws);
    ws.send(grpcFrame(vlessTcpHandshake()).buffer as ArrayBuffer);
    expect(await closed).toBe(1011);
    try {
      ws.close(1000);
    } catch {}
  });

  it("decodes xhttp-chunked handshakes only when transport=xhttp", async () => {
    const csrf = await setupAdmin();
    const wsPlain = await openTunnelSocket();
    const plainClosed = awaitCloseCode(wsPlain);
    wsPlain.send(xhttpChunk(vlessTcpHandshake()).buffer as ArrayBuffer);
    expect(await plainClosed).toBe(1008);

    await saveSettings(csrf, { transport: "xhttp" });
    const ws = await openTunnelSocket();
    const closed = awaitCloseCode(ws);
    ws.send(concatBytes(xhttpChunk(vlessTcpHandshake()), utf8Encode("0\r\n\r\n")).buffer as ArrayBuffer);
    expect(await closed).toBe(1011);
    try {
      ws.close(1000);
    } catch {}
  });
});
