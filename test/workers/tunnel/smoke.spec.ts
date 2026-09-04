/// <reference path="../../../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { ratelimitKey } from "../../../src/users/ratelimit";
import { seed, testKv } from "../../helpers/seed";

const kv = testKv(env);

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
};

async function awaitClose(ws: WebSocket): Promise<void> {
  if (ws.readyState === 3) return;
  await new Promise<void>((resolve) => {
    ws.addEventListener("close", () => setTimeout(resolve, 0));
    ws.addEventListener("error", () => setTimeout(resolve, 0));
  });
}

describe("tunnel upgrade smoke", () => {
  it("rejects or gracefully closes a tunnel websocket instead of returning 5xx", async () => {
    const res = await SELF.fetch("https://example.com/vl/abcd1234efgh5678", {
      headers: UPGRADE_HEADERS,
    });
    expect([101, 200]).toContain(res.status);
    if (res.status === 101 && res.webSocket !== null) {
      const ws = res.webSocket;
      ws.accept();
      const closed = awaitClose(ws);
      try {
        ws.send(new Uint8Array([0x00]).buffer);
      } catch {}
      try {
        ws.close(1000);
      } catch {}
      await closed;
      expect([2, 3]).toContain(ws.readyState);
    } else {
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
    }
  });

  it("does not upgrade non-websocket requests on tunnel paths", async () => {
    const res = await SELF.fetch("https://example.com/vl/abcd1234efgh5678");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("returns 429 with Retry-After when the per-IP tunnel bucket is exhausted", async () => {
    await seed(kv, "smokepath");
    await kv.put(
      ratelimitKey("tunnel:unknown", Date.now()),
      JSON.stringify({ tokens: 0, updatedAt: Date.now() }),
    );
    const res = await SELF.fetch("https://example.com/vl/abcd1234efgh5678", {
      headers: UPGRADE_HEADERS,
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
