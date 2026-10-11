import { describe, expect, it } from "vitest";
import { createFallbackInbound } from "../../src/protocols/dispatch";
import { createVlessInbound } from "../../src/protocols/vless";
import { createShadowsocksInbound } from "../../src/protocols/shadowsocks";
import type { ProtocolInbound, ParsedRequest } from "../../src/protocols/common";
import { concatBytes, u16be, utf8Encode } from "../../src/utils/bytes";

const UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";
const UUID_BYTES = (() => {
  const out = new Uint8Array(16);
  const hex = UUID.replaceAll("-", "");
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
})();

function vlessTcp(): Uint8Array {
  return concatBytes(
    new Uint8Array([0]),
    UUID_BYTES,
    new Uint8Array([0, 1]),
    u16be(443),
    new Uint8Array([1, 8, 8, 8, 8]),
    utf8Encode("hi"),
  );
}

describe("fallback inbound dispatcher", () => {
  it("serves vless directly when the uuid matches", async () => {
    const inbound = createFallbackInbound(
      () => createVlessInbound(UUID),
      () => createShadowsocksInbound("aes-128-gcm", "nope"),
    );
    const out = await inbound.push(vlessTcp());
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.parsed).toEqual({ command: "tcp", target: { host: "8.8.8.8", port: 443 } });
  });

  it("falls back to the second inbound on identity mismatch", async () => {
    const inbound = createFallbackInbound(
      () => createVlessInbound(UUID),
      () => createMarkerInbound(),
    );
    const out = await inbound.push(utf8Encode("fallback-marker!"));
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    expect(out.parsed).toEqual({ command: "tcp", target: { host: "f.b", port: 1 } });
  });

  it("rejects when both inbounds reject", async () => {
    const inbound = createFallbackInbound(
      () => createVlessInbound(UUID),
      () => createShadowsocksInbound("aes-128-gcm", "nope"),
    );
    const out = await inbound.push(utf8Encode("garbage-that-matches-nothing-at-all................"));
    expect(out.state).toBe("reject");
  });
});

// Minimal stand-in secondary: ready on an exact marker, reject otherwise.
function createMarkerInbound(): ProtocolInbound<ParsedRequest<"tcp">> {
  let buf: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let done = false;
  return {
    async push(data: Uint8Array) {
      if (done) return { state: "reject", reason: "done" };
      buf = concatBytes(buf, data);
      if (buf.length < 16) return { state: "need-more" };
      done = true;
      if (Buffer.from(buf.subarray(0, 16)).toString() === "fallback-marker!") {
        return { state: "ready", parsed: { command: "tcp", target: { host: "f.b", port: 1 } }, rest: buf.subarray(16) };
      }
      return { state: "reject", reason: "nope" };
    },
    responseHeader: () => null,
    takeInitialPayload: () => null,
    bodyCodec: () => null,
  };
}
