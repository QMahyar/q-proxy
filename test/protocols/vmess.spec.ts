import { describe, expect, it, beforeEach } from "vitest";
import { clearVmessReplayCache, createVmessInbound } from "../../src/protocols/vmess";
import {
  createAuthId,
  crc32,
  deriveAuthIdEncryptionKey,
  deriveCmdKey,
  fnv1a32,
  openVmessAeadHeader,
  sealVmessAeadHeader,
} from "../../src/protocols/vmess-crypto";
import { vmessKdf, vmessKdf16 } from "../../src/crypto/kdf";
import { chacha20Poly1305Seal } from "../../src/crypto/chacha20";
import { Shake128 } from "../../src/crypto/shake128";
import { md5 } from "../../src/crypto/md5";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  readU16BE,
  u16be,
  utf8Encode,
} from "../../src/utils/bytes";
import { randomBytes } from "../../src/utils/random";

const UUID = "1386f85e-657b-4d6e-9d56-78badb75e1fd";
const CMD_KEY = deriveCmdKey(hexToBytes(UUID.replaceAll("-", ""))!);

function legacyHeader(opts: {
  requestIv?: Uint8Array;
  requestKey?: Uint8Array;
  responseV?: number;
  option?: number;
  paddingLen?: number;
  security?: number;
  command?: number;
  port?: number;
  atype?: number;
  addr?: Uint8Array;
}): Uint8Array {
  const addr = opts.addr ?? utf8Encode("example.com");
  const atype = opts.atype ?? 2;
  const paddingLen = opts.paddingLen ?? 0;
  const head = concatBytes(
    new Uint8Array([1]),
    opts.requestIv ?? randomOf(16),
    opts.requestKey ?? randomOf(16),
    new Uint8Array([opts.responseV ?? 0x42]),
    new Uint8Array([opts.option ?? 0x03]),
    new Uint8Array([((paddingLen & 0xf) << 4) | (opts.security ?? 4)]),
    new Uint8Array([0]),
    new Uint8Array([opts.command ?? 1]),
    u16be(opts.port ?? 443),
    new Uint8Array([atype]),
    atype === 2 ? concatBytes(new Uint8Array([addr.length]), addr) : addr,
    randomOf(paddingLen),
  );
  return concatBytes(head, u32be(fnv1a32(head)));
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

let counter = 0;
function randomOf(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (counter++ * 31 + 7) & 0xff;
  return out;
}

async function sealedRequestFrame(
  header: Uint8Array,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Uint8Array> {
  return sealVmessAeadHeader(CMD_KEY, header, nowSeconds);
}

describe("vmess checksums", () => {
  it("crc32 matches known IEEE values", () => {
    expect(bytesToHex(u32be(crc32(utf8Encode("123456789"))))).toBe("cbf43926");
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("fnv1a32 matches known values", () => {
    expect(fnv1a32(new Uint8Array(0))).toBe(0x811c9dc5);
    expect(fnv1a32(utf8Encode("a"))).toBe(0xe40c292c);
    expect(fnv1a32(utf8Encode("foobar"))).toBe(0xbf9cf968);
  });
});

describe("vmess auth id", () => {
  it("round-trips create/check within the time window", async () => {
    const key = await deriveAuthIdEncryptionKey(CMD_KEY);
    const now = Math.floor(Date.now() / 1000);
    const authId = createAuthId(key, now);
    expect(authId.length).toBe(16);
  });

  it("rejects an auth id outside the ±120 s window", async () => {
    const inbound = createVmessInbound(UUID);
    const stale = await sealVmessAeadHeader(CMD_KEY, legacyHeader({}), Math.floor(Date.now() / 1000) - 121);
    const outcome = await inbound.push(stale);
    expect(outcome).toMatchObject({
      state: "reject",
      reason: expect.stringContaining("auth id"),
    });
  });
});

describe("createVmessInbound", () => {
  beforeEach(() => clearVmessReplayCache());

  it("parses a valid AEAD tcp request", async () => {
    const inbound = createVmessInbound(UUID);
    const frame = await sealedRequestFrame(
      legacyHeader({ addr: utf8Encode("www.example.com"), port: 8443 }),
    );
    const outcome = await inbound.push(frame);
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.parsed.command).toBe("tcp");
    expect(outcome.parsed.target).toEqual({ host: "www.example.com", port: 8443 });
  });

  it("parses ipv4 and ipv6 targets", async () => {
    const v4 = await createVmessInbound(UUID).push(
      await sealedRequestFrame(legacyHeader({ atype: 1, addr: hexToBytes("01010101")! })),
    );
    expect(v4.state).toBe("ready");
    if (v4.state === "ready") expect(v4.parsed.target.host).toBe("1.1.1.1");

    const v6 = await createVmessInbound(UUID).push(
      await sealedRequestFrame(
        legacyHeader({ atype: 3, addr: hexToBytes("26060700000000000000000000000068")! }),
      ),
    );
    expect(v6.state).toBe("ready");
    if (v6.state === "ready") expect(v6.parsed.target.host).toBe("2606:700:0:0:0:0:0:68");
  });

  it("handles padding in the legacy header", async () => {
    const outcome = await createVmessInbound(UUID).push(
      await sealedRequestFrame(legacyHeader({ paddingLen: 7, option: 0x07 })),
    );
    expect(outcome.state).toBe("ready");
  });

  it("allows udp only to port 53 and rejects other udp ports", async () => {
    const dns = await createVmessInbound(UUID).push(
      await sealedRequestFrame(legacyHeader({ command: 2, port: 53, atype: 1, addr: hexToBytes("08080808")! })),
    );
    expect(dns.state).toBe("ready");
    if (dns.state === "ready") expect(dns.parsed.command).toBe("udp");

    const blocked = await createVmessInbound(UUID).push(
      await sealedRequestFrame(legacyHeader({ command: 2, port: 443, atype: 1, addr: hexToBytes("08080808")! })),
    );
    expect(blocked).toMatchObject({ state: "reject" });
  });

  it("rejects mux and unknown commands", async () => {
    const mux = await createVmessInbound(UUID).push(await sealedRequestFrame(legacyHeader({ command: 3 })));
    expect(mux.state).toBe("reject");

    const unknown = await createVmessInbound(UUID).push(await sealedRequestFrame(legacyHeader({ command: 9 })));
    expect(unknown.state).toBe("reject");
  });

  it("rejects the unknown security type but tolerates auto like reference workers", async () => {
    const unknown = await createVmessInbound(UUID).push(
      await sealedRequestFrame(legacyHeader({ security: 0 })),
    );
    expect(unknown).toMatchObject({ state: "reject", reason: expect.stringContaining("security") });

    const auto = await createVmessInbound(UUID).push(
      await sealedRequestFrame(legacyHeader({ security: 3 })),
    );
    expect(auto.state).toBe("ready");
  });

  it("rejects legacy security=1 instead of relaying under aes-cfb", async () => {
    const outcome = await createVmessInbound(UUID).push(
      await sealedRequestFrame(legacyHeader({ security: 1 })),
    );
    expect(outcome).toMatchObject({
      state: "reject",
      reason: "legacy security requires aes-cfb which is disabled",
    });
  });

  it("rejects a wrong uuid", async () => {
    const inbound = createVmessInbound("b831381d-6324-4d53-ad4f-8cda48b30811");
    const outcome = await inbound.push(await sealedRequestFrame(legacyHeader({})));
    expect(outcome).toMatchObject({ state: "reject", reason: expect.stringContaining("auth id") });
  });

  it("rejects a corrupted AEAD frame", async () => {
    const frame = await sealedRequestFrame(legacyHeader({}));
    frame[frame.length - 1]! ^= 0xff;
    const outcome = await createVmessInbound(UUID).push(frame);
    expect(outcome).toMatchObject({ state: "reject" });
  });

  it("rejects a tampered fnv1a checksum", async () => {
    const good = await sealVmessAeadHeader(CMD_KEY, legacyHeader({}), Math.floor(Date.now() / 1000));
    const opened = await openVmessAeadHeader(
      CMD_KEY,
      good.subarray(0, 16),
      good.subarray(16),
    );
    if (!opened.header) throw new Error("test setup failed");
    opened.header[opened.header.length - 1]! ^= 0xff;
    const badFrame = await sealVmessAeadHeader(
      CMD_KEY,
      opened.header,
      Math.floor(Date.now() / 1000),
    );
    const outcome = await createVmessInbound(UUID).push(badFrame);
    expect(outcome).toMatchObject({ state: "reject", reason: expect.stringContaining("checksum") });
  });

  it("rejects a replayed handshake carrying identical sealed header bytes", async () => {
    const frame = await sealedRequestFrame(legacyHeader({}));
    const first = await createVmessInbound(UUID).push(frame);
    expect(first.state).toBe("ready");

    const second = await createVmessInbound(UUID).push(frame);
    expect(second).toMatchObject({ state: "reject", reason: "replayed handshake" });
  });

  it("accepts distinct handshakes with different rand and time", async () => {
    const now = Math.floor(Date.now() / 1000);
    const a = await createVmessInbound(UUID).push(
      await sealVmessAeadHeader(CMD_KEY, legacyHeader({}), now),
    );
    const b = await createVmessInbound(UUID).push(
      await sealVmessAeadHeader(CMD_KEY, legacyHeader({}), now - 30),
    );
    expect(a.state).toBe("ready");
    expect(b.state).toBe("ready");
  });

  it("does not burn the auth id when full header validation fails", async () => {
    const frame = await sealVmessAeadHeader(
      CMD_KEY,
      legacyHeader({ command: 3 }),
      Math.floor(Date.now() / 1000),
    );
    const rejected = await createVmessInbound(UUID).push(frame);
    expect(rejected.state).toBe("reject");
    const retried = await createVmessInbound(UUID).push(frame);
    expect(retried.state).toBe("reject");
    expect((retried as { reason?: string }).reason).not.toBe("replayed handshake");
  });

  it("seals a response header the client can open per spec", async () => {
    const inbound = createVmessInbound(UUID);
    const requestIv = randomOf(16);
    const requestKey = randomOf(16);
    const responseV = 0x77;
    const frame = await sealedRequestFrame(
      legacyHeader({ requestIv, requestKey, responseV }),
    );
    const outcome = await inbound.push(frame);
    expect(outcome.state).toBe("ready");

    const resp = inbound.responseHeader();
    expect(resp).not.toBeNull();
    expect(resp!.length).toBe(38);

    const respBodyKey = hexToBytes(
      bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", requestKey as BufferSource))).slice(0, 32),
    )!;
    const respBodyIv = hexToBytes(
      bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", requestIv as BufferSource))).slice(0, 32),
    )!;

    const lenKey = await vmessKdf16(respBodyKey, "AEAD Resp Header Len Key");
    const lenIv = (await vmessKdf(respBodyIv, "AEAD Resp Header Len IV")).subarray(0, 12).slice();
    const lenPlain = await gcmOpen(lenKey, lenIv, resp!.subarray(0, 18));
    expect(lenPlain).not.toBeNull();
    const payloadLen = readU16BE(lenPlain!, 0);
    expect(payloadLen).toBe(4);

    const payloadKey = await vmessKdf16(respBodyKey, "AEAD Resp Header Key");
    const payloadIv = (await vmessKdf(respBodyIv, "AEAD Resp Header IV")).subarray(0, 12).slice();
    const payloadPlain = await gcmOpen(payloadKey, payloadIv, resp!.subarray(18));
    expect(payloadPlain).not.toBeNull();
    expect(Array.from(payloadPlain!)).toEqual([responseV, 0x00, 0x00, 0x00]);
  });

  it("reassembles frames delivered byte-by-byte across push() calls", async () => {
    const frame = await sealedRequestFrame(
      legacyHeader({ addr: utf8Encode("chunked.example.net"), port: 2053 }),
    );
    const inbound = createVmessInbound(UUID);
    let outcome = await inbound.push(frame.subarray(0, 5));
    let idx = 5;
    while (outcome.state === "need-more" && idx < frame.length) {
      outcome = await inbound.push(frame.subarray(idx, idx + 11));
      idx += 11;
    }
    expect(outcome.state).toBe("ready");
    if (outcome.state === "ready") {
      expect(outcome.parsed.target).toEqual({ host: "chunked.example.net", port: 2053 });
    }
    expect(inbound.responseHeader()).not.toBeNull();
  });

  it("rejects buffers beyond the 16 KiB handshake cap", async () => {
    const outcome = await createVmessInbound(UUID).push(new Uint8Array(16385));
    expect(outcome).toMatchObject({ state: "reject", reason: "handshake too large" });
  });

  async function gcmOpen(
    key: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array,
  ): Promise<Uint8Array | null> {
    try {
      const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [
        "decrypt",
      ]);
      return new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, ck, data as BufferSource),
      );
    } catch {
      return null;
    }
  }
});

