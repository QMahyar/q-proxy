import type { WarpEmitContext } from "../expand";

function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function yamlList(values: string[]): string {
  return `[${values.map(yamlString).join(",")}]`;
}

function amneziaOption(ctx: WarpEmitContext, indent: string): string[] {
  if (ctx.amnezia === null) return [];
  const lines: string[] = [];
  const entries: Array<[string, string]> = [];
  for (const key of ["Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4"] as const) {
    const v = ctx.amnezia[key];
    if (typeof v === "number" && v > 0) entries.push([key.toLowerCase(), String(v)]);
  }
  for (const key of ["H1", "H2", "H3", "H4"] as const) {
    const v = ctx.amnezia[key];
    if (v === undefined || v === null || v === "" || v === 0) continue;
    entries.push([key.toLowerCase(), String(v)]);
  }
  if (entries.length === 0) return [];
  lines.push(`${indent}amnezia-wg-option:`);
  for (const [k, v] of entries) lines.push(`${indent}  ${k}: ${yamlString(v)}`);
  return lines;
}

export function emitClash(ctx: WarpEmitContext, withAmnezia: boolean): string {
  const { account } = ctx;
  const [r0, r1, r2] = account.config.reserved;
  const lines: string[] = ["proxies:"];
  for (const row of ctx.rows) {
    lines.push(`  - name: ${yamlString(row.tag)}`);
    lines.push(`    type: wireguard`);
    lines.push(`    server: ${row.ip}`);
    lines.push(`    port: ${row.port}`);
    if (row.v4Host.length > 0) lines.push(`    ip: ${row.v4Host}`);
    if (row.v6Host.length > 0) lines.push(`    ipv6: ${row.v6Host}`);
    lines.push(`    private-key: ${yamlString(account.config.private_key)}`);
    lines.push(`    public-key: ${yamlString(account.config.peer_public_key)}`);
    lines.push(`    allowed-ips: ${yamlList(row.allowedIps)}`);
    lines.push(`    udp: true`);
    if (r0 !== 0 || r1 !== 0 || r2 !== 0) lines.push(`    reserved: [${r0},${r1},${r2}]`);
    lines.push(`    mtu: ${account.config.mtu}`);
    lines.push(`    persistent-keepalive: 25`);
    if (withAmnezia) lines.push(...amneziaOption(ctx, "    "));
  }
  return `${lines.join("\n")}\n`;
}

export function emitSurge(ctx: WarpEmitContext, surfboard: boolean): string {
  const { account } = ctx;
  const [r0, r1, r2] = account.config.reserved;
  const hasReserved = r0 !== 0 || r1 !== 0 || r2 !== 0;
  const out: string[] = ["[Proxy]"];
  for (const row of ctx.rows) out.push(`${row.tag} = wireguard, section-name=${row.tag}`);
  for (const row of ctx.rows) {
    out.push("");
    out.push(`[WireGuard ${row.tag}]`);
    out.push(`private-key = ${account.config.private_key}`);
    if (row.v4Host.length > 0) out.push(`self-ip = ${row.v4Host}`);
    if (!surfboard && row.v6Host.length > 0) out.push(`self-ip-v6 = ${row.v6Host}`);
    out.push(`dns-server = ${row.dns}`);
    out.push(`mtu = ${account.config.mtu}`);
    const peerParts = [
      `public-key = ${account.config.peer_public_key}`,
      `allowed-ips = "${row.allowedIps.join(", ")}"`,
      `endpoint = ${row.endpoint}`,
      `keepalive = 25`,
    ];
    if (!surfboard && hasReserved) peerParts.push(`client-id = ${r0}/${r1}/${r2}`);
    out.push(`peer = (${peerParts.join(", ")})`);
  }
  return `${out.join("\n")}\n`;
}

export function emitLoon(ctx: WarpEmitContext): string {
  const { account } = ctx;
  const [r0, r1, r2] = account.config.reserved;
  return (
    ctx.rows
      .map((row) => {
        const peers = `{public-key=${JSON.stringify(account.config.peer_public_key)},allowed-ips=${JSON.stringify(row.allowedIps.join(", "))},endpoint=${row.endpoint},reserved=[${r0},${r1},${r2}]}`;
        return [
          `${row.tag} = wireguard`,
          `interface-ip=${row.v4Host}`,
          `interface-ipv6=${row.v6Host}`,
          `private-key=${JSON.stringify(account.config.private_key)}`,
          `mtu=${account.config.mtu}`,
          `dns=${row.dns}`,
          `dnsv6=${row.dns}`,
          `keepalive=25`,
          `peers=[${peers}]`,
        ].join(",");
      })
      .join("\n") + "\n"
  );
}

export function emitEgern(ctx: WarpEmitContext): string {
  const { account } = ctx;
  const [r0, r1, r2] = account.config.reserved;
  const lines: string[] = ["proxies:"];
  for (const row of ctx.rows) {
    lines.push(`  - wireguard:`);
    lines.push(`      name: ${yamlString(row.tag)}`);
    lines.push(`      server: ${row.ip}`);
    lines.push(`      port: ${row.port}`);
    lines.push(`      private_key: ${yamlString(account.config.private_key)}`);
    lines.push(`      peer_public_key: ${yamlString(account.config.peer_public_key)}`);
    if (account.config.addresses.ipv4) lines.push(`      local_ipv4: ${account.config.addresses.ipv4}`);
    if (account.config.addresses.ipv6) lines.push(`      local_ipv6: ${account.config.addresses.ipv6}`);
    if (r0 !== 0 || r1 !== 0 || r2 !== 0) lines.push(`      reserved: [${r0},${r1},${r2}]`);
  }
  return `${lines.join("\n")}\n`;
}
