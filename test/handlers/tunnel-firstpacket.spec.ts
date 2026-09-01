import { describe, expect, it } from "vitest";
import { resolveTcpFirstPacket } from "../../src/handlers/tunnel";
import type { ParsedRequest, ProtocolInbound } from "../../src/protocols/common";
import { createVlessInbound } from "../../src/protocols/vless";
import { createVmessInbound } from "../../src/protocols/vmess";
import { createTrojanInbound } from "../../src/protocols/trojan";
import { createSSInbound } from "../../src/protocols/shadowsocks";
import {
  aesGcmEncrypt,
  buildChunkNonce,
  deriveCmdKey,
  fnv1a32,
  sealVmessAeadHeader,
} from "../../src/protocols/vmess-crypto";
import { evpBytesToKey, hkdfSha1 } from "../../src/crypto/kdf";
import { sha224Hex } from "../../src/crypto/sha224";
import { concatBytes, hexToBytes, u16be, utf8Encode } from "../../src/utils/bytes";

const VLESS_UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";
const VMESS_UUID = "1386f85e-657b-4d6e-9d56-78badb75e1fd";
const TROJAN_PASSWORD = "trojan-firstpacket-pass";
const SS_PASSWORD = "ss-firstpacket-pass-1";
const HOST = "speed.example.com";
const PAYLOAD = utf8Encode("GET /first HTTP/1.1\r\nHost: speed.example.com\r\n\r\n");

type AnyInbound = ProtocolInbound<ParsedRequest<"tcp"> | ParsedRequest<"udp">>;

async function firstPacketVia(inbound: AnyInbound, data: Uint8Array): Promise<Uint8Array> {
  const outcome = await inbound.push(data);
  if (outcome.state !== "ready") throw new Error(`expected ready, got ${outcome.state}: ${JSON.stringify(outcome)}`);
  const codec = inbound.bodyCodec();
  const uplinkDecode = codec === null ? null : (chunk: Uint8Array) => codec.decodeUp(chunk);
  return resolveTcpFirstPacket(inbound, uplinkDecode, outcome.rest);
}

function vlessCoalesced(): Uint8Array {
  const uuidBytes = hexToBytes(VLESS_UUID.replaceAll("-", ""))!;
  return concatBytes(
    new Uint8Array([0]),
    uuidBytes,
    new Uint8Array([0]),
    new Uint8Array([1]),
    u16be(443),
    new Uint8Array([2, HOST.length]),
    utf8Encode(HOST),
    PAYLOAD,
  );
}

function trojanCoalesced(): Uint8Array {
  return concatBytes(
    utf8Encode(sha224Hex(TROJAN_PASSWORD)),
    new Uint8Array([0x0d, 0x0a]),
    new Uint8Array([1]),
    new Uint8Array([3, HOST.length]),
    utf8Encode(HOST),
    u16be(443),
    new Uint8Array([0x0d, 0x0a]),
    PAYLOAD,
  );
}

async function vmessCoalesced(): Promise<{ frame: Uint8Array; plain: Uint8Array }> {
  const reqIv = new Uint8Array(16).fill(3);
  const reqKey = new Uint8Array(16).fill(5);
  const head = concatBytes(
    new Uint8Array([1]),
    reqIv,
    reqKey,
    new Uint8Array([0x42]),
    new Uint8Array([0x01]),
    new Uint8Array([0x03]),
    new Uint8Array([0]),
    new Uint8Array([1]),
    u16be(443),
    new Uint8Array([2, HOST.length]),
    utf8Encode(HOST),
  );
  const legacy = concatBytes(head, u32be(fnv1a32(head)));
  const cmdKey = deriveCmdKey(hexToBytes(VMESS_UUID.replaceAll("-", ""))!);
  const handshake = await sealVmessAeadHeader(cmdKey, legacy, Math.floor(Date.now() / 1000));
  const chunk = concatBytes(
    u16be(PAYLOAD.length + 16),
    await aesGcmEncrypt(reqKey, buildChunkNonce(reqIv, 0), PAYLOAD, null),
  );
  return { frame: concatBytes(handshake, chunk), plain: PAYLOAD };
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

async function gcmSeal(key: Uint8Array, counter: number, plain: Uint8Array): Promise<Uint8Array> {
  const nonce = new Uint8Array(12);
  let v = counter;
  for (let i = 0; i < 8 && v > 0; i++) {
    nonce[i] = v & 0xff;
    v >>>= 8;
  }
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, ck, plain as BufferSource),
  );
}

