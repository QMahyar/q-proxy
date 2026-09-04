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
export const TOTAL_DIAL_BUDGET_MS = 15_000;

export interface EgressOpenerOptions {
  dialTimeoutMs?: number;
  totalBudgetMs?: number;
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

function buildChainCandidate(settings: Settings): ChainCandidate | null {
  if (!(settings.chainProxy.enabled && settings.chainProxy.uri.trim().length > 0)) return null;
  const desc = parseChainUri(settings.chainProxy.uri);
  if (desc === null) return null;
  return {
    via: "chain",
    label: `chain:${desc.kind}`,
    host: desc.host,
    port: desc.port,
    chain: desc,
  };
}

function buildDirectCandidate(target: DialTarget): EgressCandidate | null {
  if (isBlockedDirectHost(target.host)) return null;
  return { via: "direct", label: "direct", host: target.host, port: target.port };
}

async function buildTailCandidates(
  settings: Settings,
  target: DialTarget,
): Promise<EgressCandidate[]> {
  if (settings.proxyIpMode === "proxyip") {
    const pool = await expandProxyIps(settings.proxyIps, { resolver: createResolver(settings.dohUpstream) });
    const shuffled = shuffleDeterministic(pool, hashSeed(target.host));
    const tail: EgressCandidate[] = [];
    for (const entry of shuffled) {
      if (tail.length >= MAX_PROXYIP_CANDIDATES) break;
      if (isBlockedDirectHost(entry.host)) continue;
      tail.push({
        via: "proxyip",
        label: `proxyip:${entry.label}`,
        host: entry.host,
        port: entry.port,
      });
    }
    return tail;
  }
  const ipv4 = await resolveIpv4(target.host, settings.remoteDns);
  if (ipv4 === null || isBlockedResolvedIp(ipv4)) return [];
  const tail: EgressCandidate[] = [];
  for (const prefix of settings.nat64Prefixes) {
    const synthesized = synthesizeNat64Address(prefix, ipv4);
    if (synthesized !== null) {
      tail.push({
        via: "nat64",
        label: `nat64:${prefix}`,
        host: synthesized,
        port: target.port,
      });
    }
  }
  return tail;
}

function dedupeCandidates(candidates: EgressCandidate[]): EgressCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (c.via === "direct") return true;
    const key = `${c.host}:${c.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function makeFailoverStrategy(
  settings: Settings,
  target: DialTarget,
): Promise<FailoverStrategy> {
  const prefix: EgressCandidate[] = [];
  const chain = buildChainCandidate(settings);
  if (chain !== null) prefix.push(chain);
  const direct = buildDirectCandidate(target);
  if (direct !== null) prefix.push(direct);
  const tail = await buildTailCandidates(settings, target);
  return { target, candidates: dedupeCandidates([...prefix, ...tail]) };
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
  const totalMs = opts?.totalBudgetMs ?? TOTAL_DIAL_BUDGET_MS;
  let lastSuccessIndex = -1;
  const attempt = async (
    index: number,
    target: DialTarget,
    firstPacket: Uint8Array | null,
    deadlineMs: number,
  ): Promise<OpenedEgress> => {
    const candidate = strategy.candidates[index];
    if (candidate === undefined) throw new Error(`no egress candidate at index ${index}`);
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) throw new Error("egress dial budget exhausted");
    const waitMs = Math.min(timeoutMs, remainingMs);
    const pending = dial(candidate, target, firstPacket);
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      fallback = setTimeout(() => reject(new Error(`dial timed out after ${waitMs}ms`)), waitMs);
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
      const deadlineMs = Date.now() + totalMs;
      for (let i = 0; i < strategy.candidates.length; i++) {
        try {
          return await attempt(i, target, firstPacket, deadlineMs);
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
      const deadlineMs = Date.now() + totalMs;
      for (let i = lastSuccessIndex + 1; i < strategy.candidates.length; i++) {
        try {
          return await attempt(i, target, firstPacket, deadlineMs);
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

export interface SpeculativeEgressOpen {
  readonly established: OpenedEgress;
  readonly opener: EgressOpener;
}

export async function openEgressWithSpeculativeDirect(
  settings: Settings,
  target: DialTarget,
  firstPacket: Uint8Array | null,
  dialImpl?: DialImpl,
  opts?: EgressOpenerOptions,
): Promise<SpeculativeEgressOpen> {
  const dial = dialImpl ?? defaultDialImpl;
  const prefix: EgressCandidate[] = [];
  const chain = buildChainCandidate(settings);
  if (chain !== null) prefix.push(chain);
  const direct = buildDirectCandidate(target);
  if (direct !== null) prefix.push(direct);
  const pending = new Map<string, Promise<Socket>>();
  for (const candidate of prefix) {
    const started = Promise.resolve().then(() => dial(candidate, target, firstPacket));
    started.catch(() => {});
    pending.set(`${candidate.via}:${candidate.host}:${candidate.port}`, started);
  }
  const consumed = new Set<string>();
  const reuse: DialImpl = (candidate, t, fp) => {
    const key = `${candidate.via}:${candidate.host}:${candidate.port}`;
    const hit = pending.get(key);
    if (hit === undefined) return dial(candidate, t, fp);
    consumed.add(key);
    return hit;
  };
  try {
    const strategy = await makeFailoverStrategy(settings, target);
    const opener = createEgressOpener(strategy, reuse, opts);
    const opened = await opener.open(target, firstPacket);
    const established: OpenedEgress = { ...opened, strategy };
    return { established, opener };
  } finally {
    for (const [key, promise] of pending) {
      if (consumed.has(key)) continue;
      promise.then(
        (s) => s.close().catch(() => {}),
        () => {},
      );
    }
  }
}
