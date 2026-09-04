let debugEnabled = false;
let auditCtx: ExecutionContext | null = null;

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

export function bindAuditContext(ctx: ExecutionContext): void {
  auditCtx = ctx;
}

function track(p: Promise<unknown>): void {
  const tracked = p.then(
    () => undefined,
    () => undefined,
  );
  if (auditCtx === null) {
    void tracked;
    return;
  }
  try {
    auditCtx.waitUntil(tracked);
  } catch {
    void tracked;
  }
}

function emit(level: "debug" | "info" | "error", scope: string, message: string, extra?: unknown): void {
  const entry = { t: Date.now(), level, scope, message };
  if (level === "debug" && !debugEnabled) return;
  const line = extra === undefined ? JSON.stringify(entry) : JSON.stringify({ ...entry, extra: safe(extra) });
  if (level === "error") console.error(line);
  else console.log(line);
}

function safe(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (scope: string, message: string, extra?: unknown) => emit("debug", scope, message, extra),
  info: (scope: string, message: string, extra?: unknown) => emit("info", scope, message, extra),
  error: (scope: string, message: string, extra?: unknown) => emit("error", scope, message, extra),
};

function auditDetailJson(detail: Record<string, unknown>): string {
  try {
    return JSON.stringify(detail);
  } catch {
    return "{}";
  }
}

export function audit(
  action: string,
  detail: Record<string, unknown>,
  env?: { QPROXY_DB?: D1Database | null },
): void {
  log.info("audit", action, detail);
  const db = env?.QPROXY_DB;
  if (db === undefined || db === null) return;
  const ip = typeof detail.ip === "string" ? detail.ip : "";
  const run = db
    .prepare("INSERT INTO audit_log(ts, ip, action, detail) VALUES(?, ?, ?, ?)")
    .bind(Date.now(), ip, action, auditDetailJson(detail))
    .run()
    .then(
      () => undefined,
      () => undefined,
    );
  track(run);
}
