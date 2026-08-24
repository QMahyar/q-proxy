import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import WebSocket from "../../node_modules/ws/wrapper.mjs";

const PASSWORD = process.argv[2] ?? "";
const HOST_PORT = process.argv[3] ?? "example.com:80";
if (!PASSWORD) {
  console.error("usage: node ss-probe.mjs <password> [host:port]");
  process.exit(1);
}
const [host, portStr] = HOST_PORT.split(":");
const port = Number(portStr);

function evpBytesToKey(password, keyLen) {
  const md5 = (b) => createHash("md5").update(b).digest();
  const d = [];
  let prev = Buffer.alloc(0);
  while (d.reduce((n, b) => n + b.length, 0) < keyLen) {
    prev = md5(Buffer.concat([prev, Buffer.from(password)]));
    d.push(prev);
  }
  return Buffer.concat(d).subarray(0, keyLen);
}

const KEY_LEN = 16;
const TAG_LEN = 16;
const masterKey = evpBytesToKey(PASSWORD, KEY_LEN);
const salt = randomBytes(KEY_LEN);
const subkey = Buffer.from(hkdfSync("sha1", masterKey, salt, Buffer.from("ss-subkey"), KEY_LEN));

function buildNonce(counter) {
  const n = Buffer.alloc(12);
  for (let i = 0; i < 8; i++) {
    n[i] = Math.floor(counter / 256 ** i) & 0xff;
  }
  return n;
}

function seal(plaintext, counter) {
  const cipher = createCipheriv("aes-128-gcm", subkey, buildNonce(counter), { authTagLength: TAG_LEN });
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

const targetAddr = Buffer.concat([
  Buffer.from([0x03, host.length]),
  Buffer.from(host),
  Buffer.from([port >> 8, port & 0xff]),
]);
const httpReq = Buffer.from(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
const firstPayload = Buffer.concat([targetAddr, httpReq]);

const lenFrame = seal(Buffer.from([(firstPayload.length >> 8) & 0xff, firstPayload.length & 0xff]), 0);
const payloadFrame = seal(firstPayload, 1);
const wire = Buffer.concat([salt, lenFrame, payloadFrame]);

const ws = new WebSocket(`ws://127.0.0.1:8787/ss/${process.argv[4] ?? "7VbgrqsdfclZV5CGchN6nCx2"}`, { maxPayload: 0 });
let down = Buffer.alloc(0);
let downSalt = null;
let downSubkey = null;
let downCtr = 0;
let httpBody = null;

function open(frame, counter) {
  if (frame.length <= TAG_LEN) return null;
  const ct = frame.subarray(0, frame.length - TAG_LEN);
  const tag = frame.subarray(frame.length - TAG_LEN);
  try {
    const d = createDecipheriv("aes-128-gcm", downSubkey, buildNonce(counter), { authTagLength: TAG_LEN });
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    return null;
  }
}

ws.on("open", () => {
  console.log("[open] sending SS wire:", wire.length, "bytes (salt+len+payload, LE nonce)");
  ws.send(wire);
});
ws.on("message", (data) => {
  down = Buffer.concat([down, data]);
  if (downSalt === null && down.length >= KEY_LEN) {
    downSalt = down.subarray(0, KEY_LEN);
    downSubkey = Buffer.from(hkdfSync("sha1", masterKey, downSalt, Buffer.from("ss-subkey"), KEY_LEN));
    down = down.subarray(KEY_LEN);
    console.log("[downlink salt]", downSalt.toString("hex"));
  }
  while (downSubkey !== null && down.length >= 2 + TAG_LEN) {
    const lenPlain = open(down.subarray(0, 2 + TAG_LEN), downCtr);
    if (lenPlain === null) {
      console.log("[decrypt fail] len frame ctr", downCtr, "bytes:", down.subarray(0, 24).toString("hex"));
      let cracked = false;
      for (const ctr of [0, 1, 2, 3, 4, 5]) {
        for (const endian of ["le", "be"]) {
          const n = Buffer.alloc(12);
          for (let i = 0; i < 8; i++) {
            const v = Math.floor(ctr / 256 ** i) & 0xff;
            n[endian === "le" ? i : 11 - i] = v;
          }
          try {
            const d = createDecipheriv("aes-128-gcm", downSubkey, n);
            d.setAuthTag(down.subarray(16, 18));
            const pt = Buffer.concat([d.update(down.subarray(0, 2)), d.final()]);
            console.log(`[cracked] ctr=${ctr} ${endian}:`, pt.toString("hex"));
            cracked = true;
          } catch {}
        }
      }
      if (!cracked) {
      console.log("[crack] none opened — scanning offsets...");
      outer: for (let off = 0; off + 34 <= Math.min(down.length, 64); off++) {
        const candSalt = down.subarray(off, off + KEY_LEN);
        const candKey = Buffer.from(hkdfSync("sha1", masterKey, candSalt, Buffer.from("ss-subkey"), KEY_LEN));
        for (const ctr of [0]) {
          const n = buildNonce(ctr);
          try {
            const d = createDecipheriv("aes-128-gcm", candKey, n);
            d.setAuthTag(down.subarray(off + 16 + 2, off + 16 + 18));
            const pt = Buffer.concat([d.update(down.subarray(off + 16, off + 16 + 2)), d.final()]);
            console.log(`[HIT] saltOffset=${off} ctr=${ctr} lenPlain=${pt.toString("hex")} preceding=${down.subarray(0, off).toString("hex")}`);
            break outer;
          } catch {}
        }
      }
    }
      return;
    }
    downCtr++;
    const chunkLen = (lenPlain[0] << 8) | lenPlain[1];
    if (chunkLen === 0) {
      console.log("[eof frame]");
      return;
    }
    if (down.length < 2 + TAG_LEN + chunkLen + TAG_LEN) { downCtr--; break; }
    const body = open(down.subarray(2 + TAG_LEN, 2 + TAG_LEN + chunkLen + TAG_LEN), downCtr++);
    if (body === null) {
      console.log("[decrypt fail] payload frame");
      return;
    }
    down = down.subarray(2 + TAG_LEN + chunkLen + TAG_LEN);
    if (httpBody === null) {
      httpBody = body.toString("utf8");
      console.log("[msg] first plaintext:", JSON.stringify(httpBody.slice(0, 120)));
    }
  }
});
ws.on("close", (code, reason) => {
  console.log("[close]", code, reason.toString(), "httpOk:", httpBody !== null && httpBody.startsWith("HTTP/1.1 200"));
  process.exit(httpBody !== null && httpBody.startsWith("HTTP/1.1 200") ? 0 : code === 1000 ? 3 : 1);
});
ws.on("error", (err) => console.log("[error]", err.message));
setTimeout(() => {
  console.log("[timeout] httpOk:", httpBody !== null);
  process.exit(httpBody !== null ? 0 : 2);
}, 15000);
