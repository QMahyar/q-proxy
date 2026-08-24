import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const masterKey = randomBytes(16);
const salt = randomBytes(16);
const subkey = Buffer.from(hkdfSync("sha1", masterKey, salt, Buffer.from("ss-subkey"), 16));

function buildNonce(counter) {
  const n = Buffer.alloc(12);
  for (let i = 0; i < 8; i++) n[i] = Math.floor(counter / 256 ** i) & 0xff;
  return n;
}
function seal(pt, ctr) {
  const c = createCipheriv("aes-128-gcm", subkey, buildNonce(ctr), { authTagLength: 16 });
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}
function open(frame, ctr) {
  try {
    const d = createDecipheriv("aes-128-gcm", subkey, buildNonce(ctr), { authTagLength: 16 });
    return Buffer.concat([d.update(frame), d.final()]);
  } catch (e) {
    return null;
  }
}

const msg = Buffer.from("HTTP/1.1 200 OK\r\nhello");
const lenFrame = seal(Buffer.from([(msg.length >> 8) & 0xff, msg.length & 0xff]), 0);
const bodyFrame = seal(msg, 1);
console.log("len frame opens:", open(lenFrame, 0)?.toString());
console.log("body frame opens:", open(bodyFrame, 1)?.toString().slice(0, 20));
