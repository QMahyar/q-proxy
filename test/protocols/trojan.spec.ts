import { describe, expect, it } from "vitest";
import { createTrojanInbound } from "../../src/protocols/trojan";
import { sha224Hex } from "../../src/crypto/sha224";
import type { BodyCodec } from "../../src/protocols/common";
import { concatBytes, hexToBytes, u16be, utf8Encode } from "../../src/utils/bytes";

const PASSWORD = "secretpassword123";

function trojanFrame(opts: {
  password?: string;
  cmd?: number;
  port?: number;
  atype: number;
  addrBytes: Uint8Array;
  payload?: Uint8Array;
}): Uint8Array {
  const hash = utf8Encode(sha224Hex(opts.password ?? PASSWORD));
  return concatBytes(
    hash,
    new Uint8Array([0x0d, 0x0a]),
    new Uint8Array([opts.cmd ?? 1]),
    opts.atype === 3
      ? concatBytes(new Uint8Array([3, opts.addrBytes.length]), opts.addrBytes)
      : concatBytes(new Uint8Array([opts.atype]), opts.addrBytes),
    u16be(opts.port ?? 443),
    new Uint8Array([0x0d, 0x0a]),
    opts.payload ?? new Uint8Array(0),
  );
}

function udpDatagram(opts: {
  atype: number;
  addrBytes: Uint8Array;
  port?: number;
  payload: Uint8Array;
}): Uint8Array {
  const addr =
    opts.atype === 3
      ? concatBytes(new Uint8Array([3, opts.addrBytes.length]), opts.addrBytes)
      : concatBytes(new Uint8Array([opts.atype]), opts.addrBytes);
  return concatBytes(
    addr,
    u16be(opts.port ?? 53),
    u16be(opts.payload.length),
    new Uint8Array([0x0d, 0x0a]),
    opts.payload,
  );
}

async function udpCodec(): Promise<BodyCodec> {
  const inbound = createTrojanInbound(PASSWORD);
  const outcome = await inbound.push(
    trojanFrame({ cmd: 3, port: 53, atype: 1, addrBytes: hexToBytes("01010101")! }),
  );
  expect(outcome.state).toBe("ready");
  const codec = inbound.bodyCodec();
  expect(codec).not.toBeNull();
  if (!codec) throw new Error("udp body codec missing");
  return codec;
}

function domain(host = "example.com"): Uint8Array {
  return utf8Encode(host);
}

