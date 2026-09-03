---
id: 01
title: Fix VMess AEAD interop and protocol wire bugs
type: task
status: open
branch: fix/protocol-interop
blocked_by: []
---

# Fix VMess AEAD interop and protocol wire bugs

## Question

Make VMess AEAD work with every real client and correct the remaining protocol wire bugs that truncate/interop-fail. Ground truth: `docs/research/04-protocol-formats.md` (Xray #91, v2rayN "ver 2" JSON).

## Current findings (from the protocol review — implement these)

1. ~~**[CRITICAL] VMess-AEAD request header nonce/length SWAPPED**~~ — **DISPROVEN (verified against Xray source).** The authoritative `XTLS/Xray-core proxy/vmess/aead/encrypt.go` `SealVMessAEADHeader` writes `authId(16) | sealedLen(18) | nonce(8) | payload`, and `OpenVMessAEADHeader` reads `sealedLen(18)` then `nonce(8)`. Q Proxy's `vmess-crypto.ts:157-158` does exactly that (`data.subarray(0,18)` = sealedLen, `data.subarray(18,26)` = nonce) and the sealer `:209` matches. **The code is correct; applying the "swap" would BREAK VMess for every client.** Do NOT change this. The original reviewer hallucinated the Xray layout. Keep the current round-trip test.
2. **[HIGH] VMess uplink size-field cap includes the 16-byte tag.** `src/protocols/vmess.ts:352-354` caps the on-wire 2-byte size (== payload+16) at `MAX_FRAME_LEN`, so payloads in `(16367, 16383]` throw mid-transfer. Fix: validate the payload: `if (sizeVal - tagLen - padding < 0 || sizeVal - tagLen - padding > MAX_FRAME_LEN)`.
3. **[HIGH] Trojan UDP ASSOCIATE handshake address/port is enforced**. `src/protocols/trojan.ts:91-93` requires port 53; `src/protocols/common.ts:158` rejects port 0 ("invalid port 0"). Real clients send `0.0.0.0:0`. Fix: skip the addr/port gate for `cmd 0x03` (enforce port 53 on the per-datagram frames in the codec), and allow `port === 0` for ASSOCIATE only.
4. **[HIGH-SUSPECT] VMess response-header option byte hard-coded `0x00`** — `src/protocols/vmess-crypto.ts:224` via `vmess.ts:272-277`. Xray echoes the negotiated request-option bits so the client knows the downlink is masked-chunked. Fix: pass the request `option` bits (at minimum `option & 0x05`) into `sealVmessAeadResponseHeader`. Leave a resolution note that this still needs a live v2rayNG capture to fully confirm.

## Constraints

- Do not change the VLESS/Trojan/SS wire formats (they are byte-faithful and interop-tested).
- Keep parsers throwing-never; keep the `initialPayload ?? rest` first-packet-once invariant.
- Do not touch `docs/ARCHITECTURE.md` or share-URI/emitter output.

## Verify

`npm run typecheck` then `npx vitest run --project unit` (protocol specs). Add/adjust unit tests where the fix needs one.
