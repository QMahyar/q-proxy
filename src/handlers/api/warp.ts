import type { RouteHandler } from "../../types/context";
import type { AppError } from "../../core/errors";
import type { AmneziaParams, WarpAccount, WarpConfig, WarpEndpoint, WarpPreset } from "../../types/warp";
import { ValidationError, NotFoundError, RateLimitedError } from "../../core/errors";
import { audit } from "../../core/log";
import { jsonOk, readJsonObject } from "../../core/respond";
import { clientIp } from "../../auth/guard";
import { parseWarpConfig, parseWarpJson, parseEndpointHostPort } from "../../warp/config";
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

function asAmneziaParams(value: unknown): AmneziaParams | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AmneziaParams;
}

function warpApiValidationError(err: WarpApiError): AppError {
  if (err.status === 429) {
    const retryAfter = err.retryAfterHeader !== null ? Number(err.retryAfterHeader) : undefined;
    return new RateLimitedError(
      retryAfter !== undefined && Number.isFinite(retryAfter) ? Math.ceil(retryAfter) : undefined,
      "Cloudflare WARP registration is rate-limited; retry later",
    );
  }
  if (err.status === 0) {
    return new ValidationError({ warp_api: "WARP registration timed out or the network was unreachable" });
  }
  if (err.status >= 400 && err.status < 500) {
    return new ValidationError({ warp_api: err.message });
  }
  return new ValidationError({ warp_api: err.message || "WARP API returned an unreadable registration response" });
}