const OPT_CHUNK_STREAM = 0x01;
const OPT_CHUNK_MASKING = 0x04;
const OPT_GLOBAL_PADDING = 0x08;
const OPT_AUTHENTICATED_LENGTH = 0x10;

type BodyMode = "aes" | "chacha" | "plain";

function modeOf(security: number): BodyMode {
  if (security === 2 || security === 3) return "aes";
  if (security === 4) return "chacha";
  return "plain";
}

function chunkNonce(iv16: Uint8Array, counter: number): Uint8Array {
  const n = u16be(counter & 0xffff);
  return concatBytes(n, iv16.subarray(2, 12));
}

function doubleMd5(b16: Uint8Array): Uint8Array {
  const first = md5(b16);
  return concatBytes(first, md5(first));
}

async function aesSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, ck, plaintext as BufferSource),
  );
}

interface BodyParams {
  security: number;
  option: number;
  reqKey: Uint8Array;
  reqIv: Uint8Array;
}

function makeDraw(seed: Uint8Array): () => number {
  const shake = new Shake128(seed);
  const scratch = new Uint8Array(2);
  return () => {
    shake.squeezeInto(scratch, 0, 2);
    return readU16BE(scratch, 0);
  };
}

async function lenKeysFor(p: BodyParams): Promise<{ key: Uint8Array; base: Uint8Array }> {
  const kdfKey = (await vmessKdf16(p.reqKey, "auth_len")).slice();
  const mode = modeOf(p.security);
  return { key: mode === "chacha" ? doubleMd5(kdfKey) : kdfKey, base: p.reqIv };
}