async function ssCoalesced(): Promise<{ frame: Uint8Array; plain: Uint8Array }> {
  const keyLen = 16;
  const master = evpBytesToKey(SS_PASSWORD, keyLen);
  const salt = crypto.getRandomValues(new Uint8Array(keyLen));
  const subkey = await hkdfSha1(master, salt, utf8Encode("ss-subkey"), keyLen);
  const inner1 = concatBytes(
    new Uint8Array([3, HOST.length]),
    utf8Encode(HOST),
    u16be(443),
    PAYLOAD,
  );
  const data2 = utf8Encode("second-chunk-body");
  const frame = concatBytes(
    salt,
    await gcmSeal(subkey, 0, u16be(inner1.length)),
    await gcmSeal(subkey, 1, inner1),
    await gcmSeal(subkey, 2, u16be(data2.length)),
    await gcmSeal(subkey, 3, data2),
  );
  return { frame, plain: concatBytes(PAYLOAD, data2) };
}

describe("resolveTcpFirstPacket coalesced handshake+body invariant", () => {
  it("vless passes the coalesced payload through unchanged", async () => {
    const packet = await firstPacketVia(createVlessInbound(VLESS_UUID), vlessCoalesced());
    expect(new TextDecoder().decode(packet)).toBe(new TextDecoder().decode(PAYLOAD));
  });

  it("trojan tcp passes the coalesced payload through unchanged", async () => {
    const packet = await firstPacketVia(createTrojanInbound(TROJAN_PASSWORD), trojanCoalesced());
    expect(new TextDecoder().decode(packet)).toBe(new TextDecoder().decode(PAYLOAD));
  });

  it("vmess drains the coalesced encrypted body instead of stranding it", async () => {
    const { frame, plain } = await vmessCoalesced();
    const packet = await firstPacketVia(createVmessInbound(VMESS_UUID), frame);
    expect(new TextDecoder().decode(packet)).toBe(new TextDecoder().decode(plain));
  });

  it("ss drains the coalesced second chunk and concatenates after the first payload", async () => {
    const { frame, plain } = await ssCoalesced();
    const packet = await firstPacketVia(createSSInbound("aes-128-gcm", SS_PASSWORD), frame);
    expect(new TextDecoder().decode(packet)).toBe(new TextDecoder().decode(plain));
  });

  it("vmess without a coalesced body still yields an empty first packet", async () => {
    const reqIv = new Uint8Array(16).fill(3);
    const reqKey = new Uint8Array(16).fill(5);
    const head = concatBytes(
      new Uint8Array([1]),
      reqIv,
      reqKey,
      new Uint8Array([0x42]),
      new Uint8Array([0x01]),
      new Uint8Array([0x03]),
      new Uint8Array([0]),
      new Uint8Array([1]),
      u16be(443),
      new Uint8Array([2, HOST.length]),
      utf8Encode(HOST),
    );
    const legacy = concatBytes(head, u32be(fnv1a32(head)));
    const cmdKey = deriveCmdKey(hexToBytes(VMESS_UUID.replaceAll("-", ""))!);
    const handshake = await sealVmessAeadHeader(cmdKey, legacy, Math.floor(Date.now() / 1000));
    const packet = await firstPacketVia(createVmessInbound(VMESS_UUID), handshake);
    expect(packet.length).toBe(0);
  });
});
