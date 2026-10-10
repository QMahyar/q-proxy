import type { Settings } from "../../types/settings";
import { DEFAULT_SETTINGS } from "../../types/settings";
import { SETTING_FIELD_DESCRIPTORS } from "../fields";
import { isPlainObject } from "../migrate";
import { applyAccessCustom, validateProxyIps } from "./access";
import { applyEndpointsCustom } from "./endpoints";
import { applyIntegrationsCustom, validateBootstrapConsistency } from "./integrations";
import { applySubscriptionCustom } from "./subscription";
import { applyGenericField, fail, type ValidationResult } from "./shared";
import { validateFragmentOrdering, applyTransportCustom } from "./transport";

export type { ValidationResult };
export { ECH_SERVER_NAME_RE, resolveEchServerName, type EchResolution } from "../../nodes/ech";

function applyCustomField(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): void {
  if (applyAccessCustom(path, patch, out, fields)) return;
  if (applyEndpointsCustom(path, patch, out, fields)) return;
  if (applyTransportCustom(path, patch, out, fields)) return;
  if (applySubscriptionCustom(path, patch, out, fields)) return;
  applyIntegrationsCustom(path, patch, out, fields);
}

export function validateSettings(input: unknown): ValidationResult {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!isPlainObject(input)) {
    return { ok: false, fields: { settings: "must be an object" } };
  }
  const patch = input;
  const fields: Record<string, string> = {};

  for (const { path, spec } of SETTING_FIELD_DESCRIPTORS) {
    if (!path.includes(".")) {
      if (spec.kind === "custom") applyCustomField(path, patch, out, fields);
      else applyGenericField(spec, patch, path, out, fields);
      continue;
    }
    const dot = path.indexOf(".");
    const parent = path.slice(0, dot);
    const sub = patch[parent];
    if (sub === undefined) continue;
    if (!isPlainObject(sub)) {
      fail(fields, parent, "must be an object");
      continue;
    }
    const nested = sub as Record<string, unknown>;
    const group = out[parent as keyof Settings];
    if (group === undefined || group === null || typeof group !== "object") continue;
    if (spec.kind === "custom") {
      const f: Record<string, string> = {};
      applyCustomField(path, nested, out, f);
      for (const [subKey, msg] of Object.entries(f)) {
        fail(fields, `${parent}.${subKey}`, msg);
      }
      continue;
    }
    const f: Record<string, string> = {};
    applyGenericField(spec, nested, path.slice(dot + 1), group, f);
    for (const msg of Object.values(f)) {
      fail(fields, path, msg);
    }
  }

  validateProxyIps(out, fields);
  validateFragmentOrdering(patch, out, fields);
  validateBootstrapConsistency(out, fields);

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  out.version = DEFAULT_SETTINGS.version;
  return { ok: true, value: out };
}
