import { describe, expect, it } from "vitest";
import { createSSInbound } from "../../src/protocols/shadowsocks";
import { evpBytesToKey, hkdfSha1 } from "../../src/crypto/kdf";
import { parseAddress } from "../../src/protocols/common";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  u16be,
  utf8Encode,
} from "../../src/utils/bytes";

type Method = "aes-128-gcm" | "aes-256-gcm";

function keyLenOf(method: Method): number {
  return method === "aes-128-gcm" ? 16 : 32;
}

function deterministicSalt(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * seed + 3) & 0xff;
  return out;
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

function incrementingNonce(counter: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  let v = counter;
  for (let i = 0; i < 8 && v > 0n; i++) {
    nonce[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return nonce;
}

async function ssFrame(method: Method, password: string, target: Uint8Array, payload: Uint8Array): Promise<Uint8Array> {
  const klen = keyLenOf(method);
  const master = evpBytesToKey(password, klen);
  const salt = deterministicSalt(klen);
  const subkey = await hkdfSha1(master, salt, utf8Encode("ss-subkey"), klen);
  const firstPayload = concatBytes(target, payload);
  const lenFrame = await gcmSeal(subkey, incrementingNonce(0n), u16be(firstPayload.length));
  const payloadFrame = await gcmSeal(subkey, incrementingNonce(1n), firstPayload);
  return concatBytes(salt, lenFrame, payloadFrame);
}

function socksTarget(atype: number, addrBytes: Uint8Array, port: number): Uint8Array {
  if (atype === 3) return concatBytes(new Uint8Array([3, addrBytes.length]), addrBytes, u16be(port));
  return concatBytes(new Uint8Array([atype]), addrBytes, u16be(port));
}

describe("parseAddress (SOCKS5-style numbering shared by trojan/ss)", () => {
  it("parses domain, ipv4 and ipv6 with trailing port", () => {
    const d = parseAddress(3, concatBytes(new Uint8Array([11]), utf8Encode("example.com"), u16be(443)), 0);
    expect(d).toMatchObject({ ok: true });
    if (d.ok) expect(d.value).toEqual({ host: "example.com", port: 443, nextOffset: 14 });

    const v4 = parseAddress(1, concatBytes(hexToBytes("c0000201")!, u16be(80)), 0);
    if (v4.ok) expect(v4.value).toEqual({ host: "192.0.2.1", port: 80, nextOffset: 6 });

    const v6 = parseAddress(4, concatBytes(hexToBytes("20010db8000000000000000000000001")!, u16be(22)), 0);
    if (v6.ok) expect(v6.value).toEqual({ host: "2001:db8:0:0:0:0:0:1", port: 22, nextOffset: 18 });
  });

  it("rejects unknown atype, empty domain, truncated input, port 0", () => {
    expect(parseAddress(9, new Uint8Array(16), 0).ok).toBe(false);
    expect(parseAddress(3, new Uint8Array([0, 0, 0]), 0).ok).toBe(false);
    expect(parseAddress(1, new Uint8Array([1, 2, 3]), 0).ok).toBe(false);
    expect(parseAddress(1, hexToBytes("010101010000")!, 0)).toMatchObject({
      ok: false,
      reason: "invalid port 0",
    });
  });
});

describe.each(["aes-128-gcm", "aes-256-gcm"] as Method[])("createSSInbound %s", (method) => {
  const PASSWORD = "ss-password-test";

  it("derives master keys matching EVP_BytesToKey pins", () => {
    const expected =
      method === "aes-128-gcm"
        ? "ef45feec54459ad88e1c17ae184702d3"
        : "ef45feec54459ad88e1c17ae184702d311167b190feb0674805066ae725443fa";
    expect(bytesToHex(evpBytesToKey("hello-hello", keyLenOf(method)))).toBe(expected);
  });

  it("parses the first chunk and exposes target plus plaintext rest", async () => {
    const inbound = createSSInbound(method, PASSWORD);
    const frame = await ssFrame(
      method,
      PASSWORD,
      socksTarget(3, utf8Encode("www.gstatic.com"), 80),
      utf8Encode("GET /generate_204 HTTP/1.1\r\n\r\n"),
    );
    const outcome = await inbound.push(frame);
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.parsed.command).toBe("tcp");
    expect(outcome.parsed.target).toEqual({ host: "www.gstatic.com", port: 80 });
    expect(new TextDecoder().decode(outcome.rest)).toBe("GET /generate_204 HTTP/1.1\r\n\r\n");
    expect(inbound.responseHeader()).toBeNull();
    expect(inbound.takeInitialPayload()).not.toBeNull();
    expect(inbound.takeInitialPayload()).toBeNull();
  });

  it("supports ipv4 targets", async () => {
    const inbound = createSSInbound(method, PASSWORD);
    const outcome = await inbound.push(
      await ssFrame(method, PASSWORD, socksTarget(1, hexToBytes("1e03d319")!, 443), new Uint8Array(0)),
    );
    expect(outcome.state).toBe("ready");
    if (outcome.state === "ready") expect(outcome.parsed.target).toEqual({ host: "30.3.211.25", port: 443 });
  });

  it("rejects a wrong password via tag failure", async () => {
    const inbound = createSSInbound(method, PASSWORD);
    const frame = await ssFrame(method, "not-the-password", socksTarget(3, utf8Encode("x.com"), 80), new Uint8Array(0));
    const outcome = await inbound.push(frame);
    expect(outcome.state).toBe("reject");
  });

  it("rejects corrupted frames", async () => {
    const frame = await ssFrame(method, PASSWORD, socksTarget(3, utf8Encode("y.com"), 443), utf8Encode("data"));
    frame[frame.length - 1]! ^= 0x01;
    const outcome = await createSSInbound(method, PASSWORD).push(frame);
    expect(outcome.state).toBe("reject");
  });

  it("rejects invalid declared chunk lengths", async () => {
    const klen = keyLenOf(method);
    const master = evpBytesToKey(PASSWORD, klen);
    const subkey = await hkdfSha1(master, deterministicSalt(klen), utf8Encode("ss-subkey"), klen);
    const badLenFrame = await gcmSeal(subkey, incrementingNonce(0n), u16be(0x4000));
    const outcome = await createSSInbound(method, PASSWORD).push(concatBytes(deterministicSalt(klen), badLenFrame));
    expect(outcome).toMatchObject({ state: "reject", reason: expect.stringContaining("chunk length") });
  });

  it("reassembles salt and frames split across many push() calls", async () => {
    const frame = await ssFrame(
      method,
      PASSWORD,
      socksTarget(3, utf8Encode("split.example.org"), 2053),
      utf8Encode("Z".repeat(100)),
    );
    const inbound = createSSInbound(method, PASSWORD);
    let outcome = await inbound.push(frame.subarray(0, 3));
    let idx = 3;
    while (outcome.state === "need-more" && idx < frame.length) {
      const step = Math.min(5, frame.length - idx);
      outcome = await inbound.push(frame.subarray(idx, idx + step));
      idx += step;
      if (outcome.state === "need-more" && idx > frame.length + 64) break;
    }
    expect(outcome.state).toBe("ready");
    if (outcome.state === "ready") {
      expect(outcome.parsed.target).toEqual({ host: "split.example.org", port: 2053 });
      expect(outcome.rest.length).toBe(100);
    }
  });

  it("rejects buffers beyond the 16 KiB handshake cap", async () => {
    const outcome = await createSSInbound(method, PASSWORD).push(new Uint8Array(16385));
    expect(outcome).toMatchObject({ state: "reject", reason: "handshake too large" });
  });
});

describe.each(["aes-128-gcm", "aes-256-gcm"] as Method[])("ss body codecs %s", (method) => {
  const PASSWORD = "ss-password-test";

  function keyLen(): number {
    return keyLenOf(method);
  }

  async function subkeyFor(salt: Uint8Array): Promise<Uint8Array> {
    return hkdfSha1(evpBytesToKey(PASSWORD, keyLen()), salt, utf8Encode("ss-subkey"), keyLen());
  }

  async function framePair(
    sk: Uint8Array,
    counter: number,
    payload: Uint8Array,
  ): Promise<Uint8Array> {
    const lenFrame = await gcmSeal(sk, incrementingNonce(BigInt(counter)), u16be(payload.length));
    const payloadFrame = await gcmSeal(sk, incrementingNonce(BigInt(counter + 1)), payload);
    return concatBytes(lenFrame, payloadFrame);
  }

  async function openFramesFrom(
    sk: Uint8Array,
    wire: Uint8Array,
  ): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    let ctr = 0;
    let off = 0;
    while (off < wire.length) {
      const lenPlain = await gcmOpen(sk, incrementingNonce(BigInt(ctr++)), wire.subarray(off, off + 18));
      expect(lenPlain).not.toBeNull();
      const n = ((lenPlain![0] ?? 0) << 8) | (lenPlain![1] ?? 0);
      off += 18;
      const payload = await gcmOpen(sk, incrementingNonce(BigInt(ctr++)), wire.subarray(off, off + n + 16));
      off += n + 16;
      out.push(payload!);
    }
    return out;
  }

  async function gcmOpen(
    sk: Uint8Array,
    nonce: Uint8Array,
    data: Uint8Array,
  ): Promise<Uint8Array | null> {
    try {
      const ck = await crypto.subtle.importKey("raw", sk as BufferSource, "AES-GCM", false, [
        "decrypt",
      ]);
      return new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, ck, data as BufferSource),
      );
    } catch {
      return null;
    }
  }

  async function handshakenInbound(): Promise<ReturnType<typeof createSSInbound>> {
    const inbound = createSSInbound(method, PASSWORD);
    const outcome = await inbound.push(await ssFrame(method, PASSWORD, socksTarget(3, utf8Encode("body.example.com"), 443), new Uint8Array(0)));
    expect(outcome.state).toBe("ready");
    return inbound;
  }

  it("decodes uplink body frames continuing the shared nonce counter", async () => {
    const salt = deterministicSalt(keyLen());
    const master = evpBytesToKey(PASSWORD, keyLen());
    const sk = await hkdfSha1(master, salt, utf8Encode("ss-subkey"), keyLen());
    const target = socksTarget(3, utf8Encode("up.example.com"), 80);
    const body1 = utf8Encode("GET / HTTP/1.1\r\nHost: a\r\n\r");
    const body2 = utf8Encode("\nX: tail");
    const wire = concatBytes(
      await ssFrame(method, PASSWORD, target, new Uint8Array(0)),
      await framePair(sk, 2, body1),
      await framePair(sk, 4, body2),
    );
    const inbound = createSSInbound(method, PASSWORD);
    const outcome = await inbound.push(wire);
    expect(outcome.state).toBe("ready");

    const codec = inbound.bodyCodec();
    expect(codec).not.toBeNull();
    const first = await codec!.decodeUp(new Uint8Array(0));
    expect(new TextDecoder().decode(first!)).toBe(
      "GET / HTTP/1.1\r\nHost: a\r\n\r\nX: tail",
    );
    const body3 = utf8Encode("third-chunk");
    const rest = await codec!.decodeUp(await framePair(sk, 6, body3));
    expect(new TextDecoder().decode(rest!)).toBe("third-chunk");
  });

  it("rejects-by-null on oversize, zero-length and corrupted body frames", async () => {
    const inbound = await handshakenInbound();
    const codec = inbound.bodyCodec()!;
    const sk = await subkeyFor(deterministicSalt(keyLen()));

    const oversize = await gcmSeal(sk, incrementingNonce(2n), u16be(0x4000));
    expect(await codec.decodeUp(concatBytes(oversize, new Uint8Array(40)))).toBeNull();

    const zeroLen = await gcmSeal(sk, incrementingNonce(2n), u16be(0));
    const inbound2 = (await handshakenInbound()).bodyCodec()!;
    expect(await inbound2.decodeUp(zeroLen)).toBeNull();

    const good = await framePair(sk, 2, utf8Encode("hello"));
    good[good.length - 1]! ^= 0xff;
    const inbound3 = (await handshakenInbound()).bodyCodec()!;
    expect(await inbound3.decodeUp(good)).toBeNull();
  });

  it("downlink encoder produces fresh-salt frames decodable by an independent opener", async () => {
    const inbound = await handshakenInbound();
    const encoder = inbound.bodyCodec()!.beginDownlink();
    const salt = encoder.header();
    expect(salt).not.toBeNull();
    expect(salt!.length).toBe(keyLen());

    const a = utf8Encode("HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\n");
    const b = utf8Encode("resp-body");
    const w1 = await encoder.encode(a);
    const w2 = await encoder.encode(b);

    const sk = await subkeyFor(salt!);
    const opened = await openFramesFrom(sk, concatBytes(w1, w2));
    expect(opened.length).toBe(2);
    expect(new TextDecoder().decode(concatBytes(opened[0]!, opened[1]!))).toBe(
      "HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nresp-body",
    );
  });

  it("downlink encoder keeps its nonce counter continuous across encode calls", async () => {
    const inbound = await handshakenInbound();
    const encoder = inbound.bodyCodec()!.beginDownlink();
    const salt = encoder.header()!;
    const sk = await subkeyFor(salt);

    const pieces = [utf8Encode("one"), utf8Encode("tw"), utf8Encode("three333")];
    let wire: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < pieces.length; i++) {
      wire = concatBytes(wire, await encoder.encode(pieces[i]!));
      const opened = await openFramesFrom(sk, wire);
      expect(opened.length).toBe(i + 1);
      expect(Array.from(opened[i]!)).toEqual(Array.from(pieces[i]!));
    }
  });

  it("splits downlink inputs larger than 0x3FFF into capped frames", async () => {
    const inbound = await handshakenInbound();
    const encoder = inbound.bodyCodec()!.beginDownlink();
    const big = new Uint8Array(40000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
    const wire = await encoder.encode(big);

    const sk = await subkeyFor(encoder.header()!);
    const opened = await openFramesFrom(sk, wire);
    expect(opened.length).toBe(3);
    expect(opened[0]!.length).toBe(0x3fff);
    expect(opened[1]!.length).toBe(0x3fff);
    expect(opened[2]!.length).toBe(40000 - 2 * 0x3fff);
    expect(Array.from(concatBytes(...opened))).toEqual(Array.from(big));
  });
});


