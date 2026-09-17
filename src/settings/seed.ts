import type { Settings } from "../types/settings";
import { randomHex } from "../utils/random";

export function hasIdentity(s: Settings): boolean {
  return (
    s.securePath.length > 0 &&
    s.vlessUuid.length > 0 &&
    s.sessionSecret.length > 0
  );
}

export function fillIdentity(s: Settings): Settings {
  s.securePath ||= randomHex(12);
  s.vlessUuid ||= crypto.randomUUID();
  s.sessionSecret ||= randomHex(64);
  if (s.seededAt === 0) s.seededAt = Date.now();
  return s;
}
