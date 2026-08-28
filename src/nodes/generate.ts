import type { NodeBuilderContext } from "../types/context";
import type { NodeTag, ProxyNode, SSNode, TrojanNode, VMessNode, VlessNode } from "../types/node";
import { CF_TLS_PORTS, type Settings } from "../types/settings";
import { fragmentQuery } from "./fragments";
import { renderName } from "./naming";
import { isIPv6, parseHostPort } from "../utils/net";
import { normalizeCleanAddress } from "../settings/validate";

interface AddressEntry {
  address: string;
  host: string;
  sni: string;
  tags: NodeTag[];
  pinnedPort?: number;
}

interface ProtoSpec {
  kind: ProxyNode["kind"];
  enabled: boolean;
  cred: string;
}

function collectAddresses(s: Settings, hostname: string): AddressEntry[] {
  const out: AddressEntry[] = [];
  const seen = new Set<string>();
  const push = (raw: string, host: string, sni: string, tags: NodeTag[], pinnedPort?: number): void => {
    const address = raw.trim();
    if (address.length === 0) return;
    const key = address.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ address, host, sni, tags, pinnedPort });
  };
  push(hostname, hostname, hostname, []);
  for (const d of s.customDomains) push(d, d.trim(), d.trim(), ["custom-domain"]);
  for (const raw of s.cleanIps) {
    const norm = normalizeCleanAddress(raw);
    if (norm === null) continue;
    const hp = parseHostPort(norm, 0);
    if (hp === null) continue;
    const display = isIPv6(hp.host) ? `[${hp.host}]` : hp.host;
    push(display, hostname, hostname, ["clean-ip"], hp.port > 0 ? hp.port : undefined);
  }
  if (s.cdn.enabled) {
    const cdnHost = s.cdn.host.trim().length > 0 ? s.cdn.host.trim() : hostname;
    const cdnSni = s.cdn.sni.trim().length > 0 ? s.cdn.sni.trim() : cdnHost;
    for (const a of s.cdn.addresses) push(a, cdnHost, cdnSni, ["cdn"]);
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

function tunnelSuffix(cred: string, securePath: string): string {
  const cleanChars: string[] = [];
  for (const ch of cred) {
    if (/[A-Za-z0-9]/.test(ch)) cleanChars.push(ch);
    if (cleanChars.length === 16) break;
  }
  let suffix = cleanChars.join("");
  for (const ch of securePath) {
    if (suffix.length >= 8) break;
    if (/[A-Za-z0-9]/.test(ch)) suffix += ch;
  }
  while (suffix.length < 8) suffix += "0";
  return suffix;
}

function buildPath(
  prefix: string,
  cred: string,
  securePath: string,
  earlyData: number,
  fragQ: string,
): string {
  let path = `/${prefix}/${tunnelSuffix(cred, securePath)}`;
  if (earlyData > 0) path += `?ed=${earlyData}`;
  if (fragQ.length > 0) path += `${path.includes("?") ? "&" : "?"}${fragQ}`;
  return path;
}

interface KindBuildInput {
  settings: Settings;
  hostname: string;
  addresses: AddressEntry[];
  tlsPorts: number[];
  plainPorts: number[];
  allowPlain: boolean;
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
    const familySets: Array<{ ports: number[]; security: "tls" | "none" }> =
      entry.pinnedPort !== undefined
        ? [
            {
              ports: [entry.pinnedPort],
              security: (CF_TLS_PORTS as readonly number[]).includes(entry.pinnedPort) ? "tls" : "none",
            },
          ]
        : [
            { ports: input.tlsPorts, security: "tls" },
            ...(input.allowPlain ? [{ ports: input.plainPorts, security: "none" as const }] : []),
          ];
    for (const family of familySets) {
      for (const port of family.ports) {
        const variants: Array<"normal" | "fragment"> = ["normal"];
        if (input.fragOn && family.security === "tls" && !entry.tags.includes("cdn")) {
          variants.push("fragment");
        }
        for (const variant of variants) {
          const earlyData =
            proto.kind === "ss" ? 0 : s.earlyDataEnabled ? Math.max(0, s.earlyDataMaxBytes) : 0;
          const path = buildPath(prefix, proto.cred, s.securePath, earlyData, variant === "fragment" ? input.fragQ : "");
          const tags: NodeTag[] = [...entry.tags];
          if (input.hostname.endsWith(".workers.dev")) tags.push("workers-dev");
          if (family.security === "none") tags.push("no-tls");
          if (variant === "fragment") tags.push("fragment");
          const sni =
            family.security === "tls"
              ? s.randomizeSniCase
                ? scrambleSni(entry.sni, `${entry.address}:${port}:${variant}`)
                : entry.sni
              : null;
          const base = {
            name: "",
            address: entry.address,
            port,
            security: family.security,
            sni,
            host: entry.host,
            path,
            earlyData,
            fingerprint: family.security === "tls" ? s.fingerprint : null,
            alpn: family.security === "tls" ? [...s.alpn] : [],
            ech: family.security === "tls" && s.echEnabled ? (s.echServerName.length > 0 ? s.echServerName : sni) : null,
            variant,
            tags,
          };
          let node: ProxyNode;
          if (proto.kind === "vless") {
            node = { ...base, kind: "vless", uuid: proto.cred } satisfies VlessNode;
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
            } satisfies SSNode;
          }
          node.name = renderName(node, input.country);
          list.push(node);
        }
      }
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
  const allowPlain =
    s.plainPortPolicy === "always" ||
    (s.plainPortPolicy === "workers-dev" && ctx.hostname.endsWith(".workers.dev"));
  const fragOn = s.fragment.mode !== "off";
  const fragQ = fragOn ? fragmentQuery(s.fragment) : "";
  const tlsPorts = [...new Set(s.tlsPorts)];
  const plainPorts = [...new Set(s.plainPorts)];
  const addresses = collectAddresses(s, ctx.hostname);

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
    tlsPorts,
    plainPorts,
    allowPlain,
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
  const cursors = new Array<number>(perKind.length).fill(0);
  while (out.length < limit) {
    let progressed = false;
    for (let i = 0; i < perKind.length && out.length < limit; i++) {
      const list = perKind[i]!;
      if (cursors[i]! >= list.length) continue;
      out.push(list[cursors[i]!++]!);
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}
