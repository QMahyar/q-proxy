import type { WarpEmitContext } from "../expand";
import { emitWireguardConfZip, emitThrone, emitV2rayN } from "./conf";
import { emitSingbox } from "./singbox";

export type WarpEmitterResult = string | Uint8Array;

export type WarpEmitter = (ctx: WarpEmitContext) => WarpEmitterResult;

export const WARP_FORMATS = ["wireguard-conf", "throne", "v2rayn", "singbox"] as const;

export type WarpFormat = (typeof WARP_FORMATS)[number];

export const WARP_CONTENT_TYPES: Record<WarpFormat, string> = {
  "wireguard-conf": "application/zip",
  throne: "text/plain; charset=utf-8",
  v2rayn: "text/plain; charset=utf-8",
  singbox: "application/json; charset=utf-8",
};

export const WARP_EXTENSIONS: Record<WarpFormat, string> = {
  "wireguard-conf": "zip",
  throne: "txt",
  v2rayn: "txt",
  singbox: "json",
};

export const WARP_EMITTERS: Record<WarpFormat, WarpEmitter> = {
  "wireguard-conf": emitWireguardConfZip,
  throne: emitThrone,
  v2rayn: emitV2rayN,
  singbox: emitSingbox,
};

export function isWarpFormat(value: string): value is WarpFormat {
  return (WARP_FORMATS as readonly string[]).includes(value);
}
