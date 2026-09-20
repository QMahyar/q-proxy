import { md5 } from "./md5";
import { utf8Encode } from "../utils/bytes";

export function evpBytesToKey(password: string, keyLen: number, count = 1): Uint8Array {
  const pwd = utf8Encode(password);
  const out = new Uint8Array(keyLen);
  let prev: Uint8Array = new Uint8Array(0);
  let filled = 0;
  while (filled < keyLen) {
    let block = concat2(prev, pwd);
    for (let i = 1; i < count; i++) block = md5(block);
    prev = md5(block);
    const take = Math.min(prev.length, keyLen - filled);
    out.set(prev.subarray(0, take), filled);
    filled += take;
  }
  return out;
}

function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

async function hmacSha1Raw(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", ck, data as BufferSource));
}

export async function hkdfSha1Extract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  if (salt.length === 0) salt = new Uint8Array(20);
  return hmacSha1Raw(salt, ikm);
}

export async function hkdfSha1Expand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const n = Math.ceil(length / 20);
  const out = new Uint8Array(n * 20);
  let prev: Uint8Array = new Uint8Array(0);
  for (let i = 1; i <= n; i++) {
    prev = await hmacSha1Raw(prk, concat2(concat2(prev, info), new Uint8Array([i])));
    out.set(prev, (i - 1) * 20);
  }
  return out.subarray(0, length).slice();
}

export async function hkdfSha1(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hkdfSha1Extract(salt, ikm);
  return hkdfSha1Expand(prk, info, length);
}

