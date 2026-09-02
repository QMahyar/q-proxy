export interface Base64Ok {
  ok: true;
  value: Uint8Array;
}
export interface Base64Fail {
  ok: false;
  reason: string;
}
export type Base64Result = Base64Ok | Base64Fail;

const WS_RE = /\s+/g;

function normalize(input: string): string | null {
  const cleaned = input.replace(WS_RE, "");
  if (cleaned.length === 0) return null;
  let s = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  const rem = s.length % 4;
  if (rem === 1) return null;
  if (rem > 0) s += "=".repeat(4 - rem);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  return s;
}

export function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeBase64(input: string): Base64Result {
  const s = normalize(input);
  if (s === null) return { ok: false, reason: "invalid base64" };
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { ok: true, value: out };
  } catch {
    return { ok: false, reason: "invalid base64" };
  }
}

export function encodeBase64Url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(input: string): Base64Result {
  return decodeBase64(input);
}

export function encodeUtf8Base64(text: string): string {
  return encodeBase64(new TextEncoder().encode(text));
}

export function utf8FromBase64(input: string): Base64Result & { text?: string } {
  const r = decodeBase64(input);
  if (!r.ok) return r;
  return { ok: true, value: r.value, text: new TextDecoder().decode(r.value) };
}
