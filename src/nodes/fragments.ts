import type { FragmentSettings } from "../types/settings";

export interface FragmentPreset {
  lengthMin: number;
  lengthMax: number;
  delayMin: number;
  delayMax: number;
}

export const FRAGMENT_PRESETS: Record<"low" | "medium" | "high" | "severe", FragmentPreset> = {
  low: { lengthMin: 100, lengthMax: 200, delayMin: 1, delayMax: 1 },
  medium: { lengthMin: 50, lengthMax: 100, delayMin: 1, delayMax: 5 },
  high: { lengthMin: 10, lengthMax: 20, delayMin: 10, delayMax: 20 },
  severe: { lengthMin: 1, lengthMax: 5, delayMin: 1, delayMax: 5 },
};

export function fragmentQuery(f: FragmentSettings): string {
  if (f.mode === "off") return "";
  if (f.mode === "custom") {
    return `frag=custom&fpackets=${f.packets}&flen=${f.lengthMin}-${f.lengthMax}&fdelay=${f.delayMin}-${f.delayMax}&fsplit=${f.maxSplitMin}-${f.maxSplitMax}`;
  }
  return `frag=${f.mode}`;
}
