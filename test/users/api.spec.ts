import { beforeEach, describe, expect, it } from "vitest";
import { handleUsersApi } from "../../src/handlers/api/users";
import { hashToken, listUsers, saveUsers, tokenHintFor, type UserAccount } from "../../src/users/store";

class FakeKV {
  map = new Map<string, string>();
  async get(key: string): Promise<unknown> {
    const raw = this.map.get(key);
    if (raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  asEnv() {
    return { QPROXY_KV: this } as unknown as { QPROXY_KV: FakeKV };
  }
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://example.com${path}`, init);
}

function jsonReq(path: string, method: string, body: unknown): Request {
  return req(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("users api handler", () => {
  let kv: FakeKV;
  let env: { QPROXY_KV: FakeKV };
  beforeEach(() => {
    kv = new FakeKV();
    env = kv.asEnv() as unknown as { QPROXY_KV: FakeKV };
  });

  it("parseLimit caps at 10000", async () => {
    const r = jsonReq("/api/users", "POST", { name: "Alice", dailyReqLimit: 10001 });
    await expect(handleUsersApi(r, env as never, {} as never)).rejects.toMatchObject({
      fields: expect.objectContaining({ dailyReqLimit: expect.stringContaining("10000") }),
    });
    const r2 = jsonReq("/api/users", "POST", { name: "Alice", dailyReqLimit: 10000 });
    const res2 = (await handleUsersApi(r2, env as never, {} as never)) as Response;
    const j2 = (await res2.json()) as { data: { user: Record<string, unknown> } };
    expect(j2.data.user.dailyReqLimit).toBe(10000);
  });

  it("parseExpiry caps at 10 years", async () => {
    const tooFar = Date.now() + 11 * 365 * 24 * 60 * 60 * 1000;
    const r = jsonReq("/api/users", "POST", { name: "Alice", expiresAt: tooFar });
    await expect(handleUsersApi(r, env as never, {} as never)).rejects.toMatchObject({
      fields: expect.objectContaining({ expiresAt: expect.any(String) }),
    });
    const okFar = Date.now() + 9 * 365 * 24 * 60 * 60 * 1000;
    const r2 = jsonReq("/api/users", "POST", { name: "Alice", expiresAt: okFar });
    const res2 = (await handleUsersApi(r2, env as never, {} as never)) as Response;
    const j2 = (await res2.json()) as { data: { user: Record<string, unknown> } };
    expect(j2.data.user.expiresAt).toBe(okFar);
  });

  it("enforces 50-cap on fresh KV read", async () => {
    const users: UserAccount[] = [];
    for (let i = 0; i < 50; i++) {
      const plain = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      const tokenHash = await hashToken(plain);
      users.push({
        id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
        name: `User${i}`,
        tokenHash,
        tokenHint: tokenHintFor(plain),
        enabled: true,
        expiresAt: null,
        dailyReqLimit: null,
        protocols: "all",
        createdAt: new Date().toISOString(),
      });
    }
    await saveUsers(env as never, users);
    const r = jsonReq("/api/users", "POST", { name: "Overflow" });
    await expect(handleUsersApi(r, env as never, {} as never)).rejects.toMatchObject({
      fields: expect.objectContaining({ limit: expect.stringContaining("50") }),
    });
    const listed = await listUsers(env as never);
    expect(listed.length).toBe(50);
  });

  it("create returns full token, list returns only tokenHint", async () => {
    const r = jsonReq("/api/users", "POST", { name: "Alice" });
    const res = (await handleUsersApi(r, env as never, {} as never)) as Response;
    const j = (await res.json()) as { data: { user: Record<string, unknown> } };
    expect(typeof j.data.user.token).toBe("string");
    expect((j.data.user.token as string)).toMatch(/^[0-9a-f]{8}-/);
    expect(typeof j.data.user.tokenHint).toBe("string");
    expect((j.data.user.tokenHint as string).endsWith("…")).toBe(true);
    expect((j.data.user as Record<string, unknown>).tokenHash).toBeUndefined();

    const listReq = req("/api/users", { method: "GET" });
    const listRes = (await handleUsersApi(listReq, env as never, {} as never)) as Response;
    const listJ = (await listRes.json()) as { data: { users: Record<string, unknown>[] } };
    expect(listJ.data.users.length).toBe(1);
    const listedUser = listJ.data.users[0]!;
    expect(listedUser.token).toBeUndefined();
    expect(listedUser.tokenHash).toBeUndefined();
    expect(typeof listedUser.tokenHint).toBe("string");
    expect((listedUser.tokenHint as string).endsWith("…")).toBe(true);
    expect(listedUser.tokenHint).toBe((j.data.user.token as string).slice(0, 8) + "…");
  });

  it("PUT does not expose token, regenerate returns new token with hint rotation", async () => {
    const create = jsonReq("/api/users", "POST", { name: "Bob" });
    const createRes = (await handleUsersApi(create, env as never, {} as never)) as Response;
    const createJ = (await createRes.json()) as { data: { user: { id: string; token: string; tokenHint: string } } };
    const id = createJ.data.user.id;
    const oldToken = createJ.data.user.token;
    const oldHint = createJ.data.user.tokenHint;
    const putReq = jsonReq(`/api/users/${id}`, "PUT", { name: "Bobby" });
    const putRes = (await handleUsersApi(putReq, env as never, {} as never)) as Response;
    const putJ = (await putRes.json()) as { data: { user: Record<string, unknown> } };
    expect(putJ.data.user.token).toBeUndefined();
    expect(typeof putJ.data.user.tokenHint).toBe("string");
    expect(putJ.data.user.tokenHint).toBe(oldHint);

    const regenReq = req(`/api/users/${id}/regenerate-token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const regenRes = (await handleUsersApi(regenReq, env as never, {} as never)) as Response;
    const regenJ = (await regenRes.json()) as { data: { token: string } };
    expect(typeof regenJ.data.token).toBe("string");
    expect(regenJ.data.token).not.toBe(oldToken);
    expect(regenJ.data.token.slice(0, 8) + "…").not.toBe(oldHint);

    const listAfter = await listUsers(env as never);
    expect(listAfter[0]!.tokenHint).toBe(regenJ.data.token.slice(0, 8) + "…");
  });

  it("tokenHint format is first 8 chars plus ellipsis", async () => {
    const r = jsonReq("/api/users", "POST", { name: "HintTest" });
    const res = (await handleUsersApi(r, env as never, {} as never)) as Response;
    const j = (await res.json()) as { data: { user: { token: string; tokenHint: string } } };
    expect(j.data.user.tokenHint).toBe(j.data.user.token.slice(0, 8) + "…");
  });
});
