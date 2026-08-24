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

function ipv4Frame(cmd = 1, port = 443): Uint8Array {
  return concatBytes(
    new Uint8Array([0]),
    UUID_BYTES,
    new Uint8Array([0]),
    new Uint8Array([cmd]),
    u16be(port),
    new Uint8Array([1, 8, 8, 8, 8]),
    utf8Encode("hello"),
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
});