describe("createTrojanInbound", () => {
  it("parses a tcp request with domain target and payload", async () => {
    const inbound = createTrojanInbound(PASSWORD);
    const outcome = await inbound.push(
      trojanFrame({ atype: 3, addrBytes: domain(), payload: utf8Encode("PING") }),
    );
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.parsed.command).toBe("tcp");
    expect(outcome.parsed.target).toEqual({ host: "example.com", port: 443 });
    expect(new TextDecoder().decode(outcome.rest)).toBe("PING");
  });

  it("parses ipv4 and ipv6 targets", async () => {
    const v4 = await createTrojanInbound(PASSWORD).push(
      trojanFrame({ atype: 1, addrBytes: hexToBytes("01020304")!, port: 80 }),
    );
    expect(v4.state).toBe("ready");
    if (v4.state === "ready") expect(v4.parsed.target).toEqual({ host: "1.2.3.4", port: 80 });

    const v6 = await createTrojanInbound(PASSWORD).push(
      trojanFrame({ atype: 4, addrBytes: hexToBytes("26064700470000000000000000000068")!, port: 443 }),
    );
    expect(v6.state).toBe("ready");
    if (v6.state === "ready") expect(v6.parsed.target.host).toBe("2606:4700:4700:0:0:0:0:68");
  });

  it("rejects a wrong password hash (constant-time compare path)", async () => {
    const outcome = await createTrojanInbound(PASSWORD).push(
      trojanFrame({ password: "wrong-password", atype: 3, addrBytes: domain() }),
    );
    expect(outcome.state).toBe("reject");
  });

  it("rejects a malformed auth section missing CRLF", async () => {
    const bad = concatBytes(utf8Encode(sha224Hex(PASSWORD)), new Uint8Array([0x0a, 0x0d]));
    const outcome = await createTrojanInbound(PASSWORD).push(bad);
    expect(outcome).toMatchObject({ state: "reject", reason: expect.stringContaining("CR LF") });
  });

  it("rejects a tcp request missing the mandatory trailing CR LF", async () => {
    const bad = concatBytes(
      utf8Encode(sha224Hex(PASSWORD)),
      new Uint8Array([0x0d, 0x0a, 1]),
      new Uint8Array([3, domain().length]),
      domain(),
      u16be(443),
      utf8Encode("PING"),
    );
    const outcome = await createTrojanInbound(PASSWORD).push(bad);
    expect(outcome).toMatchObject({ state: "reject", reason: "invalid header format (missing CR LF)" });
  });

  it("waits for a truncated trailing CR LF before rejecting", async () => {
    const partial = concatBytes(
      utf8Encode(sha224Hex(PASSWORD)),
      new Uint8Array([0x0d, 0x0a, 1, 1]),
      hexToBytes("01020304")!,
      u16be(443),
    );
    const inbound = createTrojanInbound(PASSWORD);
    expect((await inbound.push(partial)).state).toBe("need-more");
    const outcome = await inbound.push(new Uint8Array([0x00, 0x00]));
    expect(outcome).toMatchObject({ state: "reject", reason: "invalid header format (missing CR LF)" });
  });

  it("allows udp associate only for port 53", async () => {
    const dns = await createTrojanInbound(PASSWORD).push(
      trojanFrame({ cmd: 3, port: 53, atype: 1, addrBytes: hexToBytes("01010101")! }),
    );
    expect(dns.state).toBe("ready");
    if (dns.state === "ready") expect(dns.parsed.command).toBe("udp");

    const blocked = await createTrojanInbound(PASSWORD).push(
      trojanFrame({ cmd: 3, port: 5353, atype: 1, addrBytes: hexToBytes("01010101")! }),
    );
    expect(blocked.state).toBe("reject");
  });

  it("rejects unsupported command bytes", async () => {
    const outcome = await createTrojanInbound(PASSWORD).push(
      trojanFrame({ cmd: 2, atype: 1, addrBytes: hexToBytes("01020304")! }),
    );
    expect(outcome.state).toBe("reject");
  });

  it("returns null response header", () => {
    expect(createTrojanInbound(PASSWORD).responseHeader()).toBeNull();
  });

  it("handles odd chunk splits across push() calls", async () => {
    const frame = trojanFrame({
      atype: 3,
      addrBytes: domain("cf.example.org"),
      port: 2053,
      payload: utf8Encode("0".repeat(128)),
    });
    for (const [first, second] of [
      [1, 13],
      [57, 1],
      [40, 40],
    ]) {
      const a = first!;
      const b = second!;
      const inbound = createTrojanInbound(PASSWORD);
      let outcome = await inbound.push(frame.subarray(0, a));
      let idx = a;
      while (outcome.state === "need-more") {
        outcome = await inbound.push(frame.subarray(idx, idx + b));
        idx += b;
        if (idx > frame.length + 16) break;
      }
      expect(outcome.state).toBe("ready");
      if (outcome.state === "ready") {
        expect(outcome.parsed.target.port).toBe(2053);
        expect(outcome.rest.length).toBeLessThanOrEqual(128);
      }
    }
  });

  it("rejects buffers beyond the 16 KiB handshake cap", async () => {
    const outcome = await createTrojanInbound(PASSWORD).push(new Uint8Array(16385));
    expect(outcome).toMatchObject({ state: "reject", reason: "handshake too large" });
  });
});

