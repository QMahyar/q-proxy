import { parseWireGuardConf } from "./wireguard";
import { parseWgUri } from "./uri";
import { parseWarpJson } from "./json";
import { fail, type ParseResult } from "./types";

export type { ParseOk, ParseFail, ParseResult } from "./types";
export { isValidIpv4Part, isValidIpv6Part, isValidAddressValue } from "./address";
export { decodeReservedTriplet } from "./amnezia";
export { parseEndpointHostPort } from "./address";
export { parseWireGuardConf } from "./wireguard";
export { parseWgUri } from "./uri";
export { parseWarpJson } from "./json";

export function parseWarpConfig(text: string): ParseResult {
  const trimmed = text.trim();
  if (/^(?:wg|wireguard):\/\//i.test(trimmed)) return parseWgUri(trimmed);
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return fail("invalid JSON config");
    }
    return parseWarpJson(parsed);
  }
  return parseWireGuardConf(trimmed);
}
