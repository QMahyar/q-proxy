import { describe, expect, it } from "vitest";
import { createTransportFramer } from "../../src/tunnel/framing";
import { concatBytes, utf8Encode } from "../../src/utils/bytes";

function grpcFrame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.byteLength);
  out[0] = 0;
  new DataView(out.buffer).setUint32(1, payload.byteLength);
  out.set(payload, 5);
  return out;
}

describe("transport framing", () => {
  it("returns null for ws (identity path untouched)", () => {
    expect(createTransportFramer("ws")).toBeNull();
  });

  it("strips grpc length-prefix frames across split messages", () => {
    const framer = createTransportFramer("grpc")!;
    const a = grpcFrame(utf8Encode("hello"));
    const b = grpcFrame(utf8Encode("world"));
    const joined = concatBytes(a, b);
    expect(framer.pushUp(joined.slice(0, 7))).toEqual([]);
    expect(framer.pushUp(joined.slice(7))).toEqual([utf8Encode("hello"), utf8Encode("world")]);
  });

  it("wraps downlink payloads in single grpc frames", () => {
    const framer = createTransportFramer("grpc")!;
    const framed = framer.frameDown(utf8Encode("hi"));
    expect(framed.slice(0, 5)).toEqual(new Uint8Array([0, 0, 0, 0, 2]));
    expect(framed.slice(5)).toEqual(utf8Encode("hi"));
  });

  it("rejects compressed grpc frames instead of misparsing", () => {
    const framer = createTransportFramer("grpc")!;
    expect(() => framer.pushUp(new Uint8Array([1, 0, 0, 0, 2, 0x68, 0x69]))).toThrow();
  });

  it("parses xhttp chunks across split messages", () => {
    const framer = createTransportFramer("xhttp")!;
    expect(framer.pushUp(utf8Encode("5\r\nhel"))).toEqual([]);
    expect(framer.pushUp(utf8Encode("lo\r\n3\r\nbye\r\n0\r\n\r\n"))).toEqual([
      utf8Encode("hello"),
      utf8Encode("bye"),
    ]);
  });

  it("wraps downlink payloads as single xhttp chunks", () => {
    const framer = createTransportFramer("xhttp")!;
    expect(framer.frameDown(utf8Encode("hi"))).toEqual(utf8Encode("2\r\nhi\r\n"));
  });

  it("rejects oversize grpc frames", () => {
    const framer = createTransportFramer("grpc")!;
    const head = new Uint8Array([0, 0xff, 0xff, 0xff, 0xff]);
    expect(() => framer.pushUp(head)).toThrow();
  });
});
