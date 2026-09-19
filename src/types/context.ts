import type { Settings } from "./settings";

export type RouteHandler = (req: Request, env: Env, s: Settings, ctx?: ExecutionContext | null) => Promise<Response>;

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
