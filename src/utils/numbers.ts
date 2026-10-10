/**
 * Strict decimal-integer parsing for untrusted text (ports, MTUs, prefixes,
 * Amnezia counters). Bare Number() accepts "", hex ("0x50" -> 80),
 * binary/octal literals and exponents, and maps "" to 0 — all surprising in
 * a parser. This helper only accepts ASCII digits (after trimming) and
 * rejects NaN/Infinity/unsafe integers, so callers get null for garbage
 * instead of a fabricated number. Never throws.
 */
export function parseDecimalInt(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/** parseDecimalInt plus an inclusive range check. */
export function parseBoundedInt(raw: string, min: number, max: number): number | null {
  const n = parseDecimalInt(raw);
  if (n === null || n < min || n > max) return null;
  return n;
}
