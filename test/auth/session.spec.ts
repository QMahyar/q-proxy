import { beforeEach, describe, expect, it } from "vitest";
import {
  bumpSessionFloor,
  clearSessionFloorCache,
  getSessionFloor,
  issueSession,
  SESSION_TTL_SECONDS,
  verifySession,
} from "../../src/auth/session";
import type { Env } from "../../src/types/env";
import { bytesToHex, utf8Encode } from "../../src/utils/bytes";
import { encodeBase64Url } from "../../src/utils/base64";
import { unixNow } from "../../src/utils/time";

const SECRET = "unit-test-secret";

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8Encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8Encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

describe("session sign/verify", () => {
  it("roundtrips a freshly issued session", async () => {
    const token = await issueSession(SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.exp).toBeGreaterThan(unixNow());
    expect(payload!.exp).toBeLessThanOrEqual(unixNow() + SESSION_TTL_SECONDS + 1);
  });

  it("rejects a wrong signing secret", async () => {
    const token = await issueSession(SECRET);
    expect(await verifySession(token, "other-secret")).toBeNull();
  });

  it("rejects tampered payloads", async () => {
    const token = await issueSession(SECRET);
    const [payload, sig] = token.split(".");
    const evil = encodeBase64Url(JSON.stringify({ exp: unixNow() + 999_999 }));
    expect(await verifySession(`${evil}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(`${payload!.slice(0, -2)}aa.${sig}`, SECRET)).toBeNull();
  });

  it("rejects tampered signatures", async () => {
    const token = await issueSession(SECRET);
    const [payload, sig] = token.split(".");
    const flipped = sig!.startsWith("0") ? `1${sig!.slice(1)}` : `0${sig!.slice(1)}`;
    expect(await verifySession(`${payload}.${flipped}`, SECRET)).toBeNull();
    expect(await verifySession(`${payload}.${sig}00`, SECRET)).toBeNull();
  });

  it("rejects expired tokens even when correctly signed", async () => {
    const payload = encodeBase64Url(JSON.stringify({ exp: unixNow() - 10 }));
    const sig = await sign(payload);
    expect(await verifySession(`${payload}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects malformed or non-numeric payloads", async () => {
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("nodot", SECRET)).toBeNull();
    expect(await verifySession(".", SECRET)).toBeNull();
    expect(await verifySession(".sig", SECRET)).toBeNull();
    expect(await verifySession("payload.", SECRET)).toBeNull();

    const badJson = encodeBase64Url("not-json");
    expect(await verifySession(`${badJson}.${await sign(badJson)}`, SECRET)).toBeNull();

    const noExp = encodeBase64Url(JSON.stringify({ sub: "x" }));
    expect(await verifySession(`${noExp}.${await sign(noExp)}`, SECRET)).toBeNull();

    const strExp = encodeBase64Url(JSON.stringify({ exp: "soon" }));
    expect(await verifySession(`${strExp}.${await sign(strExp)}`, SECRET)).toBeNull();

    const strIat = encodeBase64Url(JSON.stringify({ exp: unixNow() + 100, iat: "early" }));
    expect(await verifySession(`${strIat}.${await sign(strIat)}`, SECRET)).toBeNull();
  });

  it("embeds the issue time as iat on freshly issued sessions", async () => {
    const token = await issueSession(SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload!.iat).toBeDefined();
    expect(payload!.iat!).toBeLessThanOrEqual(unixNow());
    expect(payload!.iat!).toBeGreaterThan(unixNow() - 10);
  });

  it("rejects tokens issued before the revocation floor", async () => {
    const payload = encodeBase64Url(JSON.stringify({ exp: unixNow() + 1000, iat: 500 }));
    const token = `${payload}.${await sign(payload)}`;
    expect(await verifySession(token, SECRET, 0)).not.toBeNull();
    expect(await verifySession(token, SECRET, 499)).not.toBeNull();
    expect(await verifySession(token, SECRET, 500)).toBeNull();
    expect(await verifySession(token, SECRET, 501)).toBeNull();
    expect(await verifySession(token, SECRET, unixNow() + 10)).toBeNull();
  });

  it("treats a missing iat as zero under the revocation floor", async () => {
    const payload = encodeBase64Url(JSON.stringify({ exp: unixNow() + 1000 }));
    const token = `${payload}.${await sign(payload)}`;
    expect(await verifySession(token, SECRET, 0)).not.toBeNull();
    expect(await verifySession(token, SECRET, 1)).toBeNull();
  });
});

describe("session revocation floor kv cache", () => {
  let stored: string | null;
  let reads: number;

  function makeEnv(): Env {
    return {
      QPROXY_KV: {
        get: async () => {
          reads += 1;
          return stored;
        },
        put: async (_key: string, value: string) => {
          stored = value;
        },
      },
    } as unknown as Env;
  }

  beforeEach(() => {
    stored = null;
    reads = 0;
    clearSessionFloorCache();
  });

  it("reads the floor from kv and memoizes it for subsequent calls", async () => {
    stored = String(unixNow() - 60);
    const env = makeEnv();
    expect(await getSessionFloor(env)).toBe(unixNow() - 60);
    expect(await getSessionFloor(env)).toBe(unixNow() - 60);
    expect(reads).toBe(1);
  });

  it("treats missing or non-numeric kv values as a zero floor", async () => {
    expect(await getSessionFloor(makeEnv())).toBe(0);
    stored = "not-a-number";
    clearSessionFloorCache();
    expect(await getSessionFloor(makeEnv())).toBe(0);
  });

  it("bumpSessionFloor persists the floor and serves it without re-reading kv", async () => {
    const env = makeEnv();
    await bumpSessionFloor(env);
    const at = Number(stored);
    expect(at).toBeGreaterThanOrEqual(unixNow() - 1);
    expect(await getSessionFloor(env)).toBe(at);
    expect(reads).toBe(0);
  });

  it("clearSessionFloorCache forces the next read back to kv", async () => {
    const env = makeEnv();
    await bumpSessionFloor(env);
    stored = "123";
    clearSessionFloorCache();
    expect(await getSessionFloor(env)).toBe(123);
    expect(reads).toBe(1);
  });
});