async function clientEncodeChunks(p: BodyParams, chunks: Uint8Array[]): Promise<Uint8Array> {
  const mode = modeOf(p.security);
  const framed = (p.option & OPT_CHUNK_STREAM) !== 0 || mode !== "plain";
  if (!framed) return concatBytes(...chunks);
  const masked = (p.option & OPT_CHUNK_MASKING) !== 0 && (p.option & OPT_AUTHENTICATED_LENGTH) === 0;
  const padded = (p.option & OPT_GLOBAL_PADDING) !== 0;
  const authLen = (p.option & OPT_AUTHENTICATED_LENGTH) !== 0 && mode !== "plain";
  const draw = masked || padded ? makeDraw(p.reqIv) : null;
  const tagLen = mode === "plain" ? 0 : 16;
  const bodyKey =
    mode === "aes" ? p.reqKey : mode === "chacha" ? doubleMd5(p.reqKey) : new Uint8Array(0);
  const lk = authLen ? await lenKeysFor(p) : null;
  let payloadCtr = 0;
  let sizeCtr = 0;
  const parts: Uint8Array[] = [];
  for (const chunk of chunks) {
    let padding = 0;
    if (draw !== null && padded) padding = draw() % 64;
    const sizeVal = chunk.length + tagLen + padding;
    if (lk !== null) {
      parts.push(await aesSeal(lk.key, chunkNonce(lk.base, sizeCtr++), u16be(sizeVal - 16)));
    } else {
      let v = sizeVal;
      if (draw !== null && masked) v ^= draw();
      parts.push(u16be(v));
    }
    if (mode === "aes") {
      parts.push(await aesSeal(bodyKey, chunkNonce(p.reqIv, payloadCtr++), chunk));
    } else if (mode === "chacha") {
      parts.push(chacha20Poly1305Seal(bodyKey, chunkNonce(p.reqIv, payloadCtr++), chunk, null));
    } else {
      parts.push(chunk.slice());
    }
    if (padding > 0) parts.push(randomBytes(padding));
  }
  return concatBytes(...parts);
}

