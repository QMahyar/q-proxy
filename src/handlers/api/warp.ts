import type { RouteHandler } from "../../types/context";
import type { AmneziaParams, WarpAccount, WarpConfig, WarpEndpoint, WarpPreset } from "../../types/warp";
import { ValidationError, NotFoundError, UpstreamError } from "../../core/errors";
import { afterResponse } from "../../core/counters";
import { jsonOk, readJsonObject } from "../../core/respond";
import { assertCsrf } from "../../auth/guard";
import { parseWarpConfig } from "../../warp/config";
import { registerWarpDevice, removeWarpDevice, WarpApiError } from "../../warp/api";
import { purgeAllWarpSubs, purgeWarpSub } from "../../warp/cache";
import {
  deleteAccount,
  ensureWarpDefaults,
  getAccount,
  getGlobalSettings,
  listAccounts,
  listPresets,
  newAccountId,
  newSubToken,
  regenerateToken,
  sanitizeAccount,
  savePresets,
  setGlobalSettings,
  storeAccount,
  validateAmnezia,
} from "../../warp/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ENDPOINTS = 200;
const MAX_PRESETS = 20;

const PLACEHOLDER_CONFIG: WarpConfig = {
  private_key: "",
  public_key: "",
  addresses: { ipv4: "", ipv6: "" },
  peer_public_key: "",
  mtu: 1280,
  reserved: [0, 0, 0],
};

function requireString(value: unknown, field: string, max = 100): string {
  if (typeof value !== "string") throw new ValidationError({ [field]: "must be a string" });
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError({ [field]: "is required" });
  if (trimmed.length > max) throw new ValidationError({ [field]: `must be at most ${max} characters` });
  return trimmed;
}

function parseEndpoint(value: string): WarpEndpoint | null {
  let host = value.trim();
  let portStr = "";
  const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(host);
  if (bracket) {
    host = bracket[1]!;
    portStr = bracket[2]!;
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0 && host.indexOf(":") === colon) {
      portStr = host.slice(colon + 1);
      host = host.slice(0, colon);
    }
  }
  const port = Number(portStr);
  if (portStr === "" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  host = host.replace(/^\[|\]$/g, "");
  if (!/^[A-Za-z0-9.-]+$/.test(host) || host.length === 0 || host.startsWith("-") || host.endsWith("-")) return null;
  if (host.includes(".")) {
    const labels = host.split(".");
    if (labels.some((l) => l.length === 0 || l.length > 63)) return null;
  }
  return { ip: host, port };
}

