import type { AmneziaParams } from "../../types/warp";

export type AmneziaEntry = [key: string, value: number | string];

const INT_KEYS = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4"] as const;
const HASH_KEYS = ["H1", "H2", "H3", "H4"] as const;

export function amneziaEntries(amnezia: AmneziaParams): AmneziaEntry[] {
  const out: AmneziaEntry[] = [];
  for (const key of INT_KEYS) {
    const v = amnezia[key];
    if (typeof v === "number" && v > 0) out.push([key, v]);
  }
  for (const key of HASH_KEYS) {
    const v = amnezia[key];
    if (v === undefined || v === null || v === "" || v === 0) continue;
    out.push([key, v]);
  }
  if (typeof amnezia.I1 === "string" && amnezia.I1.length > 0) out.push(["I1", amnezia.I1]);
  return out;
}