describe("trojan udp body codec", () => {
  it("decodes an uplink datagram framed with CR LF and round-trips it back down", async () => {
    const codec = await udpCodec();
    const payload = utf8Encode("query");
    expect(await codec.decodeUp(udpDatagram({ atype: 1, addrBytes: hexToBytes("08080808")!, payload }))).toEqual(
      payload,
    );
    const down = await codec.beginDownlink().encode(utf8Encode("answer"));
    expect(down).toEqual(
      concatBytes(
        new Uint8Array([1, 8, 8, 8, 8]),
        u16be(53),
        u16be(6),
        new Uint8Array([0x0d, 0x0a]),
        utf8Encode("answer"),
      ),
    );
  });

  it("defaults downlink source to ipv4 0.0.0.0:53 before any datagram is seen", async () => {
    const codec = await udpCodec();
    const down = await codec.beginDownlink().encode(utf8Encode("hi"));
    expect(down).toEqual(
      concatBytes(
        new Uint8Array([1, 0, 0, 0, 0]),
        u16be(53),
        u16be(2),
        new Uint8Array([0x0d, 0x0a]),
        utf8Encode("hi"),
      ),
    );
  });

  it("echoes the most recent request address in domain form", async () => {
    const codec = await udpCodec();
    const host = domain("dns.example.org");
    await codec.decodeUp(udpDatagram({ atype: 3, addrBytes: host, payload: utf8Encode("q") }));
    const down = await codec.beginDownlink().encode(utf8Encode("r"));
    expect(down).toEqual(
      concatBytes(
        new Uint8Array([3, host.length]),
        host,
        u16be(53),
        u16be(1),
        new Uint8Array([0x0d, 0x0a]),
        utf8Encode("r"),
      ),
    );
  });

  it("echoes the most recent request address in ipv6 form", async () => {
    const codec = await udpCodec();
    const v6 = hexToBytes("26064700470000000000000000000068")!;
    await codec.decodeUp(udpDatagram({ atype: 4, addrBytes: v6, payload: utf8Encode("q") }));
    const down = await codec.beginDownlink().encode(utf8Encode("r"));
    expect(down).toEqual(
      concatBytes(
        new Uint8Array([4]),
        v6,
        u16be(53),
        u16be(1),
        new Uint8Array([0x0d, 0x0a]),
        utf8Encode("r"),
      ),
    );
  });

  it("parses two pipelined datagrams independently in one chunk", async () => {
    const codec = await udpCodec();
    const first = udpDatagram({ atype: 1, addrBytes: hexToBytes("01020304")!, payload: utf8Encode("one") });
    const secondHost = domain("two.example");
    const second = udpDatagram({ atype: 3, addrBytes: secondHost, payload: utf8Encode("twotwo") });
    expect(await codec.decodeUp(concatBytes(first, second))).toEqual(utf8Encode("onetwotwo"));
    expect(await codec.decodeUp(new Uint8Array(0))).toEqual(new Uint8Array(0));
    const down = codec.beginDownlink();
    const firstFrame = await down.encode(utf8Encode("z"));
    expect(firstFrame).toEqual(
      concatBytes(
        new Uint8Array([1]),
        hexToBytes("01020304")!,
        u16be(53),
        u16be(1),
        new Uint8Array([0x0d, 0x0a]),
        utf8Encode("z"),
      ),
    );
    const secondFrame = await down.encode(utf8Encode("z"));
    expect(secondFrame).toEqual(
      concatBytes(
        new Uint8Array([3, secondHost.length]),
        secondHost,
        u16be(53),
        u16be(1),
        new Uint8Array([0x0d, 0x0a]),
        utf8Encode("z"),
      ),
    );
    const followUp = await down.encode(utf8Encode("z"));
    expect(followUp.subarray(0, 1)).toEqual(new Uint8Array([3]));
  });

  it("drops an oversized merged downlink payload instead of truncating the length", async () => {
    const codec = await udpCodec();
    const first = udpDatagram({ atype: 1, addrBytes: hexToBytes("01020304")!, payload: utf8Encode("one") });
    expect(await codec.decodeUp(first)).toEqual(utf8Encode("one"));
    const down = codec.beginDownlink();
    expect(await down.encode(new Uint8Array(0x10000))).toEqual(new Uint8Array(0));
    const ok = await down.encode(utf8Encode("z"));
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.subarray(0, 1)).toEqual(new Uint8Array([1]));
  });

  it("kills the codec on a datagram with a wrong CR LF", async () => {
    const codec = await udpCodec();
    const bad = concatBytes(
      new Uint8Array([1]),
      hexToBytes("01020304")!,
      u16be(53),
      u16be(4),
      new Uint8Array([0x0a, 0x0d]),
      utf8Encode("junk"),
    );
    expect(await codec.decodeUp(bad)).toBeNull();
    expect(
      await codec.decodeUp(udpDatagram({ atype: 1, addrBytes: hexToBytes("01010101")!, payload: utf8Encode("ok") })),
    ).toBeNull();
  });

  it("buffers a truncated datagram until its CR LF arrives", async () => {
    const codec = await udpCodec();
    const head = concatBytes(new Uint8Array([1]), hexToBytes("01010101")!, u16be(53), u16be(2));
    expect(await codec.decodeUp(head)).toEqual(new Uint8Array(0));
    expect(await codec.decodeUp(concatBytes(new Uint8Array([0x0d, 0x0a]), utf8Encode("hi")))).toEqual(
      utf8Encode("hi"),
    );
  });
});
