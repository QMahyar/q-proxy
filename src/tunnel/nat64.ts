import { isIPv4 } from "../utils/net";
import { createResolver } from "./resolver";

const NAT64_IPV4_GROUPS = 2;
const NAT64_PREFIX_GROUPS = 6;

function expandGroups(v6: string): number[] | null {
  const halves = v6.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string): string[] | null => {
    if (s.length === 0) return [];
    const parts = s.split(":");
    if (parts.some((p) => !/^[0-9a-fA-F]{1,4}$/.test(p))) return null;
    return parts;
  };
  const head = parse(halves[0]!);
  if (head === null) return null;
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (tail === null) return null;
  const total = head.length + tail.length;
  const groups: number[] = [];
  for (let i = 0; i < head.length; i++) groups.push(parseInt(head[i]!, 16));
  if (halves.length === 2) {
    const missing = 8 - total;
    if (missing <= 0) return null;
    for (let i = 0; i < missing; i++) groups.push(0);
  } else {
    if (total !== 8) return null;
  }
  for (let i = 0; i < tail.length; i++) groups.push(parseInt(tail[i]!, 16));
  return groups;
}

function formatGroups(groups: number[]): string {
  let bestStart = -1;
  let bestLen = 1;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return groups.map((g) => g.toString(16)).join(":");
  const left = groups
    .slice(0, bestStart)
    .map((g) => g.toString(16))
    .join(":");
  const right = groups
    .slice(bestStart + bestLen)
    .map((g) => g.toString(16))
    .join(":");
  return `${left}::${right}`;
}

export function synthesizeNat64Address(prefix: string, ipv4: string): string | null {
  if (!isIPv4(ipv4)) return null;
  let bare = prefix.trim().toLowerCase();
  bare = bare.replace(/^\[/, "").replace(/\]$/, "");
  const slash = bare.indexOf("/");
  if (slash !== -1) {
    const bits = Number(bare.slice(slash + 1));
    if (!Number.isInteger(bits) || bits < 96 || bits > 128) return null;
    bare = bare.slice(0, slash);
  }
  const groups = expandGroups(bare);
  if (groups === null) return null;
  if (groups.slice(NAT64_PREFIX_GROUPS).some((g) => g !== 0)) return null;
  const octets = ipv4.split(".").map(Number);
  const out = [...groups.slice(0, NAT64_PREFIX_GROUPS)];
  while (out.length < NAT64_PREFIX_GROUPS) out.push(0);
  out.push((octets[0]! << 8) | octets[1]!);
  out.push((octets[2]! << 8) | octets[3]!);
  if (out.length !== NAT64_PREFIX_GROUPS + NAT64_IPV4_GROUPS) return null;
  return formatGroups(out);
}

export async function resolveIpv4(host: string, dohUrl: string): Promise<string | null> {
  const h = host.trim().toLowerCase().replace(/\.+$/, "");
  if (isIPv4(h)) return h;
  if (h.includes(":")) return null;
  if (h.length === 0 || !h.includes(".")) return null;
  if (h.endsWith(".local") || h.endsWith(".localhost")) return null;
  const answers = await createResolver(dohUrl).resolveA(h);
  return answers.find((a) => isIPv4(a)) ?? null;
}
