import { describe, expect, it } from "vitest";
import { handleLogin } from "../../../src/handlers/api/auth";
import { UnauthorizedError } from "../../../src/core/errors";
import { hashPassword } from "../../../src/auth/password";
import { SETTINGS_VERSION } from "../../../src/types/settings";
import { makeTestSettings } from "../../helpers/settings";

class FakeKV {
  map = new Map<string, string>();
  async get(key: string, type?: unknown): Promise<unknown> {
    const raw = this.map.get(key);
    if (raw === undefined) return null;
    if (type === "json" || (typeof type === "object" && type !== null && (type as { type?: unknown }).type === "json")) {
      return JSON.parse(raw);
    }
    return raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function loginRequest(password: string): Request {
  return new Request("https://panel.test/sp/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("handleLogin credential freshness", () => {
  it("rejects the old password and accepts the current one when the passed-in settings are stale", async () => {
    const kv = new FakeKV();
    const secret = "s".repeat(64);
    const oldCreds = await hashPassword("old-pass-11", secret);
    const currentCreds = await hashPassword("new-pass-99", secret);
    const stored = makeTestSettings({
      passwordHash: currentCreds.hash,
      passwordSalt: currentCreds.salt,
      sessionSecret: secret,
    });
    kv.map.set(
      "qproxy:settings",
      JSON.stringify({ version: SETTINGS_VERSION, updatedAt: Date.now(), rev: 7, data: stored }),
    );
    const stale = makeTestSettings({
      passwordHash: oldCreds.hash,
      passwordSalt: oldCreds.salt,
      sessionSecret: secret,
    });
    const env = { QPROXY_KV: kv } as never;

    const oldCall = handleLogin(loginRequest("old-pass-11"), env, stale as never);
    await expect(oldCall).rejects.toBeInstanceOf(UnauthorizedError);

    const currentRes = await handleLogin(loginRequest("new-pass-99"), env, stale as never);
    expect(currentRes.status).toBe(200);
    expect(currentRes.headers.get("Set-Cookie")).toContain("q_session=");
  });

  it("answers SETUP_REQUIRED when no password is stored", async () => {
    const kv = new FakeKV();
    const stored = makeTestSettings({ passwordHash: null, passwordSalt: null });
    kv.map.set(
      "qproxy:settings",
      JSON.stringify({ version: SETTINGS_VERSION, updatedAt: Date.now(), rev: 1, data: stored }),
    );
    const res = await handleLogin(loginRequest("anything-1"), { QPROXY_KV: kv } as never, stored as never);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SETUP_REQUIRED");
  });
});
