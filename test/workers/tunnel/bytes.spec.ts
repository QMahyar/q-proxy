import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import {
  deriveCmdKey,
  fnv1a32,
  sealVmessAeadHeader,
  sealVmessAeadResponseHeader,
} from "../../../src/protocols/vmess-crypto";
import { evpBytesToKey, hkdfSha1 } from "../../../src/crypto/kdf";
import { sha224Hex } from "../../../src/crypto/sha224";
import { concatBytes, hexToBytes, u16be, utf8Encode } from "../../../src/utils/bytes";
import { seed, testKv } from "../../helpers/seed";

const kv = testKv(env);

const SP = "bytespath";
const VLESS_UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";
const VMESS_UUID = "1386f85e-657b-4d6e-9d56-78badb75e1fd";
const TROJAN_PASSWORD = "trojan-bytes-pass-1";
const SS_PASSWORD = "ss-bytes-pass-123456";
const TARGET_HOST = "speed.cloudflare.com";
const TARGET_PORT = 443;
const HTTP_204 =
  "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n";

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
};

const CMD_KEY = deriveCmdKey(hexToBytes(VMESS_UUID.replaceAll("-", ""))!);

interface ClientTap {
  frames: Uint8Array[];
  closeCode: number | null;
  closed: boolean;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function fill(n: number, seedValue: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * seedValue + 7) & 0xff;
  return out;
}

function leNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  let v = counter;
  for (let i = 0; i < 8 && v > 0; i++) {
    nonce[i] = v & 0xff;
    v >>>= 8;
  }
  return nonce;
}

async function gcmSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, ck, plaintext as BufferSource),
  );
}

async function gcmOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [
      "decrypt",
    ]);
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, ck, data as BufferSource),
    );
  } catch {
    return null;
  }
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

