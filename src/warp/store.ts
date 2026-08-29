import type { AmneziaParams, SanitizedWarpAccount, WarpAccount, WarpGlobalSettings, WarpPreset } from "../types/warp";

export const WARP_ACCOUNT_PREFIX = "qproxy:warp:account:";
export const WARP_TOKEN_PREFIX = "qproxy:warp:token:";
export const WARP_PRESETS_KEY = "qproxy:warp:presets";
export const WARP_GLOBAL_KEY = "qproxy:warp:global";

export const DEFAULT_AMNEZIA: AmneziaParams = {
  Jc: 5,
  Jmin: 50,
  Jmax: 1000,
  S1: 0,
  S2: 0,
  S3: 0,
  S4: 0,
  H1: 0,
  H2: 0,
  H3: 0,
  H4: 0,
  I1: "",
};

function range(prefix: string, count: number, start: number, port: number): WarpPreset["endpoints"] {
  const out: WarpPreset["endpoints"] = [];
  for (let i = 0; i < count; i++) out.push({ ip: `${prefix}.${start + i}`, port });
  return out;
}

export const DEFAULT_PRESETS: WarpPreset[] = [
  {
    id: "default",
    name: "Cloudflare Default",
    dns: "1.1.1.1",
    endpoints: [
      { ip: "engage.cloudflareclient.com", port: 2408 },
      { ip: "162.159.192.1", port: 2408 },
      { ip: "162.159.192.1", port: 500 },
      { ip: "162.159.192.1", port: 1701 },
      { ip: "2606:4700:d0::a29f:c001", port: 2408 },
    ],
  },
  {
    id: "iran",
    name: "Iran",
    dns: "1.1.1.1",
    endpoints: [
      ...range("162.159.192", 20, 1, 2408),
      ...range("162.159.195", 20, 1, 2408),
      ...range("162.159.204", 10, 1, 2408),
    ],
  },
  {
    id: "china",
    name: "China",
    dns: "1.1.1.1",
    endpoints: [
      ...range("162.159.192", 20, 21, 2408),
      ...range("162.159.195", 20, 21, 2408),
      ...range("162.159.204", 10, 11, 2408),
    ],
  },
];

type KvListOptions = { prefix: string; cursor?: string; limit?: number };

type KvListResult = { keys: Array<{ name: string }>; list_complete?: boolean; cursor?: string };

type KvLike = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list?(options: KvListOptions): Promise<KvListResult>;
};

export async function ensureWarpDefaults(env: { QPROXY_KV: KvLike }): Promise<void> {
  const presets = await env.QPROXY_KV.get(WARP_PRESETS_KEY, "json");
  if (presets === null) {
    await env.QPROXY_KV.put(WARP_PRESETS_KEY, JSON.stringify(DEFAULT_PRESETS));
  }
  const global = await env.QPROXY_KV.get(WARP_GLOBAL_KEY, "json");
  if (global === null) {
    const seed: WarpGlobalSettings = { amnezia: { ...DEFAULT_AMNEZIA } };
    await env.QPROXY_KV.put(WARP_GLOBAL_KEY, JSON.stringify(seed));
  }
}

export async function listPresets(env: { QPROXY_KV: KvLike }): Promise<WarpPreset[]> {
  const raw = (await env.QPROXY_KV.get(WARP_PRESETS_KEY, "json")) as unknown;
  if (Array.isArray(raw)) return raw as WarpPreset[];
  return DEFAULT_PRESETS;
}

export async function savePresets(env: { QPROXY_KV: KvLike }, presets: WarpPreset[]): Promise<void> {
  await env.QPROXY_KV.put(WARP_PRESETS_KEY, JSON.stringify(presets));
}

export function newAccountId(): string {
  return crypto.randomUUID();
}

export function newSubToken(): string {
  return crypto.randomUUID();
}

export async function storeAccount(env: { QPROXY_KV: KvLike }, account: WarpAccount): Promise<void> {
  await env.QPROXY_KV.put(WARP_ACCOUNT_PREFIX + account.id, JSON.stringify(account));
  try {
    await env.QPROXY_KV.put(WARP_TOKEN_PREFIX + account.token, JSON.stringify(account.id));
  } catch (err) {
    await env.QPROXY_KV.delete(WARP_ACCOUNT_PREFIX + account.id).catch(() => {});
    throw err;
  }
}

export async function getAccount(env: { QPROXY_KV: KvLike }, id: string): Promise<WarpAccount | null> {
  const raw = (await env.QPROXY_KV.get(WARP_ACCOUNT_PREFIX + id, "json")) as unknown;
  return isAccount(raw) ? raw : null;
}

export async function getAccountByToken(env: { QPROXY_KV: KvLike }, token: string): Promise<WarpAccount | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const id = (await env.QPROXY_KV.get(WARP_TOKEN_PREFIX + token, "json")) as unknown;
  if (typeof id !== "string") return null;
  return getAccount(env, id);
}

