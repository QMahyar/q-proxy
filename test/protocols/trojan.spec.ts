import { describe, expect, it } from "vitest";
import { createTrojanInbound } from "../../src/protocols/trojan";
import { concatBytes, u16be, utf8Encode } from "../../src/utils/bytes";
import { sha224Hex } from "../../src/utils/sha224";

const PASSWORD = "s3cret-trojan";
const HEX = sha224Hex(PASSWORD);

function trojanTcpFrame(opts: {
  hex?: string;
  cmd?: number;
  port?: number;
  host?: Uint8Array;
  atype?: number;
  payload?: Uint8Array;
}): Uint8Array {
  return concatBytes(
    utf8Encode(opts.hex ?? HEX),
    utf8Encode("\r\n"),
    new Uint8Array([opts.cmd ?? 1]),
    new Uint8Array([opts.atype ?? 1]),
    opts.host ?? new Uint8Array([8, 8, 8, 8]),
    u16be(opts.port ?? 443),
    utf8Encode("\r\n"),
    opts.payload ?? utf8Encode("hello"),
  );
}

describe("trojan handshake", () => {
  it("accepts a TCP request with the right password", async () => {
    const inbound = createTrojanInbound(PASSWORD);
    const out = await inbound.push(trojanTcpFrame({}));
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.parsed).toEqual({ command: "tcp", target: { host: "8.8.8.8", port: 443 } });
    expect(Buffer.from(out.rest).toString()).toBe("hello");
    expect(inbound.responseHeader()).toBeNull();
    expect(Buffer.from(inbound.takeInitialPayload() ?? new Uint8Array(0)).toString()).toBe("hello");
    expect(inbound.bodyCodec()).toBeNull();
  });

  it("buffers split handshakes and rejects short reads as need-more", async () => {
    const inbound = createTrojanInbound(PASSWORD);
    const full = trojanTcpFrame({});
    expect((await inbound.push(full.slice(0, 10))).state).toBe("need-more");
    const out = await inbound.push(full.slice(10));
    expect(out.state).toBe("ready");
  });

  it("rejects wrong passwords, bad commands, and garbage without throwing", async () => {
    const badPass = createTrojanInbound(PASSWORD);
    expect((await badPass.push(trojanTcpFrame({ hex: "0".repeat(56) }))).state).toBe("reject");

    const badCmd = createTrojanInbound(PASSWORD);
    expect((await badCmd.push(trojanTcpFrame({ cmd: 0x02 }))).state).toBe("reject");

    const garbage = createTrojanInbound(PASSWORD);
    expect((await garbage.push(utf8Encode("not-a-handshake-at-all" + ".".repeat(60)))).state).toBe("reject");

    const truncated = createTrojanInbound(PASSWORD);
    expect((await truncated.push(utf8Encode(HEX))).state).toBe("need-more");
  });

  it("accepts UDP associate for DNS relay", async () => {
    const inbound = createTrojanInbound(PASSWORD);
    const out = await inbound.push(trojanTcpFrame({ cmd: 0x03, port: 443 }));
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.parsed.command).toBe("udp");
    expect(inbound.bodyCodec()).not.toBeNull();
  });
});

describe("trojan UDP codec", () => {
  it("strips SOCKS-UDP framing uplink and wraps answers downlink", async () => {
    const inbound = createTrojanInbound(PASSWORD);
    await inbound.push(trojanTcpFrame({ cmd: 0x03, port: 443, payload: new Uint8Array(0) }));
    const codec = inbound.bodyCodec();
    expect(codec).not.toBeNull();
    const dns = utf8Encode("dnsquery");
    // RSV RSV FRAG ATYP=ipv4 ADDR PORT + payload
    const datagram = concatBytes(new Uint8Array([0, 0, 0, 1, 1, 1, 1, 1]), u16be(53), dns);
    expect(await codec!.decodeUp(datagram)).toEqual(dns);
    const encoder = codec!.beginDownlink();
    expect(encoder.header()).toBeNull();
    const wrapped = await encoder.encode(utf8Encode("answer"));
    // Wrapped answer must carry the last datagram's address.
    expect(wrapped.slice(0, 3)).toEqual(new Uint8Array([0, 0, 0]));
    expect(wrapped.slice(-6)).toEqual(utf8Encode("answer"));
  });
});
