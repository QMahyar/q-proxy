import type { Settings } from "../types/settings";

export type TunnelKind = "vless" | "vmess" | "trojan" | "ss";

const TUNNEL_SUFFIX_RE = /^[A-Za-z0-9]{8,32}$/;

export function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((seg) => seg.length > 0);
}

export function identifyTunnel(pathname: string, s: Settings): TunnelKind | null {
  const segs = splitPath(pathname);
  if (segs.length !== 2) return null;
  const [prefix, suffix] = segs as [string, string];
  if (!TUNNEL_SUFFIX_RE.test(suffix)) return null;
  if (prefix === s.vlessPath) return "vless";
  if (prefix === s.vmessPath) return "vmess";
  if (prefix === s.trojanPath) return "trojan";
  if (prefix === s.ssPath) return "ss";
  return null;
}

export type ApiRouteName =
  | "auth-login"
  | "auth-logout"
  | "auth-setup"
  | "settings-get"
  | "settings-save"
  | "settings-reset"
  | "status"
  | "killswitch"
  | "suburls";

export type SecureRoute =
  | { kind: "root" }
  | { kind: "page"; page: "panel" | "login" }
  | { kind: "sub" }
  | { kind: "doh" }
  | { kind: "myip" }
  | { kind: "api"; api: ApiRouteName };

export function resolveSecureRoute(url: URL, s: Settings): SecureRoute | null {
  if (s.securePath.length === 0) return null;
  const segs = splitPath(url.pathname);
  if (segs[0] !== s.securePath) return null;
  const rest = segs.slice(1);
  if (rest.length === 0) return { kind: "root" };
  switch (rest[0]) {
    case "panel":
      return rest.length === 1 ? { kind: "page", page: "panel" } : null;
    case "login":
      return rest.length === 1 ? { kind: "page", page: "login" } : null;
    case "sub":
      return rest.length === 1 ? { kind: "sub" } : null;
    case "doh":
      return rest.length === 1 ? { kind: "doh" } : null;
    case "my-ip":
      return rest.length === 1 ? { kind: "myip" } : null;
    case "api": {
      if (rest.length < 2) return null;
      const sub = rest[1]!;
      if (sub === "login" && rest.length === 2) return { kind: "api", api: "auth-login" };
      if (sub === "logout" && rest.length === 2) return { kind: "api", api: "auth-logout" };
      if (sub === "setup" && rest.length === 2) return { kind: "api", api: "auth-setup" };
      if (sub === "status" && rest.length === 2) return { kind: "api", api: "status" };
      if (sub === "killswitch" && rest.length === 2) return { kind: "api", api: "killswitch" };
      if (sub === "suburls" && rest.length === 2) return { kind: "api", api: "suburls" };
      if (sub === "settings") {
        if (rest.length === 2) return { kind: "api", api: "settings-get" };
        if (rest.length === 3 && rest[2] === "save") return { kind: "api", api: "settings-save" };
        if (rest.length === 3 && rest[2] === "reset") return { kind: "api", api: "settings-reset" };
        return null;
      }
      return null;
    }
    default:
      return null;
  }
}

export function resolveHostname(s: Settings, url: URL): string {
  if (s.hostnameOverride.length > 0) return s.hostnameOverride;
  if (s.customDomains.length > 0) return s.customDomains[0]!;
  return url.hostname;
}
