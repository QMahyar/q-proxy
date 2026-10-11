import { describe, expect, it } from "vitest";
import { createShadowsocksInbound } from "../../src/protocols/shadowsocks";
import { concatBytes, u16be, utf8Encode } from "../../src/utils/bytes";

const PASSWORD = "ss-pass";

async function hkdfSubkey(password: string, salt: Uint8Array, keyLen: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8Encode(password), { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-1", salt: salt as BufferSource, info: utf8Encode("ss-subkey") },
    base,
    keyLen * 8,
  );
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function nonceFor(counter: number): Uint8Array {
  const out = new Uint8Array(12);
  new DataView(out.buffer).setUint32(8, counter);
  return out;
}

async function seal(key: CryptoKey, counter: number, plain: Uint8Array): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonceFor(counter) as BufferSource }, key, plain as BufferSource);
  return new Uint8Array(ct);
}

// Builds a valid aes-128-gcm TCP opening: salt + E(len) + E(addr+payload).
async function ssTcpOpening(opts: {
  password?: string;
  salt?: Uint8Array;
  host?: Uint8Array;
  atype?: number;
  port?: number;
  payload?: Uint8Array;
}): Promise<Uint8Array> {
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await hkdfSubkey(opts.password ?? PASSWORD, salt, 16);
  const host = opts.host ?? new Uint8Array([8, 8, 8, 8]);
  const addr = concatBytes(new Uint8Array([opts.atype ?? 1]), host, u16be(opts.port ?? 443));
  const payload = opts.payload ?? utf8Encode("hello");
  const encLen = await seal(key, 0, u16be(addr.byteLength + payload.byteLength));
  const encBody = await seal(key, 1, concatBytes(addr, payload));
  return concatBytes(salt, encLen, encBody);
}

describe("shadowsocks handshake", () => {
  it("accepts an aes-128-gcm TCP opening with the right password", async () => {
    const inbound = createShadowsocksInbound("aes-128-gcm", PASSWORD);
    const out = await inbound.push(await ssTcpOpening({}));
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.parsed).toEqual({ command: "tcp", target: { host: "8.8.8.8", port: 443 } });
    expect(Buffer.from(out.rest).toString()).toBe("hello");
    expect(inbound.responseHeader()).toBeNull();
    expect(inbound.bodyCodec()).not.toBeNull();
  });

  it("accepts aes-256-gcm with a 32-byte salt", async () => {
    const inbound = createShadowsocksInbound("aes-256-gcm", PASSWORD);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await hkdfSubkey(PASSWORD, salt, 32);
    const addr = concatBytes(new Uint8Array([1]), new Uint8Array([1, 1, 1, 1]), u16be(80));
    const encLen = await seal(key, 0, u16be(addr.byteLength));
    const encBody = await seal(key, 1, addr);
    const out = await inbound.push(concatBytes(salt, encLen, encBody));
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.parsed).toEqual({ command: "tcp", target: { host: "1.1.1.1", port: 80 } });
  });

  it("buffers split openings and rejects wrong passwords, bad tags, and chacha without throwing", async () => {
    const split = createShadowsocksInbound("aes-128-gcm", PASSWORD);
    const full = await ssTcpOpening({});
    expect((await split.push(full.slice(0, 10))).state).toBe("need-more");
    expect((await split.push(full.slice(10))).state).toBe("ready");

    const wrong = createShadowsocksInbound("aes-128-gcm", PASSWORD);
    expect(await wrong.push(await ssTcpOpening({ password: "nope" }))).toMatchObject({ state: "reject" });

    const chacha = createShadowsocksInbound("chacha20-ietf-poly1305", PASSWORD);
    expect((await chacha.push(await ssTcpOpening({}))).state).toBe("reject");
  });
});

describe("shadowsocks TCP codec", () => {
  it("decrypts follow-up chunks with incrementing nonces", async () => {
    const inbound = createShadowsocksInbound("aes-128-gcm", PASSWORD);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await hkdfSubkey(PASSWORD, salt, 16);
    const addr = concatBytes(new Uint8Array([1]), new Uint8Array([8, 8, 4, 4]), u16be(443));
    const first = concatBytes(salt, await seal(key, 0, u16be(addr.byteLength)), await seal(key, 1, addr));
    expect((await inbound.push(first)).state).toBe("ready");
    const codec = inbound.bodyCodec();
    expect(codec).not.toBeNull();
    // Stream chunk on the wire: E(len)+E(data) with the next nonces.
    const wire = concatBytes(await seal(key, 2, u16be(5)), await seal(key, 3, utf8Encode("world")));
    expect(await codec!.decodeUp(wire)).toEqual(utf8Encode("world"));
  });
});