function parseEndpoints(value: unknown, field: string): WarpEndpoint[] {
  if (!Array.isArray(value)) throw new ValidationError({ [field]: "must be an array" });
  if (value.length < 1 || value.length > MAX_ENDPOINTS) {
    throw new ValidationError({ [field]: `must contain 1-${MAX_ENDPOINTS} endpoints` });
  }
  const out: WarpEndpoint[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const endpoint = typeof item === "string" ? parseEndpoint(item) : null;
    if (endpoint === null) throw new ValidationError({ [field]: `invalid endpoint: ${String(item).slice(0, 60)}` });
    const key = `${endpoint.ip}:${endpoint.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(endpoint);
  }
  return out;
}

async function resolveEndpointList(
  env: Parameters<RouteHandler>[1],
  value: unknown,
): Promise<WarpAccount["endpoint_list"]> {
  if (value !== null && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.type === "custom") {
      return { type: "custom", custom_endpoints: parseEndpoints(v.custom_endpoints, "endpoint_list") };
    }
    if (v.type === "preset" && typeof v.preset_id === "string") {
      const presets = await listPresets(env);
      if (!presets.some((p) => p.id === v.preset_id)) {
        throw new ValidationError({ endpoint_list: "unknown preset" });
      }
      return { type: "preset", preset_id: v.preset_id };
    }
  }
  throw new ValidationError({ endpoint_list: "must be {type:'preset',preset_id} or {type:'custom',custom_endpoints}" });
}

async function buildAccount(env: Parameters<RouteHandler>[1], body: Record<string, unknown>, config: WarpAccount["config"], amnezia: AmneziaParams | null): Promise<WarpAccount> {
  const name = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim().slice(0, 100) : `Account ${Date.now()}`;
  const endpoint_list = body.endpoint_list === undefined ? ({ type: "preset", preset_id: "default" } as const) : await resolveEndpointList(env, body.endpoint_list);
  let dns: string | null = null;
  if (typeof body.dns === "string" && body.dns.trim().length > 0) {
    dns = body.dns.trim().slice(0, 253);
  }
  let amnezia_overrides: AmneziaParams | null = amnezia;
  if (body.amnezia_overrides !== undefined && body.amnezia_overrides !== null) {
    const check = validateAmnezia(body.amnezia_overrides as AmneziaParams);
    if (!check.ok) throw new ValidationError(check.fields);
    amnezia_overrides = check.value;
  }
  return {
    id: newAccountId(),
    name,
    token: newSubToken(),
    created_at: new Date().toISOString(),
    warp_id: null,
    warp_token: null,
    config,
    endpoint_list,
    amnezia_overrides,
    dns,
  };
}

export const handleWarpApi: RouteHandler = async (req, env, _s) => {
  const url = new URL(req.url);
  const segs = url.pathname.split("/").filter((p) => p.length > 0);
  const rest = segs.slice(segs.indexOf("warp") + 1);
  const method = req.method;
  if (method !== "GET") assertCsrf(req);
  await ensureWarpDefaults(env);
  const origin = url.origin;
  const purgeAll = () => purgeAllWarpSubs(env, origin).catch(() => {});

  if (rest[0] === "account") {
    if (rest.length === 1 && method === "GET") {
      const accounts = await listAccounts(env);
      return jsonOk({ accounts: accounts.map(sanitizeAccount) });
    }
    if (rest[1] === "generate" && rest.length === 2 && method === "POST") {
      const body = await readJsonObject(req);
      const account = await buildAccount(env, body, PLACEHOLDER_CONFIG, null);
      let reg: Awaited<ReturnType<typeof registerWarpDevice>>;
      try {
        reg = await registerWarpDevice();
      } catch (err) {
        if (err instanceof WarpApiError) throw new UpstreamError("warp api unavailable");
        throw err;
      }
      account.config = reg.config;
      account.warp_id = reg.warpId;
      account.warp_token = reg.warpToken;
      try {
        await storeAccount(env, account);
      } catch (err) {
        void removeWarpDevice(reg.warpId, reg.warpToken).catch(() => {});
        throw err;
      }
      return jsonOk({ account: sanitizeAccount(account) });
    }
    if (rest[1] === "import" && rest.length === 2 && method === "POST") {
      const body = await readJsonObject(req);
      if (typeof body.config !== "string" || body.config.trim().length === 0) {
        throw new ValidationError({ config: "must be a WireGuard .conf or wg:// URI" });
      }
      const parsed = parseWarpConfig(body.config);
      if (!parsed.ok) throw new ValidationError({ config: parsed.reason });
      if (parsed.amnezia_overrides !== null) {
        const check = validateAmnezia(parsed.amnezia_overrides);
        if (!check.ok) throw new ValidationError(check.fields);
      }
      const account = await buildAccount(env, body, parsed.config, parsed.amnezia_overrides);
      await storeAccount(env, account);
      return jsonOk({ account: sanitizeAccount(account) });
    }
    const id = rest[1];
    if (id !== undefined && UUID_RE.test(id)) {
      const account = await getAccount(env, id);
      if (account === null) throw new NotFoundError();
      if (rest.length === 2 && method === "GET") {
        return jsonOk({ account: sanitizeAccount(account) });
      }
      if (rest.length === 2 && method === "PUT") {
        const body = await readJsonObject(req);
        if (body.name !== undefined) account.name = requireString(body.name, "name");
        if (body.endpoint_list !== undefined) account.endpoint_list = await resolveEndpointList(env, body.endpoint_list);
        if (body.dns !== undefined) {
          account.dns = typeof body.dns === "string" && body.dns.trim().length > 0 ? body.dns.trim().slice(0, 253) : null;
        }
        if (body.amnezia_overrides !== undefined) {
          if (body.amnezia_overrides === null) {
            account.amnezia_overrides = null;
          } else {
            const check = validateAmnezia(body.amnezia_overrides as AmneziaParams);
            if (!check.ok) throw new ValidationError(check.fields);
            account.amnezia_overrides = check.value;
          }
        }
        await storeAccount(env, account);
        void purgeWarpSub(origin, account.token).catch(() => {});
        return jsonOk({ account: sanitizeAccount(account) });
      }
      if (rest.length === 2 && method === "DELETE") {
        await deleteAccount(env, account);
        void removeWarpDevice(account.warp_id, account.warp_token).catch(() => {});
        void purgeWarpSub(origin, account.token).catch(() => {});
        return jsonOk({ deleted: true });
      }
      if (rest.length === 3 && rest[2] === "regenerate-token" && method === "POST") {
        const oldToken = account.token;
        const token = await regenerateToken(env, account);
        afterResponse(purgeWarpSub(origin, oldToken));
        return jsonOk({ token });
      }
    }
  }

  if (rest[0] === "presets") {
    if (rest.length === 1 && method === "GET") {
      return jsonOk({ presets: await listPresets(env) });
    }
    if (rest.length === 1 && method === "POST") {
      const body = await readJsonObject(req);
      const presets = await listPresets(env);
      if (presets.length >= MAX_PRESETS) throw new ValidationError({ presets: "too many presets" });
      const preset: WarpPreset = {
        id: newSubToken(),
        name: requireString(body.name, "name"),
        dns: typeof body.dns === "string" && body.dns.trim().length > 0 ? body.dns.trim().slice(0, 253) : null,
        endpoints: parseEndpoints(body.endpoints, "endpoints"),
      };
      presets.push(preset);
      await savePresets(env, presets);
      void purgeAll();
      return jsonOk({ preset });
    }
    const id = rest[1];
    if (id !== undefined && rest.length === 2) {
      const presets = await listPresets(env);
      const index = presets.findIndex((p) => p.id === id);
      if (index < 0) throw new NotFoundError();
      if (method === "PUT") {
        const body = await readJsonObject(req);
        if (body.name !== undefined) presets[index]!.name = requireString(body.name, "name");
        if (body.endpoints !== undefined) presets[index]!.endpoints = parseEndpoints(body.endpoints, "endpoints");
        if (body.dns !== undefined) {
          presets[index]!.dns = typeof body.dns === "string" && body.dns.trim().length > 0 ? body.dns.trim().slice(0, 253) : null;
        }
        await savePresets(env, presets);
        void purgeAll();
        return jsonOk({ preset: presets[index] });
      }
      if (method === "DELETE") {
        const accounts = await listAccounts(env);
        const inUse = accounts.some((a) => a.endpoint_list.type === "preset" && a.endpoint_list.preset_id === id);
        if (inUse) throw new ValidationError({ preset: "preset is in use by an account" });
        presets.splice(index, 1);
        await savePresets(env, presets);
        void purgeAll();
        return jsonOk({ deleted: true });
      }
    }
  }

  if (rest[0] === "settings" && rest[1] === "amnezia") {
    if (rest.length === 2 && method === "GET") {
      const global = await getGlobalSettings(env);
      return jsonOk({ amnezia: global.amnezia });
    }
    if (rest.length === 2 && method === "PUT") {
      const body = await readJsonObject(req);
      if (body.amnezia === undefined || body.amnezia === null || typeof body.amnezia !== "object") {
        throw new ValidationError({ amnezia: "must be an object" });
      }
      const check = validateAmnezia(body.amnezia as AmneziaParams);
      if (!check.ok) throw new ValidationError(check.fields);
      await setGlobalSettings(env, { amnezia: check.value });
      void purgeAll();
      return jsonOk({ amnezia: check.value });
    }
  }

  throw new NotFoundError();
};