async function untilFrames(tap: ClientTap, count: number, what: string): Promise<void> {
  try {
    await until(() => (tap.frames.length >= count ? true : null), what);
  } catch (err) {
    throw new Error(
      `${String(err)} [diagnostic: frames=${tap.frames.map((f) => f.length).join(",") || "none"} closed=${tap.closed} closeCode=${tap.closeCode}]`,
    );
  }
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

function socksDomainAddr(host: string): Uint8Array {
  const bytes = utf8Encode(host);
  return concatBytes(new Uint8Array([3, bytes.length]), bytes);
}

function vlessDomainAddr(host: string): Uint8Array {
  const bytes = utf8Encode(host);
  return concatBytes(new Uint8Array([2, bytes.length]), bytes);
}

beforeEach(async () => {
  await seed(kv, SP, {
    vlessUuid: VLESS_UUID,
    vmessUuid: VMESS_UUID,
    trojanPassword: TROJAN_PASSWORD,
    ssPassword: SS_PASSWORD,
  });
});

describe("byte-level tunnel e2e over the speedtest intercept", () => {
  it("carries a real vless request header to the canned 204 response", async () => {
    const uuidBytes = hexToBytes(VLESS_UUID.replaceAll("-", ""))!;
    const handshake = concatBytes(
      new Uint8Array([0]),
      uuidBytes,
      new Uint8Array([0]),
      new Uint8Array([1]),
      u16be(TARGET_PORT),
      vlessDomainAddr(TARGET_HOST),
    );

    const { ws, tap } = await openTunnel("/vl/e2evless01");
    ws.send(handshake);

    await untilFrames(tap, 2, "vless response frames");
    expect(Array.from(tap.frames[0]!)).toEqual([0, 0]);
    expect(new TextDecoder().decode(concatBytes(...tap.frames.slice(1)))).toBe(HTTP_204);

    const code = await until(() => (tap.closed ? tap.closeCode : null), "vless close");
    expect(code).toBe(1000);
  }, 20_000);

  it("seals a real vmess aead header and reads back the encrypted response header", async () => {
    const reqIv = fill(16, 3);
    const reqKey = fill(16, 5);
    const responseV = 0x42;
    const head = concatBytes(
      new Uint8Array([1]),
      reqIv,
      reqKey,
      new Uint8Array([responseV]),
      new Uint8Array([0x00]),
      new Uint8Array([5]),
      new Uint8Array([0]),
      new Uint8Array([1]),
      u16be(TARGET_PORT),
      vlessDomainAddr(TARGET_HOST),
    );
    const legacy = concatBytes(head, u32be(fnv1a32(head)));
    const handshake = await sealVmessAeadHeader(CMD_KEY, legacy, Math.floor(Date.now() / 1000));

    const { ws, tap } = await openTunnel("/vm/e2evmess01");
    ws.send(handshake);

    await untilFrames(tap, 2, "vmess response frames");
    const expectedRespHeader = await sealVmessAeadResponseHeader(reqKey, reqIv, responseV);
    expect(Array.from(tap.frames[0]!)).toEqual(Array.from(expectedRespHeader));
    expect(new TextDecoder().decode(concatBytes(...tap.frames.slice(1)))).toBe(HTTP_204);

    const code = await until(() => (tap.closed ? tap.closeCode : null), "vmess close");
    expect(code).toBe(1000);
  }, 20_000);

  it("walks the trojan sha224 crlf wire format into the canned 204 response", async () => {
    const handshake = concatBytes(
      utf8Encode(sha224Hex(TROJAN_PASSWORD)),
      new Uint8Array([0x0d, 0x0a]),
      new Uint8Array([1]),
      socksDomainAddr(TARGET_HOST),
      u16be(TARGET_PORT),
      new Uint8Array([0x0d, 0x0a]),
    );

    const { ws, tap } = await openTunnel("/tr/e2etrojan1");
    ws.send(handshake);

    await untilFrames(tap, 1, "trojan response frame");
    expect(tap.frames[0]!.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(concatBytes(...tap.frames))).toBe(HTTP_204);

    const code = await until(() => (tap.closed ? tap.closeCode : null), "trojan close");
    expect(code).toBe(1000);
  }, 20_000);

  it("unwraps the sip004 salted frame and decrypts the fresh-salt 204 response", async () => {
    const keyLen = 16;
    const master = evpBytesToKey(SS_PASSWORD, keyLen);
    const upSalt = crypto.getRandomValues(new Uint8Array(keyLen));
    const subkey = await hkdfSha1(master, upSalt, utf8Encode("ss-subkey"), keyLen);
    const framed = concatBytes(socksDomainAddr(TARGET_HOST), u16be(TARGET_PORT));
    const lenFrame = await gcmSeal(subkey, leNonce(0), u16be(framed.length));
    const payloadFrame = await gcmSeal(subkey, leNonce(1), framed);
    const handshake = concatBytes(upSalt, lenFrame, payloadFrame);

    const { ws, tap } = await openTunnel("/ss/e2ess0001");
    ws.send(handshake);

    await untilFrames(tap, 2, "ss response frames");
    const downSalt = tap.frames[0]!;
    expect(downSalt.length).toBe(keyLen);
    expect(Array.from(downSalt)).not.toEqual(Array.from(upSalt));

    const downSubkey = await hkdfSha1(master, downSalt, utf8Encode("ss-subkey"), keyLen);
    const wire = concatBytes(...tap.frames.slice(1));
    let ctr = 0;
    let off = 0;
    const plaintext: Uint8Array[] = [];
    while (off < wire.length) {
      const lenPlain = await gcmOpen(downSubkey, leNonce(ctr++), wire.subarray(off, off + 18));
      expect(lenPlain).not.toBeNull();
      const n = ((lenPlain![0] ?? 0) << 8) | (lenPlain![1] ?? 0);
      off += 18;
      const piece = await gcmOpen(downSubkey, leNonce(ctr++), wire.subarray(off, off + n + 16));
      expect(piece).not.toBeNull();
      off += n + 16;
      plaintext.push(piece!);
    }
    expect(new TextDecoder().decode(concatBytes(...plaintext))).toBe(HTTP_204);

    const code = await until(() => (tap.closed ? tap.closeCode : null), "ss close");
    expect(code).toBe(1000);
  }, 20_000);
});
