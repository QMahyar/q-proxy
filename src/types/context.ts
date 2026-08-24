import type { Env } from "./env";
import type { Settings } from "./settings";

export type RouteHandler = (req: Request, env: Env, s: Settings) => Promise<Response>;

export interface NodeBuilderContext {
  settings: Settings;
  hostname: string;
  request: Request;
}

export interface UsageSnapshot {
  day: string;
  requestsToday: number;
  requestsTotal: number;
}
