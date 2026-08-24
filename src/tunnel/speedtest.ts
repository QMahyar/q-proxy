import { utf8Encode } from "../utils/bytes";

const SPEEDTEST_HOSTS = new Set(["speed.cloudflare.com", "cp.cloudflare.com"]);

const RESPONSE_TEXT =
  "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n";

export function matchesSpeedtestHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.+$/, "");
  return SPEEDTEST_HOSTS.has(normalized);
}

export function speedtestResponseBytes(): Uint8Array {
  return utf8Encode(RESPONSE_TEXT);
}
