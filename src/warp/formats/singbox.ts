import type { WarpEmitContext } from "../expand";
import { amneziaEntries } from "./amnezia";

function amneziaWg(amnezia: WarpEmitContext["amnezia"]): Record<string, number | string> | null {
  if (amnezia === null) return null;
  const out: Record<string, number | string> = {};
  for (const [key, value] of amneziaEntries(amnezia)) out[key.toLowerCase()] = value;
  return Object.keys(out).length > 0 ? out : null;
}

export function emitSingbox(ctx: WarpEmitContext): string {
  const { account } = ctx;
  const amz = ctx.amneziaEnabled ? amneziaWg(ctx.amnezia) : null;
  const endpoints = ctx.rows.map((row) => {
    const peer: Record<string, unknown> = {
      address: row.ip,
      port: row.port,
      public_key: account.config.peer_public_key,
      allowed_ips: row.allowedIps,
      persistent_keepalive_interval: 25,
    };
    const [r0, r1, r2] = account.config.reserved;
    if (r0 !== 0 || r1 !== 0 || r2 !== 0) peer.reserved = [r0, r1, r2];
    const entry: Record<string, unknown> = {
      type: "wireguard",
      tag: row.tag,
      address: row.addressCidr,
      private_key: account.config.private_key,
      mtu: account.config.mtu,
      workers: 4,
      peers: [peer],
    };
    if (amz !== null) entry.amnezia_wg = amz;
    return entry;
  });
  const doc: Record<string, unknown> = { endpoints };
  if (endpoints.length > 0) doc.route = { final: (endpoints[0] as Record<string, unknown>).tag };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
