import type { AmneziaParams, WarpConfig, WarpEndpoint } from "../../types/warp";

export interface ParseOk {
  ok: true;
  config: WarpConfig;
  amnezia_overrides: AmneziaParams | null;
  endpoints?: WarpEndpoint[];
}

export interface ParseFail {
  ok: false;
  reason: string;
}

export type ParseResult = ParseOk | ParseFail;

export const AMNEZIA_INT_KEYS = ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4", "H1", "H2", "H3", "H4"] as const;

export type AmneziaIntKey = (typeof AMNEZIA_INT_KEYS)[number];

export const INTERFACE_KEYS = new Set([
  "privatekey",
  "address",
  "dns",
  "mtu",
  "listenport",
  "jc",
  "jmin",
  "jmax",
  "s1",
  "s2",
  "s3",
  "s4",
  "h1",
  "h2",
  "h3",
  "h4",
  "i1",
]);

export const PEER_KEYS = new Set([
  "publickey",
  "presharedkey",
  "allowedips",
  "endpoint",
  "persistentkeepalive",
  "reserved",
  "clientid",
]);

export const DEFAULT_PEER_PUBLIC_KEY = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";
export const DEFAULT_WARP_IPV4 = "172.16.0.2/32";

export function fail(reason: string): ParseFail {
  return { ok: false, reason };
}