function parseEndpoints(value: unknown, field: string): WarpEndpoint[] {
  if (!Array.isArray(value)) throw new ValidationError({ [field]: "must be an array" });
  if (value.length < 1 || value.length > MAX_ENDPOINTS) {
    throw new ValidationError({ [field]: `must contain 1-${MAX_ENDPOINTS} endpoints` });
  }
  const out: WarpEndpoint[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const endpoint = typeof item === "string" ? parseEndpointHostPort(item) : null;
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

async function buildAccount(
  env: Parameters<RouteHandler>[1],
  body: Record<string, unknown>,
  config: WarpAccount["config"],
  amnezia: AmneziaParams | null,
  defaultEndpointList?: WarpAccount["endpoint_list"],
): Promise<WarpAccount> {
  const name = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim().slice(0, 100) : `Account ${Date.now()}`;
  const endpoint_list =
    body.endpoint_list === undefined
      ? defaultEndpointList ?? ({ type: "preset", preset_id: "default" } as const)
      : await resolveEndpointList(env, body.endpoint_list);
  let dns: string | null = null;
  if (typeof body.dns === "string" && body.dns.trim().length > 0) {
    dns = body.dns.trim().slice(0, 253);
  }
  let amnezia_overrides: AmneziaParams | null = amnezia;
  if (body.amnezia_overrides !== undefined && body.amnezia_overrides !== null) {
    const shaped = asAmneziaParams(body.amnezia_overrides);
    if (shaped === null) throw new ValidationError({ amnezia_overrides: "must be an object" });
    const check = validateAmnezia(shaped);
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

export const handleWarpApi: RouteHandler = async (req, env, s) => {
  const url = new URL(req.url);
  const segs = url.pathname.split("/").filter((p) => p.length > 0);
  const warpIdx = segs.indexOf("warp", 1);
  const rest = warpIdx === -1 ? [] : segs.slice(warpIdx + 1);
  const method = req.method;
  await ensureWarpDefaults(env);
  const origin = url.origin;
  const purgeAll = () => purgeAllWarpSubs(env, origin, s.securePath).catch(() => {});

  if (rest[0] === "account") {
    if (rest.length === 1 && method === "GET") {
      const accounts = await listAccounts(env);
      return jsonOk({ accounts: accounts.map(sanitizeAccount) });
    }
    if (rest[1] === "generate" && rest.length === 2 && method === "POST") {
      if ((await listAccounts(env)).length >= 100) throw new ValidationError({ account: "too many warp accounts (max 100)" });
      const body = await readJsonObject(req);
      const account = await buildAccount(env, body, PLACEHOLDER_CONFIG, null);
      let reg: Awaited<ReturnType<typeof registerWarpDevice>>;
      try {
        reg = await registerWarpDevice();
      } catch (err) {
        if (err instanceof WarpApiError) throw warpApiValidationError(err);
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
      audit("warp.account.create", { ip: clientIp(req), id: account.id });
      return jsonOk({ account: sanitizeAccount(account) });
    }
    if (rest[1] === "import" && rest.length === 2 && method === "POST") {
      if ((await listAccounts(env)).length >= 100) throw new ValidationError({ account: "too many warp accounts (max 100)" });
      const body = await readJsonObject(req);
      const rawConfig = body.config;
      const parsed =
        typeof rawConfig === "string" && rawConfig.trim().length > 0
          ? parseWarpConfig(rawConfig)
          : parseWarpJson(rawConfig);
      if (!parsed.ok) throw new ValidationError({ config: parsed.reason });
      if (parsed.amnezia_overrides !== null) {
        const check = validateAmnezia(parsed.amnezia_overrides);
        if (!check.ok) throw new ValidationError(check.fields);
      }
      const defaultEndpointList: WarpAccount["endpoint_list"] | undefined =
        parsed.endpoints !== undefined && parsed.endpoints.length > 0
          ? { type: "custom", custom_endpoints: parsed.endpoints }
          : undefined;
      const account = await buildAccount(env, body, parsed.config, parsed.amnezia_overrides, defaultEndpointList);
      await storeAccount(env, account);
      audit("warp.account.import", { ip: clientIp(req), id: account.id });
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
            const shaped = asAmneziaParams(body.amnezia_overrides);
            if (shaped === null) throw new ValidationError({ amnezia_overrides: "must be an object" });
            const check = validateAmnezia(shaped);
            if (!check.ok) throw new ValidationError(check.fields);
            account.amnezia_overrides = check.value;
          }
        }
        await storeAccount(env, account);
        await purgeWarpSub(origin, s.securePath, account.token).catch(() => {});
        audit("warp.account.update", { ip: clientIp(req), id: account.id });
        return jsonOk({ account: sanitizeAccount(account) });
      }
      if (rest.length === 2 && method === "DELETE") {
        await deleteAccount(env, account);
        void removeWarpDevice(account.warp_id, account.warp_token).catch(() => {});
        await purgeWarpSub(origin, s.securePath, account.token).catch(() => {});
        audit("warp.account.delete", { ip: clientIp(req), id: account.id });
        return jsonOk({ deleted: true });
      }
      if (rest.length === 3 && rest[2] === "regenerate-token" && method === "POST") {
        const oldToken = account.token;
        const token = await regenerateToken(env, account);
        await Promise.all([
          purgeWarpSub(origin, s.securePath, oldToken).catch(() => {}),
          purgeWarpSub(origin, s.securePath, token).catch(() => {}),
        ]);
        audit("warp.account.regenerate-token", { ip: clientIp(req), id: account.id });
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
      audit("warp.preset.create", { ip: clientIp(req), id: preset.id });
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
        audit("warp.preset.update", { ip: clientIp(req), id });
        return jsonOk({ preset: presets[index] });
      }
      if (method === "DELETE") {
        const accounts = await listAccounts(env);
        const inUse = accounts.some((a) => a.endpoint_list.type === "preset" && a.endpoint_list.preset_id === id);
        if (inUse) throw new ValidationError({ preset: "preset is in use by an account" });
        presets.splice(index, 1);
        await savePresets(env, presets);
        void purgeAll();
        audit("warp.preset.delete", { ip: clientIp(req), id });
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
      const shaped = asAmneziaParams(body.amnezia);
      if (shaped === null) throw new ValidationError({ amnezia: "must be an object" });
      const check = validateAmnezia(shaped);
      if (!check.ok) throw new ValidationError(check.fields);
      await setGlobalSettings(env, { amnezia: check.value });
      void purgeAll();
      audit("warp.amnezia.update", { ip: clientIp(req) });
      return jsonOk({ amnezia: check.value });
    }
  }

  throw new NotFoundError();
};
