import type { Settings } from "../types/settings";
import { randomHex, randomString, TROJAN_PASSWORD_CHARSET } from "../utils/random";

export function hasIdentity(s: Settings): boolean {
  return (
    s.securePath.length > 0 &&
    s.vlessUuid.length > 0 &&
    s.vmessUuid.length > 0 &&
    s.trojanPassword.length > 0 &&
    s.ssPassword.length > 0 &&
    s.sessionSecret.length > 0
  );
}

export function fillIdentity(s: Settings): Settings {
  s.securePath ||= randomHex(12);
  s.vlessUuid ||= crypto.randomUUID();
  s.vmessUuid ||= crypto.randomUUID();
  s.trojanPassword ||= randomString(24, TROJAN_PASSWORD_CHARSET);
  s.ssPassword ||= randomString(24);
  s.sessionSecret ||= randomHex(64);
  return s;
}
