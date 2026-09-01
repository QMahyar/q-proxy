import type { WarpEmitContext } from "../expand";
import { zipStore } from "../zip";
import { sanitizeFilename } from "../expand";
import { amneziaEntries } from "./amnezia";

const KEEPALIVE = 25;

function amneziaLines(amnezia: NonNullable<WarpEmitContext["amnezia"]>): string[] {
  return amneziaEntries(amnezia).map(([key, value]) => `${key} = ${value}`);
}

function confFor(ctx: WarpEmitContext, index: number, withAmnezia: boolean): { name: string; content: string } {
  const row = ctx.rows[index]!;
  const { account } = ctx;
  const lines: string[] = ["[Interface]"];
  lines.push(`PrivateKey = ${account.config.private_key}`);
  lines.push(`Address = ${row.addressCidr.join(", ")}`);
  lines.push(`DNS = ${row.dns}`);
  lines.push(`MTU = ${account.config.mtu}`);
  if (withAmnezia && ctx.amnezia !== null) lines.push(...amneziaLines(ctx.amnezia));
  lines.push("[Peer]");
  lines.push(`PublicKey = ${account.config.peer_public_key}`);
  lines.push(`AllowedIPs = ${row.allowedIps.join(", ")}`);
  lines.push(`Endpoint = ${row.endpoint}`);
  lines.push(`PersistentKeepalive = ${KEEPALIVE}`);
  const [r0, r1, r2] = account.config.reserved;
  if (r0 !== 0 || r1 !== 0 || r2 !== 0) lines.push(`# Reserved = ${r0},${r1},${r2}`);
  return { name: `${sanitizeFilename(row.tag)}-${sanitizeFilename(row.ip)}-${row.port}.conf`, content: `${lines.join("\n")}\n` };
}

export function emitWireguardConfZip(ctx: WarpEmitContext): Uint8Array {
  const files: Record<string, string> = {};
  ctx.rows.forEach((_, i) => {
    const f = confFor(ctx, i, false);
    files[f.name] = f.content;
  });
  return zipStore(files);
}

export function emitWireguardConfAmneziaZip(ctx: WarpEmitContext): Uint8Array {
  const files: Record<string, string> = {};
  ctx.rows.forEach((_, i) => {
    const f = confFor(ctx, i, true);
    files[f.name] = f.content;
  });
  return zipStore(files);
}

export function emitThrone(ctx: WarpEmitContext, withAmnezia: boolean): string {
  const { account } = ctx;
  return (
    ctx.rows
      .map((row) => {
        const parts = [
          `wg://${row.endpoint}`,
          `private_key=${encodeURIComponent(account.config.private_key)}`,
          `public_key=${encodeURIComponent(account.config.peer_public_key)}`,
          `local_address=${[row.v4Host, row.v6Host].filter((h) => h.length > 0).join("-")}`,
          `mtu=${account.config.mtu}`,
          `persistent_keepalive_interval=${KEEPALIVE}`,
        ];
        const [r0, r1, r2] = account.config.reserved;
        if (r0 !== 0 || r1 !== 0 || r2 !== 0) parts.push(`reserved=${r0}-${r1}-${r2}`);
        if (withAmnezia && ctx.amnezia !== null) {
          parts.push("enable_amnezia=true");
          for (const [key, value] of amneziaEntries(ctx.amnezia)) {
            if (key === "I1") parts.push(`i1=${encodeURIComponent(value)}`);
            else parts.push(`${key.toLowerCase()}=${value}`);
          }
        }
        parts.push(`#${encodeURIComponent(row.tag)}`);
        return `${parts[0]}?${parts.slice(1).join("&")}`;
      })
      .join("\n") + "\n"
  );
}

export function emitWireguardUri(ctx: WarpEmitContext): string {
  const { account } = ctx;
  return (
    ctx.rows
      .map((row) => {
        const query = [
          `publickey=${encodeURIComponent(account.config.peer_public_key)}`,
          `address=${encodeURIComponent(row.addressCidr.join(", "))}`,
          `mtu=${account.config.mtu}`,
        ];
        const [r0, r1, r2] = account.config.reserved;
        if (r0 !== 0 || r1 !== 0 || r2 !== 0) query.push(`reserved=${r0},${r1},${r2}`);
        return `wireguard://${encodeURIComponent(account.config.private_key)}@${row.endpoint}?${query.join("&")}#${encodeURIComponent(row.tag)}`;
      })
      .join("\n") + "\n"
  );
}

export function emitV2rayN(ctx: WarpEmitContext): string {
  return btoa(emitWireguardUri(ctx));
}
