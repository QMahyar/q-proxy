import { describe, expect, it } from "vitest";
import { createVlessInbound } from "../../src/protocols/vless";
import { concatBytes, u16be, utf8Encode } from "../../src/utils/bytes";

const UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";
const UUID_BYTES = hexToBytes(UUID.replaceAll("-", ""))!;

function hexToBytes(hex: string): Uint8Array | null {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function domainFrame(opts: {
  uuid?: Uint8Array;
  version?: number;
  addons?: Uint8Array;
  cmd?: number;
  port?: number;
  host?: string;
  payload?: Uint8Array;
}): Uint8Array {
  const host = utf8Encode(opts.host ?? "example.com");
  return concatBytes(
    new Uint8Array([opts.version ?? 0]),
    opts.uuid ?? UUID_BYTES,
    new Uint8Array([opts.addons?.length ?? 0]),
    opts.addons ?? new Uint8Array(0),
    new Uint8Array([opts.cmd ?? 1]),
    u16be(opts.port ?? 443),
    new Uint8Array([2, host.length]),
    host,
    opts.payload ?? new Uint8Array(0),
  );
}

function ipv4Frame(cmd = 1, port = 443, payload = utf8Encode("hello")): Uint8Array {
  return concatBytes(
    new Uint8Array([0]),
    UUID_BYTES,
    new Uint8Array([0]),
    new Uint8Array([cmd]),
    u16be(port),
    new Uint8Array([1, 8, 8, 8, 8]),
    payload,
  );
}

function ipv6Frame(): Uint8Array {
  return concatBytes(
    new Uint8Array([0]),
    UUID_BYTES,
    new Uint8Array([0]),
    new Uint8Array([1]),
    u16be(443),
    new Uint8Array([3]),
    hexToBytes("20010db8000000000000000000000001")!,
  );
}

describe("createVlessInbound", () => {
  it("parses a tcp request with domain address and initial payload", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(
      domainFrame({ payload: utf8Encode("GET / HTTP/1.1") }),
    );
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.parsed.command).toBe("tcp");
    expect(outcome.parsed.target).toEqual({ host: "example.com", port: 443 });
    expect(new TextDecoder().decode(outcome.rest)).toBe("GET / HTTP/1.1");
  });

  it("parses ipv4 and ipv6 targets", async () => {
    const v4 = await createVlessInbound(UUID).push(ipv4Frame());
    expect(v4.state).toBe("ready");
    if (v4.state === "ready") expect(v4.parsed.target).toEqual({ host: "8.8.8.8", port: 443 });

    const v6 = await createVlessInbound(UUID).push(ipv6Frame());
    expect(v6.state).toBe("ready");
    if (v6.state === "ready")
      expect(v6.parsed.target.host).toBe("2001:db8:0:0:0:0:0:1");
  });

  it("skips addons payload", async () => {
    const inbound = createVlessInbound(UUID);
    const frame = domainFrame({
      addons: utf8Encode('{"flow":"xtls-rprx-vision"}'),
      host: "cf.example.org",
      port: 2053,
    });
    const outcome = await inbound.push(frame);
    expect(outcome.state).toBe("ready");
    if (outcome.state === "ready") {
      expect(outcome.parsed.target).toEqual({ host: "cf.example.org", port: 2053 });
    }
  });

  it("rejects a wrong uuid", async () => {
    const inbound = createVlessInbound(UUID);
    const frame = domainFrame({
      uuid: new Uint8Array(16).fill(0xcd),
    });
    const outcome = await inbound.push(frame);
    expect(outcome).toMatchObject({ state: "reject" });
  });

  it("allows udp only for destination port 53", async () => {
    const dns = await createVlessInbound(UUID).push(ipv4Frame(2, 53));
    expect(dns.state).toBe("ready");
    if (dns.state === "ready") expect(dns.parsed.command).toBe("udp");

    const other = await createVlessInbound(UUID).push(ipv4Frame(2, 8_8_8));
    expect(other).toMatchObject({ state: "reject", reason: expect.stringContaining("53") });
  });

  it("udp sessions get a length-framed body codec; tcp sessions get none", async () => {
    const dnsInbound = createVlessInbound(UUID);
    const dnsOutcome = await dnsInbound.push(ipv4Frame(2, 53, utf8Encode("query")));
    if (dnsOutcome.state !== "ready") throw new Error("expected ready");
    const codec = dnsInbound.bodyCodec()!;
    expect(codec).not.toBeNull();

    const datagram = concatBytes(u16be(5), utf8Encode("qdata"));
    expect(new TextDecoder().decode((await codec.decodeUp(datagram))!)).toBe("qdata");
    expect(await codec.decodeUp(u16be(3))).toEqual(new Uint8Array(0));
    expect(new TextDecoder().decode((await codec.decodeUp(utf8Encode("ab!")))!)).toBe("ab!");

    const downlink = codec.beginDownlink();
    expect(downlink.header()).toBeNull();
    const framed = await downlink.encode(utf8Encode("answer"));
    expect(framed.subarray(0, 2)).toEqual(u16be(6));
    expect(new TextDecoder().decode(framed.subarray(2))).toBe("answer");

    const tcpInbound = createVlessInbound(UUID);
    await tcpInbound.push(ipv4Frame(1, 443));
    expect(tcpInbound.bodyCodec()).toBeNull();
  });

  it("rejects unsupported commands like mux", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(domainFrame({ cmd: 3 }));
    expect(outcome.state).toBe("reject");
  });

  it("returns the [version, 0x00] response header", async () => {
    const inbound = createVlessInbound(UUID);
    expect(inbound.responseHeader()).toBeNull();
    await inbound.push(domainFrame({ version: 0 }));
    expect(Array.from(inbound.responseHeader()!)).toEqual([0, 0]);
  });

  it("survives byte-by-byte delivery across push() calls", async () => {
    for (const parts of [1, 2, 7]) {
      const inbound = createVlessInbound(UUID);
      const frame = domainFrame({ payload: utf8Encode("X".repeat(64)), port: 8443 });
      let last = await inbound.push(frame.subarray(0, 1));
      let i = 1;
      while (i < frame.length && last.state === "need-more") {
        last = await inbound.push(frame.subarray(i, Math.min(i + parts, frame.length)));
        i += parts;
      }
      expect(last.state).toBe("ready");
      if (last.state === "ready") {
        expect(last.parsed.target.port).toBe(8443);
        expect(last.rest.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it("exposes the initial payload exactly once", async () => {
    const inbound = createVlessInbound(UUID);
    await inbound.push(domainFrame({ payload: utf8Encode("abc") }));
    const first = inbound.takeInitialPayload();
    expect(first).not.toBeNull();
    expect(inbound.takeInitialPayload()).toBeNull();
  });

  it("rejects buffers beyond the 16 KiB handshake cap", async () => {
    const inbound = createVlessInbound(UUID);
    const huge = new Uint8Array(16385);
    const outcome = await inbound.push(huge);
    expect(outcome).toMatchObject({ state: "reject", reason: "handshake too large" });
  });

  it("rejects data pushed after completion", async () => {
    const inbound = createVlessInbound(UUID);
    await inbound.push(domainFrame({}));
    const again = await inbound.push(utf8Encode("more"));
    expect(again.state).toBe("reject");
  });

  it("rejects invalid address types, port 0 and never throws on random input", async () => {
    const badAtype = concatBytes(
      new Uint8Array([0]),
      UUID_BYTES,
      new Uint8Array([0]),
      new Uint8Array([1]),
      u16be(443),
      new Uint8Array([9, 4]),
      new Uint8Array([1, 2, 3, 4]),
    );
    expect((await createVlessInbound(UUID).push(badAtype)).state).toBe("reject");

    const port0 = domainFrame({ port: 0 });
    expect((await createVlessInbound(UUID).push(port0)).state).toBe("reject");

    const domainHeader = concatBytes(
      new Uint8Array([0]),
      UUID_BYTES,
      new Uint8Array([0]),
      new Uint8Array([1]),
      u16be(443),
      new Uint8Array([2, 0]),
    );
    expect((await createVlessInbound(UUID).push(domainHeader)).state).toBe("reject");

    const emptyDomain = concatBytes(
      new Uint8Array([0]),
      UUID_BYTES,
      new Uint8Array([0]),
      new Uint8Array([1]),
      u16be(443),
      new Uint8Array([2, 0]),
      new Uint8Array([0, 0]),
    );
    expect((await createVlessInbound(UUID).push(emptyDomain)).state).toBe("reject");
  });

  it("never throws on truncated or random-sliced input (fuzz)", async () => {
    const frame = domainFrame({ payload: utf8Encode("Z".repeat(120)), host: "fuzz.example.org" });
    for (let trial = 0; trial < 60; trial++) {
      const inbound = createVlessInbound(UUID);
      const corrupted = frame.slice();
      const flips = 1 + (trial % 5);
      for (let f = 0; f < flips; f++) {
        const pos = (trial * 31 + f * 17) % corrupted.length;
        corrupted[pos] = (corrupted[pos]! + trial + f) & 0xff;
      }
      let outcome = await inbound.push(corrupted.subarray(0, trial % 7));
      let i = trial % 7;
      let guard = 0;
      while (outcome.state === "need-more" && i < corrupted.length && guard++ < 200) {
        const step = Math.min(1 + (trial % 9), corrupted.length - i);
        outcome = await inbound.push(corrupted.subarray(i, i + step));
        i += step;
      }
      expect(["ready", "reject", "need-more"]).toContain(outcome.state);
      if (outcome.state === "ready") {
        expect(outcome.parsed.target.port).toBeGreaterThan(0);
        expect(outcome.parsed.target.host.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("vless xtls-rprx-vision", () => {
  const VISION_FLOW = "xtls-rprx-vision";

  function visionAddonsProto(): Uint8Array {
    const flow = utf8Encode(VISION_FLOW);
    return concatBytes(new Uint8Array([0x0a, flow.length]), flow);
  }

  function visionFrame(payload: Uint8Array): Uint8Array {
    return concatBytes(u16be(payload.length), payload);
  }

  function visionHandshake(opts: {
    port?: number;
    host?: string;
    payload?: Uint8Array;
    addons?: Uint8Array;
  } = {}): Uint8Array {
    return domainFrame({
      addons: opts.addons ?? visionAddonsProto(),
      port: opts.port,
      host: opts.host,
      payload: opts.payload,
    });
  }

  it("parses a handshake with protobuf vision addons and enables a body codec", async () => {
    const inbound = createVlessInbound(UUID);
    const frame = visionHandshake();
    const half = Math.floor(frame.length / 2);
    let outcome = await inbound.push(frame.subarray(0, half));
    expect(outcome.state).toBe("need-more");
    outcome = await inbound.push(frame.subarray(half));
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.parsed.command).toBe("tcp");
    expect(outcome.parsed.target).toEqual({ host: "example.com", port: 443 });
    expect(inbound.bodyCodec()).not.toBeNull();
    expect(Array.from(inbound.responseHeader()!)).toEqual([0, 0]);
  });

  it("detects the flow in raw JSON addons too", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(
      visionHandshake({ addons: utf8Encode('{"flow":"xtls-rprx-vision"}') }),
    );
    expect(outcome.state).toBe("ready");
    expect(inbound.bodyCodec()).not.toBeNull();
  });

  it("leaves plain tcp handshakes without a body codec", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(ipv4Frame(1, 443));
    expect(outcome.state).toBe("ready");
    expect(inbound.bodyCodec()).toBeNull();
  });

  it("roundtrips bodies through the vision codec", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(visionHandshake());
    if (outcome.state !== "ready") throw new Error("expected ready");
    const codec = inbound.bodyCodec()!;
    const hello = utf8Encode("hello vision");
    expect(await codec.decodeUp(visionFrame(hello))).toEqual(hello);
    const big = new Uint8Array(4096);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    expect(await codec.decodeUp(visionFrame(big))).toEqual(big);
    const both = concatBytes(visionFrame(hello), visionFrame(big));
    expect(await codec.decodeUp(both)).toEqual(concatBytes(hello, big));
    const downlink = codec.beginDownlink();
    expect(downlink.header()).toBeNull();
    const framed = await downlink.encode(hello);
    expect(framed.subarray(0, 2)).toEqual(u16be(hello.length));
    expect(await codec.decodeUp(framed)).toEqual(hello);
    expect(await downlink.encode(new Uint8Array(0))).toEqual(new Uint8Array(0));
    expect(await downlink.encode(new Uint8Array(70000))).toEqual(new Uint8Array(0));
  });

  it("buffers split vision frames across decodeUp calls", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(visionHandshake());
    if (outcome.state !== "ready") throw new Error("expected ready");
    const codec = inbound.bodyCodec()!;
    const payload = utf8Encode("split-payload");
    const framed = visionFrame(payload);
    expect(await codec.decodeUp(framed.subarray(0, 3))).toEqual(new Uint8Array(0));
    expect(await codec.decodeUp(framed.subarray(3))).toEqual(payload);
    expect(await codec.decodeUp(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  it("decodes the coalesced initial payload at handshake time", async () => {
    const hello = utf8Encode("hello");
    const rest = concatBytes(visionFrame(hello), u16be(5), utf8Encode("ab"));
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(visionHandshake({ payload: rest }));
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.rest).toEqual(hello);
    expect(inbound.takeInitialPayload()).toEqual(hello);
    expect(inbound.takeInitialPayload()).toBeNull();
    const codec = inbound.bodyCodec()!;
    expect(await codec.decodeUp(utf8Encode("cde"))).toEqual(utf8Encode("abcde"));
  });

  it("keeps the udp codec when vision is requested with a udp command", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(
      domainFrame({ cmd: 2, port: 53, addons: visionAddonsProto(), payload: new Uint8Array(0) }),
    );
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.parsed.command).toBe("udp");
    const codec = inbound.bodyCodec()!;
    expect(await codec.decodeUp(concatBytes(u16be(5), utf8Encode("qdata")))).toEqual(
      utf8Encode("qdata"),
    );
  });

  it("rejects malformed vision bodies as null and never throws", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(visionHandshake());
    if (outcome.state !== "ready") throw new Error("expected ready");
    const codec = inbound.bodyCodec()!;
    const hungry = concatBytes(u16be(0xffff), new Uint8Array(65534));
    expect(await codec.decodeUp(hungry)).toEqual(new Uint8Array(0));
    expect(await codec.decodeUp(new Uint8Array([0x01]))).toBeNull();
    const payload = utf8Encode("recovered");
    expect(await codec.decodeUp(visionFrame(payload))).toEqual(payload);
  });

  it("never throws on adversarial vision input (fuzz)", async () => {
    for (let trial = 0; trial < 40; trial++) {
      const inbound = createVlessInbound(UUID);
      const outcome = await inbound.push(visionHandshake());
      if (outcome.state !== "ready") throw new Error("expected ready");
      const codec = inbound.bodyCodec()!;
      const len = 1 + ((trial * 7919) % 200);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + trial * 11) & 0xff;
      const cut = trial % (len + 1);
      let first: Uint8Array | null = null;
      let second: Uint8Array | null = null;
      try {
        first = await codec.decodeUp(bytes.subarray(0, cut));
        second = await codec.decodeUp(bytes.subarray(cut));
      } catch {
        throw new Error(`vision decodeUp threw on trial ${trial}`);
      }
      expect(first === null || first instanceof Uint8Array).toBe(true);
      expect(second === null || second instanceof Uint8Array).toBe(true);
    }
  });

  it("tolerates a malformed tail coalesced with the handshake", async () => {
    const inbound = createVlessInbound(UUID);
    const outcome = await inbound.push(
      visionHandshake({ payload: new Uint8Array([0xff, 0xff, 0x68, 0x69]) }),
    );
    expect(outcome.state).toBe("ready");
    if (outcome.state !== "ready") return;
    expect(outcome.rest).toEqual(new Uint8Array(0));
    const codec = inbound.bodyCodec()!;
    expect(await codec.decodeUp(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });
});
