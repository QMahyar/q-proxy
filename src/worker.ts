import type { Env } from "./types/env";
import { routeRequest } from "./core/router";
import { bindCounterContext } from "./core/counters";
import { errorToResponse } from "./core/respond";
import { log } from "./core/log";
import { currentDebugEnabled, ensureInitialized, loadSettings } from "./settings/store";
import { runExpirySweep } from "./handlers/api/telegram";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      bindCounterContext(ctx);
      await ensureInitialized(env);
      return await routeRequest(req, env);
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code?: unknown }).code ?? "UNKNOWN") : "UNKNOWN";
      log.error("worker", "request failed", { code });
      return errorToResponse(err, currentDebugEnabled());
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await ensureInitialized(env);
      await runExpirySweep(env, await loadSettings(env));
    } catch {}
  },
};
