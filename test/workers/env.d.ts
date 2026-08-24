import type { Env } from "../src/types/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
