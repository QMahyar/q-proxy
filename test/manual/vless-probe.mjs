import WebSocket from "../../node_modules/ws/wrapper.mjs";

const host = "example.com";
const port = 80;
const UUID_HEX = "fa5e638ce75c4714ba06599ba0a2b412".match(/.{2}/g).map((h) => parseInt(h, 16));
const addr = `02${host.length.toString(16).padStart(2, "0")}${Buffer.from(host).toString("hex")}`;
const payload = Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n");
const frame = Buffer.concat([
  Buffer.from([0x00]),
  Buffer.from(UUID_HEX),
  Buffer.from([0x00, 0x01]),
  Buffer.from([port >> 8, port & 0xff]),
  Buffer.from(addr, "hex"),
  payload,
]);
console.log("[frame]", frame.toString("hex"));
console.log("[check] len=%d atype(byte21)=%d", frame.length, frame[21]);

const ws = new WebSocket("ws://127.0.0.1:8787/vl/fa5e638ce75c4714", { maxPayload: 0 });
let bytes = 0;
ws.on("open", () => {
  console.log("[open] sending", frame.length, "bytes");
  ws.send(frame);
});
ws.on("message", (data) => {
  bytes += data.length;
  console.log("[msg]", data.length, JSON.stringify(data.toString("utf8").slice(0, 200)));
});
ws.on("close", (code, reason) => {
  console.log("[close]", code, reason.toString(), "downlink:", bytes);
  process.exit(0);
});
ws.on("error", (err) => console.log("[error]", err.message));
setTimeout(() => {
  console.log("[timeout] downlink:", bytes);
  process.exit(bytes > 0 ? 0 : 2);
}, 15000);
