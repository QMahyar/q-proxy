let debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
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

export function audit(action: string, detail: Record<string, unknown>): void {
  log.info("audit", action, detail);
}