async function openResponseChunks(
  p: BodyParams,
  wire: Uint8Array,
): Promise<Uint8Array[]> {
  const mode = modeOf(p.security);
  const framed = (p.option & OPT_CHUNK_STREAM) !== 0 || mode !== "plain";
  if (!framed) return [wire];
  const masked = (p.option & OPT_CHUNK_MASKING) !== 0 && (p.option & OPT_AUTHENTICATED_LENGTH) === 0;
  const padded = (p.option & OPT_GLOBAL_PADDING) !== 0;
  const authLen = (p.option & OPT_AUTHENTICATED_LENGTH) !== 0 && mode !== "plain";
  const draw = masked || padded ? makeDraw(await sha256First16(p.reqIv)) : null;
  const tagLen = mode === "plain" ? 0 : 16;
  const respKey = await sha256First16(p.reqKey);
  const respIv = await sha256First16(p.reqIv);
  const bodyKey = mode === "aes" ? respKey : mode === "chacha" ? doubleMd5(respKey) : new Uint8Array(0);
  const lk = authLen ? { key: await respLenKey(p), base: p.reqIv } : null;
  let payloadCtr = 0;
  let sizeCtr = 0;
  let off = 0;
  const out: Uint8Array[] = [];
  while (off < wire.length) {
    let padding = 0;
    if (draw !== null && padded) padding = draw() % 64;
    let sizeVal: number;
    if (lk !== null) {
      const plain = await gcmSealOpen(lk.key, chunkNonce(lk.base, sizeCtr++), wire.subarray(off, off + 18));
      expect(plain).not.toBeNull();
      sizeVal = readU16BE(plain!, 0) + 16;
      off += 18;
    } else {
      sizeVal = readU16BE(wire, off);
      if (draw !== null && masked) sizeVal ^= draw();
      off += 2;
    }
    const dataLen = sizeVal - tagLen - padding;
    if (dataLen === 0) break;
    const ct = wire.subarray(off, off + dataLen + tagLen);
    off += dataLen + tagLen + padding;
    if (mode === "aes") {
      out.push((await gcmSealOpen(bodyKey, chunkNonce(respIv, payloadCtr++), ct))!);
    } else if (mode === "chacha") {
      const sealed = ct;
      const opened = await import("../../src/crypto/chacha20").then((m) =>
        m.chacha20Poly1305Open(bodyKey, chunkNonce(respIv, payloadCtr++), sealed, null),
      );
      out.push(opened!);
    } else {
      out.push(ct.slice());
      void payloadCtr++;
    }
  }
  return out;
}

