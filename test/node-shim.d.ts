/**
 * Scoped Node typings for tests/config ONLY.
 *
 * The root tsconfig intentionally lists only `@cloudflare/workers-types` in
 * `compilerOptions.types`, so no Node globals leak into the worker bundle.
 * These minimal ambient declarations type the handful of Node builtins used
 * by vitest config and unit tests (which run in Node, not workerd) without
 * pulling in @types/node. Worker src must stay free of `node:` imports —
 * enforced by test/config/node-purity.spec.ts. Do not import these from src/.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:child_process" {
  export interface ExecFileSyncOptions {
    cwd?: string;
    encoding?: "utf8";
    stdio?: string;
    maxBuffer?: number;
  }
  export function execFileSync(
    file: string,
    args: readonly string[],
    options: ExecFileSyncOptions & { encoding: "utf8" },
  ): string;
  export function execFileSync(file: string, args: readonly string[], options?: ExecFileSyncOptions): Uint8Array;
}

declare module "node:vm" {
  const vm: {
    createContext(sandbox: object): void;
    runInContext(code: string, context: object): unknown;
  };
  export default vm;
}

declare module "*build-single-file.mjs" {
  export function minifyHtmlAsset(html: string): string;
}
