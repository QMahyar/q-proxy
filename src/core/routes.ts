import type { Settings } from "../types/settings";

export type TunnelKind = "vless" | "vmess" | "trojan" | "ss";

const TUNNEL_SUFFIX_RE = /^[A-Za-z0-9]{8,32}$/;

export const HEALTHZ_PATH = "/healthz";

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
  | "auth-password"
  | "bootstrap"
  | "settings-get"
  | "settings-save"
  | "settings-reset"
  | "settings-export"
  | "settings-import"
  | "version-check"
  | "status"
  | "killswitch"
  | "suburls"
  | "warp"
  | "users"
  | "proxy-pool"
  | "address-probe"
  | "telegram-webhook"
  | "telegram-setup"
  | "telegram-remove";

export type SecureRoute =
  | { kind: "root" }
  | { kind: "page"; page: "panel" | "login" }
  | { kind: "sub" }
  | { kind: "warp-sub" }
  | { kind: "user-sub" }
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
      if (rest.length === 1) return { kind: "sub" };
      if (rest.length === 4 && rest[1] === "wg" && /^[0-9a-f-]{36}$/i.test(rest[2]!)) {
        return { kind: "warp-sub" };
      }
      if ((rest.length === 3 || rest.length === 4) && rest[1] === "u" && /^[0-9a-f-]{36}$/i.test(rest[2]!)) {
        return { kind: "user-sub" };
      }
      return null;
    case "doh":
      return rest.length === 1 ? { kind: "doh" } : null;
    case "my-ip":
      return rest.length === 1 ? { kind: "myip" } : null;
    case "telegram": {
      if (rest.length === 2 && rest[1] === "setup") return { kind: "api", api: "telegram-setup" };
      if (rest.length === 2 && rest[1] === "remove") return { kind: "api", api: "telegram-remove" };
      if (rest.length === 3 && rest[1] === "webhook" && /^[0-9a-f]{16}$/.test(rest[2]!)) {
        return { kind: "api", api: "telegram-webhook" };
      }
      return null;
    }
    case "api": {
      if (rest.length < 2) return null;
      const sub = rest[1]!;
      if (sub === "auth" && rest.length === 3) {
        const action = rest[2]!;
        if (action === "login") return { kind: "api", api: "auth-login" };
        if (action === "logout") return { kind: "api", api: "auth-logout" };
        if (action === "setup") return { kind: "api", api: "auth-setup" };
        if (action === "password") return { kind: "api", api: "auth-password" };
        return null;
      }
      if (sub === "login" && rest.length === 2) return { kind: "api", api: "auth-login" };
      if (sub === "logout" && rest.length === 2) return { kind: "api", api: "auth-logout" };
      if (sub === "setup" && rest.length === 2) return { kind: "api", api: "auth-setup" };
      if (sub === "status" && rest.length === 2) return { kind: "api", api: "status" };
      if (sub === "bootstrap" && rest.length === 2) return { kind: "api", api: "bootstrap" };
      if (sub === "killswitch" && rest.length === 2) return { kind: "api", api: "killswitch" };
      if (sub === "suburls" && rest.length === 2) return { kind: "api", api: "suburls" };
      if (sub === "warp" && rest.length >= 2) return { kind: "api", api: "warp" };
      if (sub === "users" && rest.length >= 2) return { kind: "api", api: "users" };
      if (sub === "proxy-pool" && rest.length === 2) return { kind: "api", api: "proxy-pool" };
      if (sub === "address-probe" && rest.length === 2) return { kind: "api", api: "address-probe" };
      if (sub === "version" && rest.length === 3 && rest[2] === "check") return { kind: "api", api: "version-check" };
      if (sub === "settings") {
        if (rest.length === 2) return { kind: "api", api: "settings-get" };
        if (rest.length === 3 && rest[2] === "save") return { kind: "api", api: "settings-save" };
        if (rest.length === 3 && rest[2] === "reset") return { kind: "api", api: "settings-reset" };
        if (rest.length === 3 && rest[2] === "export") return { kind: "api", api: "settings-export" };
        if (rest.length === 3 && rest[2] === "import") return { kind: "api", api: "settings-import" };
        return null;
      }
      return null;
    }
    default:
      return null;
  }
}

export function resolveHostname(s: Settings, url: URL): string {
  void s;
  return url.hostname;
}
