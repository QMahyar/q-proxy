import type { RouteHandler } from "../../types/context";
import { jsonOk } from "../../core/respond";
import { appVersion } from "../../settings/store";

const UPSTREAM_REPO = "QMahyar/Q-Proxy";
const TIMEOUT_MS = 8000;

function parseSemver(tag: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return 0;
}

export async function fetchLatestVersion(repo: string = UPSTREAM_REPO): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "q-proxy-panel" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown };
    return typeof body.tag_name === "string" ? body.tag_name : null;
  } catch {
    return null;
  }
}

export function evaluateUpdate(current: string, latest: string | null): { current: string; latest: string | null; updateAvailable: boolean } {
  const cur = parseSemver(current);
  const lat = latest !== null ? parseSemver(latest) : null;
  const available = cur !== null && lat !== null && compareSemver(lat, cur) > 0;
  return { current, latest, updateAvailable: available };
}

export const handleVersionCheck: RouteHandler = async () => {
  const latest = await fetchLatestVersion();
  return jsonOk(evaluateUpdate(appVersion(), latest));
};
