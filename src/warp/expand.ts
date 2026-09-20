import type { AmneziaParams, WarpAccount, WarpPreset } from "../types/warp";
import type { Settings } from "../types/settings";
import { getGlobalSettings, listPresets, resolveAmnezia } from "./store";
import { parseEndpointHostPort } from "./config";

export interface WarpRow {
  ip: string;
  port: number;
  endpoint: string;
  tag: string;
  addressList: string[];
  addressCidr: string[];
  v4Host: string;
  v6Host: string;
  allowedIps: string[];
  dns: string;
}

export interface WarpEmitContext {
  account: WarpAccount;
  rows: WarpRow[];
  amnezia: AmneziaParams | null;
  amneziaEnabled: boolean;
}

function withCidr(addr: string, family: "4" | "6"): string {
  if (addr.includes("/")) return addr;
  return family === "4" ? `${addr}/32` : `${addr}/128`;
}

function bareHost(addr: string): string {
  const slash = addr.indexOf("/");
  return slash >= 0 ? addr.slice(0, slash) : addr;
}

export async function expandAccount(env: unknown, account: WarpAccount, s: Settings): Promise<WarpEmitContext> {
  const e = env as Parameters<typeof listPresets>[0];
  const presets: WarpPreset[] = await listPresets(e);
  const enabled = new Set(s.warpPresets);
  let endpoints: Array<{ ip: string; port: number }> = [];
  let dns: string | null = null;
  for (const preset of presets) {
    if (!enabled.has(preset.id)) continue;
    endpoints.push(...preset.endpoints);
    if (dns === null) dns = preset.dns;
  }
  for (const line of s.warpCustomEndpoints) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const ep = parseEndpointHostPort(trimmed);
    if (ep !== null) endpoints.push(ep);
  }
  if (endpoints.length === 0) {
    const fallback = presets.find((p) => p.id === "default") ?? presets[0];
    if (fallback !== undefined) {
      endpoints = fallback.endpoints;
      dns = dns ?? fallback.dns;
    }
  }
  const seen = new Set<string>();
  const unique = endpoints.filter((e) => {
    const key = `${e.ip.toLowerCase()}:${e.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const resolvedDns = account.dns ?? dns ?? "1.1.1.1";
  const multi = unique.length > 1;
  const rows: WarpRow[] = unique.map((e) => {
    const isV6 = e.ip.includes(":");
    const endpoint = isV6 ? `[${e.ip}]:${e.port}` : `${e.ip}:${e.port}`;
    const addressList = [account.config.addresses.ipv4, account.config.addresses.ipv6].filter((a) => a.length > 0);
    return {
      ip: e.ip,
      port: e.port,
      endpoint,
      tag: multi ? `${account.name} ${e.ip}:${e.port}` : account.name,
      addressList,
      addressCidr: addressList.map((a) => (a.includes(":") ? withCidr(a, "6") : withCidr(a, "4"))),
      v4Host: account.config.addresses.ipv4 ? bareHost(account.config.addresses.ipv4) : "",
      v6Host: account.config.addresses.ipv6 ? bareHost(account.config.addresses.ipv6) : "",
      allowedIps: ["0.0.0.0/0", "::/0"],
      dns: resolvedDns,
    };
  });
  const global = await getGlobalSettings(e);
  const amnezia = hasParams(global.amnezia) ? resolveAmnezia(global.amnezia, null) : null;
  return { account, rows, amnezia, amneziaEnabled: global.amneziaEnabled };
}

function hasParams(params: AmneziaParams): boolean {
  return Object.values(params).some((v) => v !== undefined && v !== null && v !== "" && v !== 0);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "account";
}
