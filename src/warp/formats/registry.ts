import type { WarpEmitContext } from "../expand";
import { emitWireguardConfAmneziaZip, emitWireguardConfZip, emitThrone, emitV2rayN, emitWireguardUri } from "./conf";
import { emitSingbox, emitXray } from "./singbox";
import { emitClash, emitEgern, emitLoon, emitSurge } from "./proxies";

export type WarpEmitterResult = string | Uint8Array;

export type WarpEmitter = (ctx: WarpEmitContext) => WarpEmitterResult;

export const WARP_FORMATS = [
  "wireguard-conf",
  "wireguard-conf-amnezia",
  "throne",
  "throne-amnezia",
  "wireguard-uri",
  "v2rayn",
  "singbox",
  "singbox-amnezia",
  "singbox-legacy",
  "singbox-legacy-amnezia",
  "xray",
  "clash",
  "clash-amnezia",
  "surge",
  "surfboard",
  "loon",
  "egern",
] as const;

export type WarpFormat = (typeof WARP_FORMATS)[number];

export const WARP_CONTENT_TYPES: Record<WarpFormat, string> = {
  "wireguard-conf": "application/zip",
  "wireguard-conf-amnezia": "application/zip",
  throne: "text/plain; charset=utf-8",
  "throne-amnezia": "text/plain; charset=utf-8",
  "wireguard-uri": "text/plain; charset=utf-8",
  v2rayn: "text/plain; charset=utf-8",
  singbox: "application/json; charset=utf-8",
  "singbox-amnezia": "application/json; charset=utf-8",
  "singbox-legacy": "application/json; charset=utf-8",
  "singbox-legacy-amnezia": "application/json; charset=utf-8",
  xray: "application/json; charset=utf-8",
  clash: "text/yaml; charset=utf-8",
  "clash-amnezia": "text/yaml; charset=utf-8",
  surge: "text/plain; charset=utf-8",
  surfboard: "text/plain; charset=utf-8",
  loon: "text/plain; charset=utf-8",
  egern: "text/yaml; charset=utf-8",
};

export const WARP_EXTENSIONS: Record<WarpFormat, string> = {
  "wireguard-conf": "zip",
  "wireguard-conf-amnezia": "zip",
  throne: "txt",
  "throne-amnezia": "txt",
  "wireguard-uri": "txt",
  v2rayn: "txt",
  singbox: "json",
  "singbox-amnezia": "json",
  "singbox-legacy": "json",
  "singbox-legacy-amnezia": "json",
  xray: "json",
  clash: "yaml",
  "clash-amnezia": "yaml",
  surge: "conf",
  surfboard: "conf",
  loon: "conf",
  egern: "yaml",
};

export const WARP_EMITTERS: Record<WarpFormat, WarpEmitter> = {
  "wireguard-conf": emitWireguardConfZip,
  "wireguard-conf-amnezia": emitWireguardConfAmneziaZip,
  throne: (ctx) => emitThrone(ctx, false),
  "throne-amnezia": (ctx) => emitThrone(ctx, true),
  "wireguard-uri": emitWireguardUri,
  v2rayn: emitV2rayN,
  singbox: (ctx) => emitSingbox(ctx, false, false),
  "singbox-amnezia": (ctx) => emitSingbox(ctx, false, true),
  "singbox-legacy": (ctx) => emitSingbox(ctx, true, false),
  "singbox-legacy-amnezia": (ctx) => emitSingbox(ctx, true, true),
  xray: emitXray,
  clash: (ctx) => emitClash(ctx, false),
  "clash-amnezia": (ctx) => emitClash(ctx, true),
  surge: (ctx) => emitSurge(ctx, false),
  surfboard: (ctx) => emitSurge(ctx, true),
  loon: emitLoon,
  egern: emitEgern,
};

export function isWarpFormat(value: string): value is WarpFormat {
  return (WARP_FORMATS as readonly string[]).includes(value);
}
