import { hexToBytes } from "./bytes";

export function parseUuid(uuid: string): Uint8Array | null {
  const compact = uuid.replaceAll("-", "").toLowerCase();
  if (compact.length !== 32) return null;
  return hexToBytes(compact);
}