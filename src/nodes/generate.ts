import type { NodeBuilderContext } from "../types/context";
import type { NodeTag, ProxyNode, VlessNode } from "../types/node";
import { CF_PLAIN_PORTS, CF_TLS_PORTS, type Settings } from "../types/settings";
import { CDN_PRESETS } from "./cdn-presets";
import { fragmentQuery } from "./fragments";
import { resolveEchServerName } from "./ech";
import { renderName } from "./naming";
import { bracketIpv6, isIpLiteral, parseHostPort } from "../utils/net";

interface AddressEntry {
  address: string;
  host: string;
  sni: string;
  tags: NodeTag[];
  port: number;
  label?: string;
  country: string | null;
}

export function resolveEndpointLines(s: Settings): string[] {
  const out: string[] = [];
  const enabled = new Set(s.cdnPresets);
  for (const p of CDN_PRESETS) {
    if (enabled.has(p.id)) out.push(`${p.ip}:${p.port}`);
  }
  for (const line of s.customEndpoints) {
    const trimmed = line.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

interface ProtoSpec {
  kind: ProxyNode["kind"];
  enabled: boolean;
  cred: string;
}

function classifyPort(port: number): "tls" | "none" | null {
  const tls = CF_TLS_PORTS.some((p) => p === port);
  if (tls) return "tls";
  const plain = CF_PLAIN_PORTS.some((p) => p === port);
  if (plain) return "none";
  return null;
}

function collectAddresses(s: Settings, hostname: string): AddressEntry[] {
  const out: AddressEntry[] = [];
  const seen = new Set<string>();
  const lines = resolveEndpointLines(s);
  const raws = lines.length > 0 ? lines : [hostname];
  for (const raw of raws) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const hp = parseHostPort(trimmed, s.defaultPort);
    if (hp === null || hp.host.length === 0) continue;
    const port = hp.port;
    const isIp = isIpLiteral(hp.host);
    const connectHost = isIp ? hp.host : hp.host.toLowerCase();
    const key = `${connectHost.toLowerCase()}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isBase = connectHost.toLowerCase() === hostname.toLowerCase();
    let host: string;
    let sni: string;
    let tags: NodeTag[];
    if (isBase) {
      host = connectHost;
      sni = connectHost;
      tags = [];
    } else if (isIp) {
      host = hostname;
      sni = hostname;
      tags = ["clean-ip"];
    } else {
      host = connectHost;
      sni = connectHost;
      tags = ["custom-domain"];
    }
    if (!isBase) {
      if (s.cdnHost.trim().length > 0) host = s.cdnHost.trim().toLowerCase();
      if (s.cdnSni.trim().length > 0) sni = s.cdnSni.trim().toLowerCase();
    }
    out.push({ address: bracketIpv6(connectHost), host, sni, tags, port, label: undefined, country: null });
  }
  return out;
}

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function scrambleSni(sni: string, seedKey: string): string {
  let h = fnv1a(seedKey);
  const out: string[] = [];
  for (const ch of sni) {
    h = (Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0) || 1;
    const isLower = ch >= "a" && ch <= "z";
    const isUpper = ch >= "A" && ch <= "Z";
    if ((h & 1) === 0 && isUpper) out.push(ch.toLowerCase());
    else if ((h & 1) === 1 && isLower) out.push(ch.toUpperCase());
    else out.push(ch);
  }
  return out.join("");
}

const ALNUM_RE = /[A-Za-z0-9]/;

function tunnelSuffix(cred: string, securePath: string): string {
  const cleanChars: string[] = [];
  for (const ch of cred) {
    if (ALNUM_RE.test(ch)) cleanChars.push(ch);
    if (cleanChars.length === 16) break;
  }
  let suffix = cleanChars.join("");
  for (const ch of securePath) {
    if (suffix.length >= 8) break;
    if (ALNUM_RE.test(ch)) suffix += ch;
  }
  while (suffix.length < 8) suffix += "0";
  return suffix;
}

function buildPath(prefix: string, cred: string, securePath: string, earlyData: number, fragQ: string): string {
  let path = `/${prefix}/${tunnelSuffix(cred, securePath)}`;
  if (earlyData > 0) path += `?ed=${earlyData}`;
  if (fragQ.length > 0) path += `${path.includes("?") ? "&" : "?"}${fragQ}`;
  return path;
}

interface KindBuildInput {
  settings: Settings;
  hostname: string;
  addresses: AddressEntry[];
  fragOn: boolean;
  fragQ: string;
  country: string | null;
}

function buildKindNodes(proto: ProtoSpec, input: KindBuildInput): ProxyNode[] {
  const s = input.settings;
  const prefix = s.vlessPath;
  const list: ProxyNode[] = [];
  for (const entry of input.addresses) {
    const security = classifyPort(entry.port);
    if (security === null) continue;
    const variants: Array<"normal" | "fragment"> = ["normal"];
    if (input.fragOn && security === "tls") variants.push("fragment");
    for (const variant of variants) {
      const earlyData = s.earlyDataEnabled ? Math.max(0, s.earlyDataMaxBytes) : 0;
      const path = buildPath(prefix, proto.cred, s.securePath, earlyData, variant === "fragment" ? input.fragQ : "");
      const tags: NodeTag[] = [...entry.tags];
      if (input.hostname.endsWith(".workers.dev")) tags.push("workers-dev");
      if (security === "none") tags.push("no-tls");
      if (variant === "fragment") tags.push("fragment");
      const sni =
        security === "tls"
          ? s.randomizeSniCase
            ? scrambleSni(entry.sni, `${entry.address}:${entry.port}:${variant}`)
            : entry.sni
          : null;
      const base = {
        name: "",
        address: entry.address,
        port: entry.port,
        security,
        sni,
        host: entry.host,
        path,
        earlyData,
        fingerprint: security === "tls" ? s.fingerprint : null,
        alpn: security === "tls" ? [...s.alpn] : [],
        ech: security === "tls" ? resolveEchServerName(s, sni).name : null,
        variant,
        tags,
      };
      const node: ProxyNode = {
        ...base,
        kind: "vless",
        uuid: proto.cred,
        flow: s.vlessFlow.length > 0 && security === "tls" ? s.vlessFlow : null,
      } satisfies VlessNode;
      node.name = renderName(node, input.country, entry.label, s.nameTemplate, entry.host);
      list.push(node);
    }
  }
  return list;
}

export function generateNodes(ctx: NodeBuilderContext): ProxyNode[] {
  const s = ctx.settings;
  const limit = Math.max(0, Math.floor(s.maxNodesPerFormat));
  if (limit === 0) return [];
  const cf = ctx.request.cf as { country?: string } | undefined;
  const country = typeof cf?.country === "string" ? cf.country : null;
  const fragOn = s.fragment.mode !== "off";
  const fragQ = fragOn ? fragmentQuery(s.fragment) : "";
  const addresses = collectAddresses(s, ctx.hostname);

  const protos: ProtoSpec[] = [{ kind: "vless", enabled: s.vlessEnabled, cred: s.vlessUuid }];

  const input: KindBuildInput = {
    settings: s,
    hostname: ctx.hostname,
    addresses,
    fragOn,
    fragQ,
    country,
  };
  const perKind: ProxyNode[][] = [];
  for (const proto of protos) {
    if (!proto.enabled || proto.cred.length === 0) continue;
    perKind.push(buildKindNodes(proto, input));
  }

  const out: ProxyNode[] = [];
  const usedNames = new Set<string>();
  const cursors = new Array<number>(perKind.length).fill(0);
  while (out.length < limit) {
    let progressed = false;
    for (let i = 0; i < perKind.length && out.length < limit; i++) {
      const list = perKind[i]!;
      if (cursors[i]! >= list.length) continue;
      const raw = list[cursors[i]!++]!;
      let name = raw.name;
      let k = 2;
      while (usedNames.has(name)) name = `${raw.name} ${k++}`;
      usedNames.add(name);
      out.push(name === raw.name ? raw : { ...raw, name });
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}
