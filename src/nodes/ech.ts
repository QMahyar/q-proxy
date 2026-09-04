import type { Settings } from "../types/settings";

export const ECH_SERVER_NAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export interface EchResolution {
  name: string | null;
  warning: string | null;
}

export function resolveEchServerName(
  s: Pick<Settings, "echEnabled" | "echAuto" | "echServerName">,
  sni: string | null,
): EchResolution {
  if (!s.echEnabled) return { name: null, warning: null };
  const manual = s.echServerName.trim();
  if (manual.length > 0) return { name: manual, warning: null };
  const candidate = (sni ?? "").trim();
  if (ECH_SERVER_NAME_RE.test(candidate)) return { name: candidate, warning: null };
  if (!s.echAuto) return { name: candidate.length > 0 ? candidate : null, warning: null };
  return {
    name: null,
    warning: "ech server name is unresolvable: set a manual name or use a hostname SNI",
  };
}
