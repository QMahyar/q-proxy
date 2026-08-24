import { describe, expect, it } from "vitest";
import { issueSession, SESSION_TTL_SECONDS, verifySession } from "../../src/auth/session";
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
  });
});
