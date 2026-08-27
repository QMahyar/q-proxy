# ADR-001: Single-file bundle with zero runtime dependencies

## Status
Accepted

## Date
2026-08-24

## Context
Q Proxy must deploy two ways: dashboard paste of one file into Cloudflare's Worker editor, and `wrangler deploy`. The Worker runs on Cloudflare's V8 isolate with no `node_modules` at runtime. Bundle size and cold-start matter; the free tier must not pay for D1/DO or external crypto libraries. Key requirements:
- One file `dist/q-proxy.js` pasteable into dashboard (no upload of `node_modules` or assets)
- Deterministic build that rejects bare imports except `cloudflare:*`
- Bilingual panel as HTML strings (no framework) — same artifact for both deploy paths

## Decision
Ship a single ESM bundle via esbuild (`scripts/build-single-file.mjs`, `format: esm`, `platform: browser`, `target: es2023`, `.html` loader as text, `__APP_VERSION__` define). `package.json` lists only `devDependencies`; `docs/ARCHITECTURE.md §0.1` forbids runtime deps. Build asserts no bare import except `cloudflare:*`. `wrangler.toml` `main = "dist/q-proxy.js"` and `src/worker.ts` is the sole entry point (default export only there). Panel assets (`panel.html`, `login.html`, `camo.html`) are imported as text via `src/ui/assets.ts` (`*.html` module decl in `src/types/global.d.ts`).

## Alternatives Considered

### Normal npm runtime deps (zod, uuid, noble-curves, yaml)
- Pros: Less hand-rolled code, faster feature work
- Cons: Bundle grows, dashboard paste becomes manual vendor juggling, supply-chain risk, `esbuild` external handling for Workers is fragile
- Rejected: Breaks the single-file dashboard story that is the primary deploy path in `README.md` Quickstart

### Multiple chunks / Workers Sites + R2 assets
- Pros: Smaller per-request payload, asset caching
- Cons: Dashboard paste impossible; requires Sites or R2 binding; two artifacts to keep in sync
- Rejected: Violates `AGENTS.md` Boundary "Never add a runtime dependency" and the one-KV-namespace invariant

### Vite / unplugin instead of esbuild API
- Pros: Framework conveniences
- Cons: Heavier build, less control over the bare-import assertion
- Rejected: esbuild's `onResolve` hook gives the exact assertion we need (`scripts/build-single-file.mjs:verifyNoBareImports`)

## Consequences
- Bundle is ~400 KB single file (`npm run build`); same artifact for dashboard and `wrangler deploy`
- Crypto lacking in WebCrypto must be hand-rolled: `src/crypto/x25519.ts` (RFC 7748), `src/crypto/chacha20.ts`, `src/crypto/md5.ts`, `src/crypto/sha224.ts`, `src/crypto/kdf.ts` — each proven by RFC test vectors in `test/crypto/*`
- No `node_modules` at runtime — import mistakes fail the build, not at deploy
- Panel stays as HTML strings (no framework); edits require surgical changes to `src/ui/panel.html` per `CONTEXT.md` Gotchas
- Adding a dependency requires an architecture revision; CI would not catch it without the build assertion

## References
- `scripts/build-single-file.mjs` — build + assertion
- `docs/ARCHITECTURE.md §0.1`, `§8` — frozen zero-deps + build reproducibility
- `AGENTS.md` Boundaries — "Never add a runtime dependency to `package.json`"
