import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { concatBytes, hexToBytes, u16be, utf8Encode } from "../../../src/utils/bytes";
import { seed, testKv } from "../../helpers/seed";

const kv = testKv(env);

const SP = "bytespath";
const VLESS_UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
};

interface ClientTap {
  frames: Uint8Array[];
  closeCode: number | null;
  closed: boolean;
}

async function until<T>(probe: () => T | null, what: string, ms = 8000): Promise<T> {
  const deadline = Date.now() + ms;
  let delay = 5;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function tapClient(ws: WebSocket): ClientTap {
  const tap: ClientTap = { frames: [], closeCode: null, closed: false };
  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (ev) => {
    const data = (ev as MessageEvent).data;
    if (typeof data === "string") tap.frames.push(utf8Encode(data));
    else if (data instanceof ArrayBuffer) tap.frames.push(new Uint8Array(data));
    else tap.frames.push(new Uint8Array(data as ArrayBuffer));
  });
  ws.addEventListener("close", (ev) => {
    tap.closeCode = (ev as CloseEvent).code;
    tap.closed = true;
  });
  return tap;
}

async function openTunnel(path: string): Promise<{ ws: WebSocket; tap: ClientTap }> {
  const res = await SELF.fetch(`https://example.com${path}`, { headers: UPGRADE_HEADERS });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  expect(ws).not.toBeNull();
  ws!.accept();
  return { ws: ws!, tap: tapClient(ws!) };
}

function vlessHandshake(target: Uint8Array): Uint8Array {
  const uuidBytes = hexToBytes(VLESS_UUID.replaceAll("-", ""))!;
  return concatBytes(new Uint8Array([0]), uuidBytes, new Uint8Array([0, 1]), target);
}

function vlessTcpTarget(ipv4: [number, number, number, number], port: number): Uint8Array {
  return concatBytes(u16be(port), new Uint8Array([1, ...ipv4]));
}

beforeEach(async () => {
  await seed(kv, SP, { vlessUuid: VLESS_UUID });
});

describe("byte-level tunnel behavior (VLESS-only)", () => {
  it("rejects a bad-uuid handshake with 1008 and no relay", async () => {
    const badUuid = new Uint8Array(16).fill(9);
    const handshake = concatBytes(
      new Uint8Array([0]),
      badUuid,
      new Uint8Array([0, 1]),
      u16be(443),
      new Uint8Array([2, 11]),
      utf8Encode("example.com"),
    );
    const { ws, tap } = await openTunnel("/vl/e2evless01");
    ws.send(handshake);
    const code = await until(() => (tap.closed ? tap.closeCode : null), "reject close");
    expect(code).toBe(1008);
    expect(tap.frames).toHaveLength(0);
  }, 20_000);

  it("closes 1011 when egress has no candidates for a blocked target", async () => {
    const handshake = vlessHandshake(vlessTcpTarget([10, 0, 0, 5], 443));
    const { ws, tap } = await openTunnel("/vl/e2evless02");
    ws.send(handshake);
    const code = await until(() => (tap.closed ? tap.closeCode : null), "egress-fail close");
    expect(code).toBe(1011);
  }, 20_000);

  it("serves camouflage without upgrade on removed protocol paths", async () => {
    for (const path of ["/vm/e2evmess01", "/tr/e2etrojan1", "/ss/e2ess0001"]) {
      const res = await SELF.fetch(`https://example.com${path}`, { headers: UPGRADE_HEADERS });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type"), path).toContain("text/html");
      expect(res.webSocket, path).toBeNull();
    }
  });
});
