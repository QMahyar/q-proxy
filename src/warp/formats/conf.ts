import type { WarpEmitContext } from "../expand";
import type { AmneziaParams } from "../../types/warp";
import { zipStore } from "../zip";
import { sanitizeFilename } from "../expand";

const KEEPALIVE = 25;

function amneziaLines(amnezia: AmneziaParams): string[] {
  const lines: string[] = [];
  const int = (key: keyof AmneziaParams, out: string) => {
    const v = amnezia[key];
    if (typeof v === "number" && v > 0) lines.push(`${out} = ${v}`);
  };
  int("Jc", "Jc");
  int("Jmin", "Jmin");
  int("Jmax", "Jmax");
  int("S1", "S1");
  int("S2", "S2");
  int("S3", "S3");
  int("S4", "S4");
  for (const key of ["H1", "H2", "H3", "H4"] as const) {
    const v = amnezia[key];
    if (v === undefined || v === null || v === "" || v === 0) continue;
    lines.push(`${key} = ${v}`);
  }
  if (typeof amnezia.I1 === "string" && amnezia.I1.length > 0) lines.push(`I1 = ${amnezia.I1}`);
  return lines;
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
          `private_key=${account.config.private_key}`,
          `public_key=${account.config.peer_public_key}`,
          `local_address=${[row.v4Host, row.v6Host].filter((h) => h.length > 0).join("-")}`,
          `mtu=${account.config.mtu}`,
          `persistent_keepalive_interval=${KEEPALIVE}`,
        ];
        const [r0, r1, r2] = account.config.reserved;
        if (r0 !== 0 || r1 !== 0 || r2 !== 0) parts.push(`reserved=${r0}-${r1}-${r2}`);
        if (withAmnezia && ctx.amnezia !== null) {
          parts.push("enable_amnezia=true");
          for (const key of ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4"] as const) {
            const v = ctx.amnezia[key];
            if (typeof v === "number" && v > 0) parts.push(`${key.toLowerCase()}=${v}`);
          }
          for (const key of ["H1", "H2", "H3", "H4"] as const) {
            const v = ctx.amnezia[key];
            if (v === undefined || v === null || v === "" || v === 0) continue;
            parts.push(`${key.toLowerCase()}=${v}`);
          }
          if (typeof ctx.amnezia.I1 === "string" && ctx.amnezia.I1.length > 0) {
            parts.push(`i1=${encodeURIComponent(ctx.amnezia.I1)}`);
          }
        }
        parts.push(encodeURIComponent(row.tag));
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