export async function listAccounts(env: { QPROXY_KV: KvLike }): Promise<WarpAccount[]> {
  if (!env.QPROXY_KV.list) return [];
  const out: WarpAccount[] = [];
  let cursor: string | undefined;
  for (;;) {
    const res: KvListResult = await env.QPROXY_KV.list({ prefix: WARP_ACCOUNT_PREFIX, cursor });
    for (const key of res.keys) {
      const raw = (await env.QPROXY_KV.get(key.name, "json")) as unknown;
      if (isAccount(raw)) out.push(raw);
    }
    if (res.list_complete !== false) break;
    cursor = res.cursor;
    if (cursor === undefined || cursor.length === 0) break;
  }
  out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

export async function deleteAccount(env: { QPROXY_KV: KvLike }, account: WarpAccount): Promise<void> {
  await env.QPROXY_KV.delete(WARP_ACCOUNT_PREFIX + account.id);
  await env.QPROXY_KV.delete(WARP_TOKEN_PREFIX + account.token);
}

export async function regenerateToken(env: { QPROXY_KV: KvLike }, account: WarpAccount): Promise<string> {
  const next = newSubToken();
  const oldToken = account.token;
  const snapshot = account.token;
  account.token = next;
  try {
    await env.QPROXY_KV.put(WARP_TOKEN_PREFIX + next, JSON.stringify(account.id));
    await env.QPROXY_KV.put(WARP_ACCOUNT_PREFIX + account.id, JSON.stringify(account));
  } catch (err) {
    account.token = snapshot;
    try {
      await env.QPROXY_KV.put(WARP_ACCOUNT_PREFIX + account.id, JSON.stringify({ ...account, token: snapshot }));
    } catch {}
    try {
      await env.QPROXY_KV.delete(WARP_TOKEN_PREFIX + next);
    } catch {}
    throw err;
  }
  try {
    await env.QPROXY_KV.delete(WARP_TOKEN_PREFIX + oldToken);
  } catch {}
  return next;
}

export function sanitizeAccount(account: WarpAccount): SanitizedWarpAccount {
  const { private_key: _pk, ...config } = account.config;
  return {
    id: account.id,
    name: account.name,
    token: account.token,
    created_at: account.created_at,
    config,
    endpoint_list: account.endpoint_list,
    amnezia_overrides: account.amnezia_overrides,
    dns: account.dns,
  };
}

function isAccount(raw: unknown): raw is WarpAccount {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.token === "string" && typeof r.config === "object" && r.config !== null;
}

export async function getGlobalSettings(env: { QPROXY_KV: KvLike }): Promise<WarpGlobalSettings> {
  const raw = (await env.QPROXY_KV.get(WARP_GLOBAL_KEY, "json")) as unknown;
  if (raw !== null && typeof raw === "object" && typeof (raw as Record<string, unknown>).amnezia === "object") {
    return raw as WarpGlobalSettings;
  }
  return { amnezia: { ...DEFAULT_AMNEZIA } };
}

export async function setGlobalSettings(env: { QPROXY_KV: KvLike }, settings: WarpGlobalSettings): Promise<void> {
  await env.QPROXY_KV.put(WARP_GLOBAL_KEY, JSON.stringify(settings));
}

export function resolveAmnezia(global: AmneziaParams, overrides: AmneziaParams | null): AmneziaParams {
  const merged: AmneziaParams = { ...DEFAULT_AMNEZIA, ...stripEmpty(global) };
  if (overrides !== null) Object.assign(merged, stripEmpty(overrides));
  return stripEmpty(merged);
}

function stripEmpty(params: AmneziaParams): AmneziaParams {
  const out: AmneziaParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    out[k as keyof AmneziaParams] = v;
  }
  return out;
}

export function validateAmnezia(params: AmneziaParams): { ok: true; value: AmneziaParams } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const int = (key: keyof AmneziaParams, max: number) => {
    const v = params[key];
    if (v === undefined || v === null || v === "") return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) fields[key] = `must be an integer 0-${max}`;
  };
  int("Jc", 128);
  int("Jmin", 1280);
  int("Jmax", 1280);
  for (const key of ["S1", "S2", "S3", "S4"] as const) int(key, 255);
  const hRanges: Array<[string, number, number]> = [];
  for (const key of ["H1", "H2", "H3", "H4"] as const) {
    const v = params[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "string" && /^\d+-\d+$/.test(v)) {
      const [lo, hi] = v.split("-").map(Number);
      if (lo! > hi!) {
        fields[key] = "range low must be ≤ high";
        continue;
      }
      if (hi! > 2147483647) {
        fields[key] = "must be ≤ 2147483647";
        continue;
      }
      hRanges.push([key, lo!, hi!]);
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 2147483647) {
        fields[key] = "must be an integer 0-2147483647 or lo-hi range";
        continue;
      }
      hRanges.push([key, n, n]);
    }
  }
  if (params.Jmin !== undefined && params.Jmax !== undefined && params.Jmin !== "" && params.Jmax !== "") {
    if (Number(params.Jmin) > Number(params.Jmax)) fields.Jmin = "Jmin must be ≤ Jmax";
  }
  for (let i = 0; i < hRanges.length; i++) {
    for (let j = i + 1; j < hRanges.length; j++) {
      const [, aLo, aHi] = hRanges[i]!;
      const [, bLo, bHi] = hRanges[j]!;
      if (aLo <= bHi && bLo <= aHi) {
        fields[hRanges[i]![0]] = "H ranges must not overlap";
        break;
      }
    }
  }
  if (params.I1 !== undefined && params.I1 !== "" && params.I1 !== null) {
    if (typeof params.I1 !== "string" || !/^<([rb]) [^>]*>$/.test(params.I1)) fields.I1 = "must be <r N> or <b 0x..> notation";
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: params };
}
