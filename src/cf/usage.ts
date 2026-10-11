import type { Settings } from "../types/settings";

export interface CfUsageNumbers {
  success: boolean;
  pages: number;
  workers: number;
  total: number;
  max: number;
}

export interface CfUsageSnapshot extends CfUsageNumbers {
  updatedAt: number;
}

export const CF_USAGE_TIMEOUT_MS = 10_000;
export const CF_USAGE_MAX_BYTES = 256 * 1024;
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

// Documented minimal query: workers requests in the trailing window. Only
// `total` is filled from GraphQL; pages/workers/max need the usageApiUrl
// JSON feed, which carries the full breakdown.
const WORKERS_QUERY = `query($accountTag: String!, $since: String!, $until: String!) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      workersInvocationsAdaptive(limit: 100, filter: {datetime_geq: $since, datetime_leq: $until}) {
        sum { requests }
      }
    }
  }
}`;

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// Validate a usageApiUrl JSON body. Never throws.
export function parseUsageApiPayload(data: unknown): { ok: true; value: CfUsageNumbers } | { ok: false; reason: string } {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "invalid usage payload" };
  const r = data as Record<string, unknown>;
  if (typeof r.success !== "boolean") return { ok: false, reason: "invalid usage payload" };
  for (const key of ["pages", "workers", "total", "max"] as const) {
    if (!isNonNegativeInt(r[key])) return { ok: false, reason: "invalid usage payload" };
  }
  return {
    ok: true,
    value: { success: r.success, pages: r.pages as number, workers: r.workers as number, total: r.total as number, max: r.max as number },
  };
}

export interface FetchCfUsageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  now?: number;
}

async function readCappedText(res: Response, maxBytes: number): Promise<string | null> {
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared.trim());
    if (Number.isInteger(n) && n > maxBytes) return null;
  }
  try {
    const reader = res.body?.getReader() ?? null;
    if (reader === null) {
      const text = await res.text();
      return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
    }
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        void reader.cancel().catch(() => {});
        return null;
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } catch {
    return null;
  }
}

function sumRequests(data: unknown): number | null {
  if (data === null || typeof data !== "object") return null;
  const viewer = (data as Record<string, unknown>).viewer;
  if (viewer === null || typeof viewer !== "object") return null;
  const accounts = (viewer as Record<string, unknown>).accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const rows = (accounts[0] as Record<string, unknown>).workersInvocationsAdaptive;
  if (!Array.isArray(rows)) return null;
  let total = 0;
  let found = false;
  for (const row of rows) {
    const sum = (row as Record<string, unknown>)?.sum as Record<string, unknown> | undefined;
    if (sum !== null && typeof sum === "object" && isNonNegativeInt(sum.requests)) {
      total += sum.requests;
      found = true;
    }
  }
  return found ? total : null;
}

// Fetch Cloudflare usage: usageApiUrl JSON wins over keys; otherwise a
// minimal GraphQL query runs when an account id plus a token (or the legacy
// email+global-key pair) is configured. Keys never reach logs or reasons.
export async function fetchCfUsage(
  s: Pick<Settings, "cf">,
  fetchFn: typeof fetch = fetch,
  opts: FetchCfUsageOptions = {},
): Promise<{ ok: true; value: CfUsageSnapshot } | { ok: false; reason: string }> {
  const maxBytes = opts.maxBytes ?? CF_USAGE_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? CF_USAGE_TIMEOUT_MS;
  const now = opts.now ?? Date.now();
  const api = s.cf.usageApiUrl.trim();
  if (api.length > 0) {
    let res: Response;
    try {
      res = await fetchFn(api, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return { ok: false, reason: "usage api request failed" };
    }
    if (!res.ok) return { ok: false, reason: `usage api upstream ${res.status}` };
    const text = await readCappedText(res, maxBytes);
    if (text === null) return { ok: false, reason: "usage api response too large" };
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: "usage api returned invalid JSON" };
    }
    const parsed = parseUsageApiPayload(data);
    if (!parsed.ok) return parsed;
    return { ok: true, value: { ...parsed.value, updatedAt: now } };
  }
  const accountTag = s.cf.accountId.trim();
  const token = s.cf.apiToken.trim();
  const email = s.cf.email.trim();
  const globalKey = s.cf.globalApiKey.trim();
  // Credentials travel only in these request headers; this module never
  // logs headers, URLs, or reasons containing them.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token.length > 0) headers.Authorization = `Bearer ${token}`;
  else if (email.length > 0 && globalKey.length > 0) {
    headers["X-Auth-Email"] = email;
    headers["X-Auth-Key"] = globalKey;
  } else {
    return { ok: false, reason: "cloudflare usage is not configured" };
  }
  if (accountTag.length === 0) return { ok: false, reason: "cloudflare usage is not configured" };
  const until = new Date(now).toISOString();
  const since = new Date(now - 24 * 3600 * 1000).toISOString();
  let res: Response;
  try {
    res = await fetchFn(GRAPHQL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: WORKERS_QUERY, variables: { accountTag, since, until } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, reason: "usage graphql request failed" };
  }
  if (!res.ok) return { ok: false, reason: `usage graphql upstream ${res.status}` };
  const text = await readCappedText(res, maxBytes);
  if (text === null) return { ok: false, reason: "usage graphql response too large" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "usage graphql returned invalid JSON" };
  }
  const total = sumRequests((data as Record<string, unknown>).data);
  if (total === null) return { ok: false, reason: "usage graphql returned no rows" };
  return { ok: true, value: { success: true, pages: 0, workers: total, total, max: 0, updatedAt: now } };
}
