import type { Settings } from "../types/settings";
import type {
  DialTarget,
  EgressCandidate,
  EgressOpener,
  EstablishedEgress,
  FailoverStrategy,
  Socket,
} from "../types/tunnel";
import { log } from "../core/log";
import { isCloudflareIp, isIPv4, isLocalOrPrivateTarget } from "../utils/net";
import { createChainConnector, parseChainUri } from "./chain";
import type { ChainDescriptor } from "./chain";
import { dialTcp } from "./chain";
import { resolveIpv4, synthesizeNat64Address } from "./nat64";
import { expandProxyIps, hashSeed, shuffleDeterministic } from "./proxyip";
import { createResolver } from "./resolver";

export interface OpenedEgress extends EstablishedEgress {
  readonly strategy: FailoverStrategy;
}

export type DialImpl = (
  candidate: EgressCandidate,
  target: DialTarget,
  firstPacket: Uint8Array | null,
) => Promise<Socket>;

type ChainCandidate = EgressCandidate & { chain?: ChainDescriptor };

const MAX_PROXYIP_CANDIDATES = 8;
export const DIAL_TIMEOUT_MS = 10_000;

export interface EgressOpenerOptions {
  dialTimeoutMs?: number;
}

function isBlockedResolvedIp(ip: string): boolean {
  const bare = ip.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return isLocalOrPrivateTarget(bare) || isCloudflareIp(bare);
}

function isBlockedDirectHost(host: string): boolean {
  const bare = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (isLocalOrPrivateTarget(bare)) return true;
  if (isIPv4(bare) && isCloudflareIp(bare)) return true;
  if (bare.includes(":") && isCloudflareIp(bare)) return true;
  return false;
}

export async function makeFailoverStrategy(
  settings: Settings,
  target: DialTarget,
): Promise<FailoverStrategy> {
  const candidates: EgressCandidate[] = [];
  if (settings.chainProxy.enabled && settings.chainProxy.uri.trim().length > 0) {
    const desc = parseChainUri(settings.chainProxy.uri);
    if (desc !== null) {
      const candidate: ChainCandidate = {
        via: "chain",
        label: `chain:${desc.kind}`,
        host: desc.host,
        port: desc.port,
        chain: desc,
      };
      candidates.push(candidate);
    }
  }
  if (!isBlockedDirectHost(target.host)) {
    candidates.push({ via: "direct", label: "direct", host: target.host, port: target.port });
  }
  if (settings.proxyIpMode === "proxyip") {
    const pool = await expandProxyIps(settings.proxyIps, { resolver: createResolver(settings.dohUpstream) });
    const shuffled = shuffleDeterministic(pool, hashSeed(target.host));
    const filtered = shuffled.filter((entry) => !isBlockedDirectHost(entry.host));
    for (const entry of filtered.slice(0, MAX_PROXYIP_CANDIDATES)) {
      candidates.push({
        via: "proxyip",
        label: `proxyip:${entry.label}`,
        host: entry.host,
        port: entry.port,
      });
    }
  } else {
    const ipv4 = await resolveIpv4(target.host, settings.remoteDns);
    if (ipv4 !== null && !isBlockedResolvedIp(ipv4)) {
      for (const prefix of settings.nat64Prefixes) {
        const synthesized = synthesizeNat64Address(prefix, ipv4);
        if (synthesized !== null) {
          candidates.push({
            via: "nat64",
            label: `nat64:${prefix}`,
            host: synthesized,
            port: target.port,
          });
        }
      }
    }
  }
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    if (c.via === "direct") return true;
    const key = `${c.host}:${c.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { target, candidates: deduped };
}

async function defaultDialImpl(
  candidate: EgressCandidate,
  target: DialTarget,
  firstPacket: Uint8Array | null,
): Promise<Socket> {
  if (candidate.via === "chain") {
    const chain = (candidate as ChainCandidate).chain;
    if (chain === undefined) throw new Error(`chain candidate missing descriptor: ${candidate.label}`);
    return createChainConnector(chain)(target, firstPacket);
  }
  const socket = await dialTcp(candidate.host, candidate.port);
  if (firstPacket !== null && firstPacket.length > 0) {
    const writer = socket.writable.getWriter();
    try {
      await writer.write(firstPacket);
    } catch (err) {
      try {
        writer.releaseLock();
      } catch {}
      await socket.close().catch(() => {});
      throw err instanceof Error ? err : new Error(String(err));
    }
    writer.releaseLock();
  }
  return socket;
}

export function createEgressOpener(
  strategy: FailoverStrategy,
  dialImpl?: DialImpl,
  opts?: EgressOpenerOptions,
): EgressOpener {
  const dial = dialImpl ?? defaultDialImpl;
  const timeoutMs = opts?.dialTimeoutMs ?? DIAL_TIMEOUT_MS;
  let lastSuccessIndex = -1;
  const attempt = async (
    index: number,
    target: DialTarget,
    firstPacket: Uint8Array | null,
  ): Promise<OpenedEgress> => {
    const candidate = strategy.candidates[index];
    if (candidate === undefined) throw new Error(`no egress candidate at index ${index}`);
    const pending = dial(candidate, target, firstPacket);
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      fallback = setTimeout(() => reject(new Error(`dial timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    let socket: Socket;
    try {
      socket = await Promise.race([pending, timeout]);
    } catch (err) {
      if (fallback !== undefined) clearTimeout(fallback);
      void pending
        .then((s) => s.close().catch(() => {}))
        .catch(() => {});
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (fallback !== undefined) clearTimeout(fallback);
    lastSuccessIndex = index;
    return { socket, via: candidate.via, candidateIndex: index, strategy };
  };
  return {
    open: async (target, firstPacket) => {
      for (let i = 0; i < strategy.candidates.length; i++) {
        try {
          return await attempt(i, target, firstPacket);
        } catch (err) {
          log.debug("egress", "candidate failed", {
            index: i,
            label: strategy.candidates[i]?.label ?? "?",
            reason: String(err),
          });
        }
      }
      throw new Error("all egress candidates failed");
    },
    retry: async (target, firstPacket) => {
      for (let i = lastSuccessIndex + 1; i < strategy.candidates.length; i++) {
        try {
          return await attempt(i, target, firstPacket);
        } catch (err) {
          log.debug("egress", "retry candidate failed", {
            index: i,
            label: strategy.candidates[i]?.label ?? "?",
            reason: String(err),
          });
        }
      }
      return null;
    },
  };
}
