import type { RouteHandler } from "../../types/context";
import { BadRequestError, UpstreamError } from "../../core/errors";
import { log } from "../../core/log";
import { jsonOk, readJsonObject } from "../../core/respond";
import { isLocalOrPrivateTarget } from "../../utils/net";
import {
  fetchPreferredText,
  parsePreferredList,
  type PreferredEntry,
  type PreferredInvalid,
} from "../../nodes/preferred";

export { fetchPreferredText };

export interface PreferredValidView {
  kind: PreferredEntry["kind"];
  host: string;
  port: number | null;
  remark: string;
  chain: string | null;
  proxyIp: boolean;
  wildcard: boolean;
  url: string;
  raw: string;
}

export interface PreferredValidateView {
  source: "url" | "text" | "stored";
  valid: PreferredValidView[];
  invalid: PreferredInvalid[];
}

export function serializePreferredEntry(e: PreferredEntry): PreferredValidView {
  return {
    kind: e.kind,
    host: e.host,
    port: e.port,
    remark: e.remark,
    chain: e.chain,
    proxyIp: e.proxyIp,
    wildcard: e.wildcard,
    url: e.url,
    raw: e.raw,
  };
}

function readRemoteUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// GET/POST preferred-list validator (getADDAPI-style): validates posted text,
// a fetched remote list, or — when neither is given — the stored
// customEndpoints. Auth + methods are enforced by the router descriptor.
export const handlePreferredValidate: RouteHandler = async (req, _env, s) => {
  let url: string | null = null;
  let text: string | null = null;
  if (req.method === "GET") {
    const query = new URL(req.url).searchParams;
    url = readRemoteUrl(query.get("url"));
    text = typeof query.get("text") === "string" ? query.get("text") : null;
  } else {
    const body = await readJsonObject(req);
    url = readRemoteUrl(body.url);
    text = typeof body.text === "string" ? body.text : null;
  }

  if (url !== null) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new BadRequestError("preferred url must be a valid http(s) URL");
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new BadRequestError("preferred url must be a valid http(s) URL");
    }
    if (isLocalOrPrivateTarget(target.hostname)) {
      throw new BadRequestError("preferred url must not target a local or private address");
    }
    const fetched = await fetchPreferredText(url);
    if (!fetched.ok) {
      // Never log the URL: query strings may carry tokens.
      log.error("api/preferred-validate", `remote list fetch failed for ${target.hostname} (${fetched.reason})`);
      throw new UpstreamError("preferred list unreachable");
    }
    const { valid, invalid } = parsePreferredList(fetched.value);
    const view: PreferredValidateView = {
      source: "url",
      valid: valid.map(serializePreferredEntry),
      invalid,
    };
    return jsonOk(view);
  }

  const source = text !== null ? "text" : "stored";
  const { valid, invalid } = parsePreferredList(text ?? s.customEndpoints.join("\n"));
  const view: PreferredValidateView = { source, valid: valid.map(serializePreferredEntry), invalid };
  return jsonOk(view);
};
