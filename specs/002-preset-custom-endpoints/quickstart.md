# Quickstart: Preset + Custom Endpoints

**Feature**: `002-preset-custom-endpoints` | **Date**: 2026-09-17

Validation guide proving preset+custom endpoints end-to-end. Run in order
on a deployment built from this branch. See [data-model.md](data-model.md)
and [contracts/](contracts/) for expected shapes (not duplicated here).

## Prerequisites

- Clean deployment of this branch; admin session; fresh settings.
- A v2rayNG-style client and a sing-box client.

## Scenarios

### 1. Presets only, zero typing (5 min)

1. Open the endpoint section; tick two CDN presets; save.
2. Fetch base64 and sing-box subscriptions; import one into each client.
3. **Expected**: both connect; every config uses only the two ticked endpoints with valid ports; both outputs carry the same endpoint set (contracts/cdn-presets.md).

### 2. Custom paste, mixed valid/invalid (5 min)

1. Paste 5 valid `ip:port` lines + 2 invalid lines (one malformed, one out-of-family port); save.
2. **Expected**: save rejected with errors naming both bad lines; fix/remove them, save succeeds; configs include exactly the 5 valid addresses, verbatim.
3. Re-paste the same address in different case/format; **expected**: one node, not two (contracts/endpoint-validation.md).

### 3. Empty means hostname, never empty (2 min)

1. Untick all presets, clear custom box and `addresses[]`; save; fetch any subscription.
2. **Expected**: configs use the worker hostname; subscription is never empty.

### 4. WARP endpoints across families (5 min)

1. Set a custom WARP endpoint; download WireGuard, sing-box, v2rayn, and Throne outputs.
2. **Expected**: all four carry the custom endpoint with unchanged credentials (contracts/warp-endpoints.md).
3. Clear the custom list; re-fetch. **Expected**: `default` preset endpoint, never an empty config.

### 5. Failover through the pool (manual, 5 min)

1. Configure a proxyIP pool; block the direct route (e.g. firewall the origin or point at a dead test target).
2. **Expected**: connections succeed via pool entries with no admin action; dead pool entries are skipped.

### 6. Removed knobs stay gone (2 min)

1. Walk settings in English and Persian.
2. **Expected**: no NAT64, remote-DNS, or url-test controls; single DoH box present; fragment presets + custom box + fingerprint/SNI controls unchanged.

### 7. Verification loop green

1. Run type checks, the full test suite, build, and the UI walk.
2. **Expected**: all green; settings field count and endpoint behavior match the spec's measurable outcomes.
