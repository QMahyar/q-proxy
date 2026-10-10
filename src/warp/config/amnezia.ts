import { parseDecimalInt } from "../../utils/numbers";

export function decodeReservedTriplet(b64: string): [number, number, number] | null {
  if (b64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  let padded = b64;
  while (padded.length % 4 !== 0) padded += "=";
  try {
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (bytes.length !== 3) return null;
    const b0 = bytes[0];
    const b1 = bytes[1];
    const b2 = bytes[2];
    if (b0 === undefined || b1 === undefined || b2 === undefined) return null;
    return [b0, b1, b2];
  } catch {
    return null;
  }
}

export function decodeReservedBytes(value: string): [number, number, number] | null {
  const parts = value.split(/[,\s]+/).filter((p) => p.length > 0);
  if (parts.length === 3) {
    const nums: number[] = [];
    for (const p of parts) {
      const n = parseDecimalInt(p);
      if (n === null || n > 255) return null;
      nums.push(n);
    }
    const [a, b, c] = nums;
    if (a === undefined || b === undefined || c === undefined) return null;
    return [a, b, c];
  }
  if (parts.length === 1) {
    const single = parts[0];
    if (single === undefined) return null;
    return decodeReservedTriplet(single);
  }
  return null;
}

export function parseAmneziaInt(key: string, value: string): { ok: true; value: number | string } | { ok: false } {
  const v = value.trim();
  if (v.length === 0) return { ok: false };
  if (key.startsWith("H")) {
    const range = /^(\d+)-(\d+)$/.exec(v);
    if (range) {
      const lo = parseDecimalInt(range[1] ?? "");
      const hi = parseDecimalInt(range[2] ?? "");
      if (lo === null || hi === null) return { ok: false };
      if (lo > hi || hi > 2147483647) return { ok: false };
      return { ok: true, value: `${lo}-${hi}` };
    }
    const n = parseDecimalInt(v);
    if (n === null || n > 2147483647) return { ok: false };
    return { ok: true, value: n };
  }
  const n = parseDecimalInt(v);
  if (n === null) return { ok: false };
  if (key === "Jc" && n > 128) return { ok: false };
  if ((key === "Jmin" || key === "Jmax") && n > 1280) return { ok: false };
  if (key.startsWith("S") && n > 65535) return { ok: false };
  return { ok: true, value: n };
}