async function sha256First16(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return new Uint8Array(digest).subarray(0, 16).slice();
}

async function respLenKey(p: BodyParams): Promise<Uint8Array> {
  const kdfKey = (await vmessKdf16(p.reqKey, "auth_len")).slice();
  return modeOf(p.security) === "chacha" ? doubleMd5(kdfKey) : kdfKey;
}

async function gcmSealOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const ck = await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, ck, data as BufferSource),
    );
  } catch {
    return null;
  }
}

describe("vmess body codecs", () => {
  beforeEach(() => clearVmessReplayCache());

  const CASES: Array<[number, number]> = [
    [3, 0x05],
    [3, 0x01],
    [3, 0x15],
    [3, 0x11],
    [3, 0x0d],
    [2, 0x05],
    [4, 0x05],
    [4, 0x01],
    [4, 0x15],
    [4, 0x11],
    [4, 0x0d],
    [5, 0x05],
    [5, 0x01],
    [6, 0x05],
    [6, 0x01],
    [6, 0x00],
    [5, 0x00],
  ];

  async function readyInbound(security: number, option: number) {
    const inbound = createVmessInbound(UUID);
    const reqIv = randomBytes(16);
    const reqKey = randomBytes(16);
    const outcome = await inbound.push(
      await sealVmessAeadHeader(CMD_KEY, legacyHeader({ requestIv: reqIv, requestKey: reqKey, security, option }), Math.floor(Date.now() / 1000)),
    );
    expect(outcome.state).toBe("ready");
    return { inbound, p: { security, option, reqKey, reqIv } satisfies BodyParams };
  }

  it.each(CASES)("round-trips uplink and downlink bodies for security %i option %#02x", async (security, option) => {
    const { inbound, p } = await readyInbound(security, option);
    const codec = inbound.bodyCodec();
    expect(codec).not.toBeNull();

    const chunks = [utf8Encode("first-uplink-chunk"), utf8Encode("|second|"), utf8Encode("third!")];
    const wire = await clientEncodeChunks(p, chunks);
    const r1 = await codec!.decodeUp(wire.subarray(0, Math.min(wire.length, 40)));
    const r2 = await codec!.decodeUp(wire.subarray(Math.min(wire.length, 40)));
    expect(new TextDecoder().decode(concatBytes(r1 ?? new Uint8Array(0), r2 ?? new Uint8Array(0)))).toBe(
      "first-uplink-chunk|second|third!",
    );

    const downlink = codec!.beginDownlink();
    expect(downlink.header()).toBeNull();
    const payload = utf8Encode("HTTP/1.1 200 OK\r\n\r\nbody-payload");
    const encoded = await downlink.encode(payload);
    const opened = await openResponseChunks(p, encoded);
    expect(new TextDecoder().decode(concatBytes(...opened))).toBe(
      "HTTP/1.1 200 OK\r\n\r\nbody-payload",
    );
  });

  it("feeds uplink frames byte-by-byte without losing a byte (aes + masking)", async () => {
    const { inbound, p } = await readyInbound(3, 0x05);
    const codec = inbound.bodyCodec()!;
    const chunks = [utf8Encode("A".repeat(50)), utf8Encode("B".repeat(30))];
    const wire = await clientEncodeChunks(p, chunks);
    let acc = "";
    for (let i = 0; i < wire.length; i += 7) {
      const part = await codec.decodeUp(wire.subarray(i, Math.min(i + 7, wire.length)));
      acc += new TextDecoder().decode(part ?? new Uint8Array(0));
    }
    expect(acc).toBe("A".repeat(50) + "B".repeat(30));
  });

  it("keeps payload nonce counters continuous across decodeUp calls", async () => {
    const { inbound, p } = await readyInbound(3, 0x05);
    const codec = inbound.bodyCodec()!;
    const c1 = utf8Encode("counter-zero");
    const c2 = utf8Encode("counter-one");

    const draw = makeDraw(p.reqIv);
    const m1 = draw();
    const f1len = u16be((c1.length + 16) ^ m1);
    const f1pay = await aesSeal(p.reqKey, chunkNonce(p.reqIv, 0), c1);
    const m2 = draw();
    const f2len = u16be((c2.length + 16) ^ m2);
    const f2pay = await aesSeal(p.reqKey, chunkNonce(p.reqIv, 1), c2);

    expect(new TextDecoder().decode((await codec.decodeUp(concatBytes(f1len, f1pay)))!)).toBe(
      "counter-zero",
    );
    expect(new TextDecoder().decode((await codec.decodeUp(concatBytes(f2len, f2pay)))!)).toBe(
      "counter-one",
    );

    const m3 = draw();
    const oversizeLen = u16be(0xffff ^ m3);
    const badPay = await aesSeal(p.reqKey, chunkNonce(p.reqIv, 1), utf8Encode("replayed"));
    expect(await codec.decodeUp(concatBytes(oversizeLen, badPay))).toBeNull();
    expect(await codec.decodeUp(utf8Encode("anything after poison"))).toBeNull();
  });

  it("treats the zero-length chunk as end-of-stream after yielding prior data", async () => {
    const { inbound, p } = await readyInbound(3, 0x05);
    const codec = inbound.bodyCodec()!;
    const data = utf8Encode("before-eof");
    const wire = await clientEncodeChunks(p, [data, new Uint8Array(0)]);
    const got = await codec.decodeUp(wire);
    expect(new TextDecoder().decode(got!)).toBe("before-eof");
    expect(await codec.decodeUp(utf8Encode("after-eof"))).toBeNull();
  });

  it("relays raw bytes in both directions for unframed none/zero security", async () => {
    const { inbound } = await readyInbound(6, 0x00);
    const codec = inbound.bodyCodec()!;
    const raw = utf8Encode("raw-plaintext-body");
    expect(new TextDecoder().decode((await codec.decodeUp(raw))!)).toBe("raw-plaintext-body");
    const enc = codec.beginDownlink();
    expect(enc.header()).toBeNull();
    expect(new TextDecoder().decode(await enc.encode(raw))).toBe("raw-plaintext-body");
  });

  it("carries leftover post-header bytes into the uplink decoder", async () => {
    const inbound = createVmessInbound(UUID);
    const reqIv = randomBytes(16);
    const reqKey = randomBytes(16);
    const p: BodyParams = { security: 3, option: 0x05, reqKey, reqIv };
    const headerWire = await sealVmessAeadHeader(
      CMD_KEY,
      legacyHeader({ requestIv: reqIv, requestKey: reqKey, security: 3, option: 0x05 }),
      Math.floor(Date.now() / 1000),
    );
    const firstChunk = utf8Encode("pipelined-after-header");
    const outcome = await inbound.push(
      concatBytes(headerWire, await clientEncodeChunks(p, [firstChunk])),
    );
    expect(outcome.state).toBe("ready");
    const codec = inbound.bodyCodec()!;
    const got = await codec.decodeUp(new Uint8Array(0));
    expect(new TextDecoder().decode(got!)).toBe("pipelined-after-header");
  });

  it("carries pipelined post-header bytes for unframed none/zero security", async () => {
    const inbound = createVmessInbound(UUID);
    const reqIv = randomBytes(16);
    const reqKey = randomBytes(16);
    const headerWire = await sealVmessAeadHeader(
      CMD_KEY,
      legacyHeader({ requestIv: reqIv, requestKey: reqKey, security: 6, option: 0x00 }),
      Math.floor(Date.now() / 1000),
    );
    const pipelined = utf8Encode("unframed-pipelined-body");
    const outcome = await inbound.push(concatBytes(headerWire, pipelined));
    expect(outcome.state).toBe("ready");
    const codec = inbound.bodyCodec()!;
    const got = await codec.decodeUp(new Uint8Array(0));
    expect(new TextDecoder().decode(got!)).toBe("unframed-pipelined-body");
  });

  it("strips global-padding bytes appended by the client", async () => {
    const { inbound, p } = await readyInbound(3, 0x0d);
    const codec = inbound.bodyCodec()!;
    const chunks = [utf8Encode("padded-one"), utf8Encode("padded-two")];
    const wire = await clientEncodeChunks(p, chunks);
    const got = await codec.decodeUp(wire);
    expect(new TextDecoder().decode(got!)).toBe("padded-onepadded-two");
  });

  it("returns no body codec for unknown security 7 but keeps the handshake", async () => {
    const { inbound } = await readyInbound(7, 0x05);
    expect(inbound.bodyCodec()).toBeNull();
  });

  it("hands out the body codec exactly once per connection", async () => {
    const { inbound } = await readyInbound(3, 0x05);
    const first = inbound.bodyCodec();
    expect(first).not.toBeNull();
    expect(inbound.bodyCodec()).toBeNull();
    expect(inbound.bodyCodec()).toBeNull();
  });

  it("downlink encoder splits large payloads at the frame cap with continuous counters (aes+mask)", async () => {
    const { inbound, p } = await readyInbound(3, 0x15);
    const codec = inbound.bodyCodec()!;
    const enc = codec.beginDownlink();
    const big = new Uint8Array(30000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 17) & 0xff;
    const wire = await enc.encode(big);
    const opened = await openResponseChunks(p, wire);
    expect(Array.from(concatBytes(...opened))).toEqual(Array.from(big));
  });
});



