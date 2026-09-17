export const RATELIMIT_WINDOW_MS = 60_000;
export const RATELIMIT_MAX_CONNECTIONS = 30;
export const RATELIMIT_BURST = 10;
export const RATELIMIT_PREFIX = "qproxy:ratelimit:";
export const RATELIMIT_TTL_SECONDS = 120;

export interface RateLimitState {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimitBucket {
  state: RateLimitState;
  allowed: boolean;
  retryAfterMs: number;
}

type KvLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export function ratelimitKey(hash: string, now: number): string {
  return `${RATELIMIT_PREFIX}${hash}:${Math.floor(now / RATELIMIT_WINDOW_MS)}`;
}

function refillPerMs(): number {
  return RATELIMIT_MAX_CONNECTIONS / RATELIMIT_WINDOW_MS;
}

export function consumeBucket(prev: RateLimitState | null, now: number): RateLimitBucket {
  const rate = refillPerMs();
  let tokens = RATELIMIT_BURST;
  if (prev !== null && Number.isFinite(prev.tokens) && Number.isFinite(prev.updatedAt)) {
    const elapsed = Math.max(0, now - prev.updatedAt);
    tokens = Math.min(RATELIMIT_BURST, Math.max(0, prev.tokens) + elapsed * rate);
  }
  if (tokens >= 1) {
    return { state: { tokens: tokens - 1, updatedAt: now }, allowed: true, retryAfterMs: 0 };
  }
  return {
    state: { tokens, updatedAt: now },
    allowed: false,
    retryAfterMs: Math.max(1, Math.ceil((1 - tokens) / rate)),
  };
}

function parseState(raw: unknown): RateLimitState | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tokens !== "number" || typeof r.updatedAt !== "number") return null;
  if (!Number.isFinite(r.tokens) || !Number.isFinite(r.updatedAt)) return null;
  return { tokens: r.tokens, updatedAt: r.updatedAt };
}

export async function tryConsume(
  env: { QPROXY_KV: KvLike },
  key: string,
): Promise<RateLimitDecision> {
  const now = Date.now();
  const kvKey = ratelimitKey(key, now);
  let prev: RateLimitState | null = null;
  try {
    prev = parseState(await env.QPROXY_KV.get(kvKey, "json"));
  } catch {
    return { allowed: true, retryAfterMs: 0 };
  }
  const out = consumeBucket(prev, now);
  try {
    await env.QPROXY_KV.put(kvKey, JSON.stringify(out.state), {
      expirationTtl: RATELIMIT_TTL_SECONDS,
    });
  } catch {
    return { allowed: out.allowed, retryAfterMs: out.retryAfterMs };
  }
  return { allowed: out.allowed, retryAfterMs: out.retryAfterMs };
}
