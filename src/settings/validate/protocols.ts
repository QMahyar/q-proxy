import type { Settings } from "../../types/settings";
import { PATH_TOKEN_RE } from "../fields";
import { fail } from "./shared";

// Protocols domain: trojan/ss flags plus transport/framing toggles. Shadowsocks
// shares the vless WebSocket path by design (dispatched by handshake sniffing),
// so only trojanPath needs distinctness from vlessPath.
export function applyProtocolsCustom(
  path: string,
  patch: Record<string, unknown>,
  out: Settings,
  fields: Record<string, string>,
): boolean {
  if (path !== "trojanPassword" && path !== "trojanPath") return false;
  const password = typeof patch.trojanPassword === "string" ? patch.trojanPassword : out.trojanPassword;
  const trojanPath = typeof patch.trojanPath === "string" ? patch.trojanPath : out.trojanPath;
  const vlessPath = typeof patch.vlessPath === "string" ? patch.vlessPath : out.vlessPath;
  if (path === "trojanPassword") {
    if (typeof patch.trojanPassword !== "string") {
      if (patch.trojanPassword !== undefined) fail(fields, "trojanPassword", "must be a string");
    } else if (patch.trojanPassword.length > 128) {
      fail(fields, "trojanPassword", "must be at most 128 characters");
    } else {
      out.trojanPassword = patch.trojanPassword;
    }
  }
  if (path === "trojanPath") {
    if (typeof patch.trojanPath !== "string") {
      if (patch.trojanPath !== undefined) fail(fields, "trojanPath", "must be a string");
    } else if (patch.trojanPath.length === 0) {
      out.trojanPath = "";
    } else if (!PATH_TOKEN_RE.test(patch.trojanPath)) {
      fail(fields, "trojanPath", "must be 1-32 letters, digits, _ or -");
    } else {
      out.trojanPath = patch.trojanPath;
    }
  }
  const enabled = typeof patch.trojanEnabled === "boolean" ? patch.trojanEnabled : out.trojanEnabled;
  if (enabled) {
    if (password.length === 0 && fields.trojanPassword === undefined) {
      fail(fields, "trojanPassword", "is required when trojan is enabled");
    }
    if (trojanPath.length === 0 && fields.trojanPath === undefined) {
      fail(fields, "trojanPath", "is required when trojan is enabled");
    } else if (trojanPath.length > 0 && trojanPath === vlessPath && fields.trojanPath === undefined) {
      fail(fields, "trojanPath", "must differ from vlessPath");
    }
  }
  return true;
}
