# Contract: CDN Presets (Shipped Data)

**Feature**: `002-preset-custom-endpoints` | **Date**: 2026-09-17

## File

`src/nodes/cdn-presets.ts` exports `CDN_PRESETS: readonly CdnPreset[]`:

```ts
interface CdnPreset { id: string; label: string; ip: string; port: number }
```

## Rules

1. Every entry's port MUST be in the CF families (`tls ⇒ {443,2053,2083,2087,2096,8443}`, `plain ⇒ {80,8080,8880,2052,2082,2086,2095}`). Pinned by unit test — a violating entry fails CI.
2. `id` values are stable forever. Renaming an id orphans stored admin selections (which degrade to ignored, never error).
3. The file MUST NOT import anything (data only). A header comment cites constitution Principle IV as the invariant-X exception.
4. Generation consumes ONLY presets whose id appears in `Settings.cdnPresets`. Shipping an entry never changes any deployment's output until the admin ticks it.
5. This file is the ONLY place in `src/` (outside tests) where literal generation addresses may appear. The address-composition tests enforce the closed set: worker hostname + `addresses[]` + enabled presets + custom lines.
