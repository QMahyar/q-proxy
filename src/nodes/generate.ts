import type { NodeBuilderContext } from "../types/context";
import type { Hy2Node, NodeTag, ProxyNode, RealityNode, SSNode, TrojanNode, VMessNode, VlessNode } from "../types/node";
import type { AddressSetting, RemoteNodeSetting } from "../types/settings";
import { CF_PLAIN_PORTS, CF_TLS_PORTS, type Settings } from "../types/settings";
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

function parseCountryFilter(request: Request): Set<string> | null {
  let raw: string | null = null;
  try {
    raw = new URL(request.url).searchParams.get("country");
  } catch {
    return null;
  }
  if (raw === null) return null;
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const code = part.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) set.add(code);
  }
  return set.size > 0 ? set : null;
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
  const list: AddressSetting[] = s.addresses.length > 0 ? s.addresses : [{ address: hostname }];
  for (const a of list) {
    if (a.enabled === false) continue;
    const raw = typeof a.address === "string" ? a.address.trim() : "";
    if (raw.length === 0) continue;
    const hp = parseHostPort(raw, typeof a.port === "number" && a.port > 0 ? a.port : s.defaultPort);
    if (hp === null || hp.host.length === 0) continue;
    const port = hp.port;
    const isIp = isIpLiteral(hp.host);
    const connectHost = isIp ? hp.host : hp.host.toLowerCase();
    const key = connectHost.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const isBase = connectHost.toLowerCase() === hostname.toLowerCase();
    let host: string;
    let sni: string;
    let tags: NodeTag[];
    if (a.host && a.host.trim().length > 0) {
      host = a.host.trim();
      sni = a.sni && a.sni.trim().length > 0 ? a.sni.trim() : host;
      tags = isIp ? ["clean-ip"] : isBase ? [] : ["custom-domain"];
    } else if (isBase) {
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
    const label = a.label && a.label.trim().length > 0 ? a.label.trim() : undefined;
    const countryRaw = typeof a.country === "string" ? a.country.trim().toUpperCase() : "";
    const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;
    out.push({ address: bracketIpv6(connectHost), host, sni, tags, port, label, country });
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
  const prefix =
    proto.kind === "vless"
      ? s.vlessPath
      : proto.kind === "vmess"
        ? s.vmessPath
        : proto.kind === "trojan"
          ? s.trojanPath
          : s.ssPath;
  const list: ProxyNode[] = [];
  for (const entry of input.addresses) {
    const security = classifyPort(entry.port);
    if (security === null) continue;
    const variants: Array<"normal" | "fragment"> = ["normal"];
    if (input.fragOn && security === "tls") variants.push("fragment");
    for (const variant of variants) {
      const earlyData = proto.kind === "ss" ? 0 : s.earlyDataEnabled ? Math.max(0, s.earlyDataMaxBytes) : 0;
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
      let node: ProxyNode;
      if (proto.kind === "vless") {
        node = {
          ...base,
          kind: "vless",
          uuid: proto.cred,
          flow: s.vlessFlow.length > 0 && security === "tls" ? s.vlessFlow : null,
        } satisfies VlessNode;
      } else if (proto.kind === "vmess") {
        node = {
          ...base,
          kind: "vmess",
          uuid: proto.cred,
          cipher: "auto",
          alterId: 0,
        } satisfies VMessNode;
      } else if (proto.kind === "trojan") {
        node = { ...base, kind: "trojan", password: proto.cred } satisfies TrojanNode;
      } else {
        node = {
          ...base,
          kind: "ss",
          method: s.ssMethod,
          password: proto.cred,
          direct: s.ssDirect,
        } satisfies SSNode;
      }
      node.name = renderName(node, input.country, entry.label, s.nameTemplate, entry.host);
      list.push(node);
    }
  }
  return list;
}

function toRemoteNode(r: RemoteNodeSetting): ProxyNode {
  if (r.kind === "reality") {
    return {
      kind: "reality",
      name: r.name,
      address: r.address,
      port: r.port,
      security: "tls",
      sni: r.sni,
      host: r.sni,
      path: "",
      earlyData: 0,
      fingerprint: r.fp,
      alpn: [],
      ech: null,
      variant: "normal",
      tags: [],
      uuid: r.uuid,
      pbk: r.pbk,
      sid: r.sid,
      flow: r.flow,
      spx: r.spx,
    } satisfies RealityNode;
  }
  return {
    kind: "hy2",
    name: r.name,
    address: r.address,
    port: r.port,
    security: "tls",
    sni: r.sni,
    host: r.sni,
    path: "",
    earlyData: 0,
    fingerprint: null,
    alpn: [],
    ech: null,
    variant: "normal",
    tags: [],
    password: r.password,
    obfs: r.obfs,
    obfsPassword: r.obfsPassword,
  } satisfies Hy2Node;
}

export function generateNodes(ctx: NodeBuilderContext): ProxyNode[] {
  const s = ctx.settings;
  const limit = Math.max(0, Math.floor(s.maxNodesPerFormat));
  if (limit === 0) return [];
  const cf = ctx.request.cf as { country?: string } | undefined;
  const country = typeof cf?.country === "string" ? cf.country : null;
  const fragOn = s.fragment.mode !== "off";
  const fragQ = fragOn ? fragmentQuery(s.fragment) : "";
  const countryFilter = parseCountryFilter(ctx.request);
  const addresses = collectAddresses(s, ctx.hostname).filter(
    (e) => countryFilter === null || e.country === null || countryFilter.has(e.country),
  );

  const protos: ProtoSpec[] = [
    { kind: "vless", enabled: s.vlessEnabled, cred: s.vlessUuid },
    { kind: "vmess", enabled: s.vmessEnabled, cred: s.vmessUuid },
    { kind: "trojan", enabled: s.trojanEnabled, cred: s.trojanPassword },
    { kind: "ss", enabled: s.ssEnabled, cred: s.ssPassword },
  ];

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
  for (const r of s.remoteNodes) {
    if (out.length >= limit) break;
    const raw = toRemoteNode(r);
    let name = raw.name;
    let k = 2;
    while (usedNames.has(name)) name = `${raw.name} ${k++}`;
    usedNames.add(name);
    out.push(name === raw.name ? raw : { ...raw, name });
  }
  return out;
}
