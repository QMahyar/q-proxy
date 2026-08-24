import type { Env } from "./types/env";
import { routeRequest } from "./core/router";
import { bindCounterContext } from "./core/counters";
import { errorToResponse } from "./core/respond";
import { log } from "./core/log";
import { currentDebugEnabled, ensureInitialized } from "./settings/store";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      bindCounterContext(ctx);
      await ensureInitialized(env);
      return await routeRequest(req, env);
    } catch (err) {
      log.error("worker", `request failed: ${String(err)}`);
      return errorToResponse(err, currentDebugEnabled());
    }
  },
};
