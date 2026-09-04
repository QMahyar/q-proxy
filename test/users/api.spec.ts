import { beforeEach, describe, expect, it } from "vitest";
import { handleUsersApi } from "../../src/handlers/api/users";
import { routeRequest } from "../../src/core/router";
import { clearSessionFloorCache, issueSession } from "../../src/auth/session";
import { SETTINGS_KEY, invalidateSettingsCache } from "../../src/settings/store";
import { makeTestSettings } from "../helpers/settings";
import {
  consumeUserHit,
  hashToken,
  listUsers,
  saveUsers,
  tokenHintFor,
  clearUsersMemoForTests,
  clearUserActivityForTests,
  clearUserTotalsForTests,
  type UserAccount,
} from "../../src/users/store";
import { dayKeyUtc } from "../../src/utils/time";

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
    clearUsersMemoForTests();
    clearUserActivityForTests();
    clearUserTotalsForTests();
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

  it("create exposes the full token once; the list only exposes the hint, not the token", async () => {
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

  it("PUT preserves token, regenerate returns new token with hint rotation", async () => {
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
    expect(Object.prototype.hasOwnProperty.call(listAfter[0]!, "token")).toBe(false);
  });

  it("tokenHint format is first 8 chars plus ellipsis", async () => {
    const r = jsonReq("/api/users", "POST", { name: "HintTest" });
    const res = (await handleUsersApi(r, env as never, {} as never)) as Response;
    const j = (await res.json()) as { data: { user: { token: string; tokenHint: string } } };
    expect(j.data.user.tokenHint).toBe(j.data.user.token.slice(0, 8) + "…");
  });

  it("create accepts addressOverride and returns it in sanitized output", async () => {
    const r = jsonReq("/api/users", "POST", {
      name: "Pinned",
      addressOverride: { address: "1.2.3.4", port: 2053, host: "cdn.example.com", sni: "sni.example.com", label: "Clean" },
    });
    const res = (await handleUsersApi(r, env as never, {} as never)) as Response;
    const j = (await res.json()) as { data: { user: Record<string, unknown> } };
    expect(j.data.user.addressOverride).toEqual({
      address: "1.2.3.4",
      port: 2053,
      host: "cdn.example.com",
      sni: "sni.example.com",
      label: "Clean",
    });
    const stored = (await listUsers(env as never))[0]!;
    expect(stored.addressOverride).toEqual(j.data.user.addressOverride);
  });

  it("create defaults addressOverride to null when omitted", async () => {
    const r = jsonReq("/api/users", "POST", { name: "NoPin" });
    const res = (await handleUsersApi(r, env as never, {} as never)) as Response;
    const j = (await res.json()) as { data: { user: Record<string, unknown> } };
    expect(j.data.user.addressOverride).toBeNull();
  });

  it("create rejects invalid overrides", async () => {
    for (const bad of [
      { address: "" },
      { address: "not a host!" },
      { address: "1.2.3.4", port: 22 },
      { address: "1.2.3.4", port: 70000 },
      { address: "1.2.3.4", host: "bad_host" },
      { address: "1.2.3.4", sni: "-bad-" },
      { address: "1.2.3.4", label: "x".repeat(65) },
      "nope",
    ]) {
      const r = jsonReq("/api/users", "POST", { name: "Bad", addressOverride: bad });
      await expect(handleUsersApi(r, env as never, {} as never)).rejects.toMatchObject({
        fields: expect.objectContaining({ addressOverride: expect.any(String) }),
      });
    }
    const listed = await listUsers(env as never);
    expect(listed).toHaveLength(0);
  });

  it("PUT sets, replaces and clears addressOverride (null clears)", async () => {
    const create = jsonReq("/api/users", "POST", { name: "Pin" });
    const createRes = (await handleUsersApi(create, env as never, {} as never)) as Response;
    const createJ = (await createRes.json()) as { data: { user: { id: string } } };
    const id = createJ.data.user.id;

    const set = jsonReq(`/api/users/${id}`, "PUT", {
      addressOverride: { address: "[2606:4700::6810:85e5]", port: 8443 },
    });
    const setRes = (await handleUsersApi(set, env as never, {} as never)) as Response;
    const setJ = (await setRes.json()) as { data: { user: Record<string, unknown> } };
    expect(setJ.data.user.addressOverride).toEqual({ address: "[2606:4700::6810:85e5]", port: 8443 });

    const replace = jsonReq(`/api/users/${id}`, "PUT", {
      addressOverride: { address: "5.6.7.8", label: "Replaced" },
    });
    const replaceRes = (await handleUsersApi(replace, env as never, {} as never)) as Response;
    const replaceJ = (await replaceRes.json()) as { data: { user: Record<string, unknown> } };
    expect(replaceJ.data.user.addressOverride).toEqual({ address: "5.6.7.8", label: "Replaced" });

    const clear = jsonReq(`/api/users/${id}`, "PUT", { addressOverride: null });
    const clearRes = (await handleUsersApi(clear, env as never, {} as never)) as Response;
    const clearJ = (await clearRes.json()) as { data: { user: Record<string, unknown> } };
    expect(clearJ.data.user.addressOverride).toBeNull();

    const stored = (await listUsers(env as never))[0]!;
    expect(stored.addressOverride).toBeNull();
  });

  it("PUT with invalid addressOverride rejects and leaves stored value untouched", async () => {
    const create = jsonReq("/api/users", "POST", {
      name: "Keep",
      addressOverride: { address: "1.2.3.4", port: 2053 },
    });
    const createRes = (await handleUsersApi(create, env as never, {} as never)) as Response;
    const createJ = (await createRes.json()) as { data: { user: { id: string } } };
    const id = createJ.data.user.id;

    const bad = jsonReq(`/api/users/${id}`, "PUT", { addressOverride: { address: "1.2.3.4", port: 1234 } });
    await expect(handleUsersApi(bad, env as never, {} as never)).rejects.toMatchObject({
      fields: expect.objectContaining({ addressOverride: expect.stringContaining("Cloudflare") }),
    });
    const stored = (await listUsers(env as never))[0]!;
    expect(stored.addressOverride).toEqual({ address: "1.2.3.4", port: 2053 });
  });

  it("PUT without addressOverride key preserves the existing override", async () => {
    const create = jsonReq("/api/users", "POST", {
      name: "Keep2",
      addressOverride: { address: "9.9.9.9" },
    });
    const createRes = (await handleUsersApi(create, env as never, {} as never)) as Response;
    const createJ = (await createRes.json()) as { data: { user: { id: string } } };
    const id = createJ.data.user.id;
    const rename = jsonReq(`/api/users/${id}`, "PUT", { name: "Renamed" });
    const renameRes = (await handleUsersApi(rename, env as never, {} as never)) as Response;
    const renameJ = (await renameRes.json()) as { data: { user: Record<string, unknown> } };
    expect(renameJ.data.user.addressOverride).toEqual({ address: "9.9.9.9" });
  });

  it("GET activity returns per-day aggregates without leaking the token or its hash", async () => {
    const create = jsonReq("/api/users", "POST", { name: "Watched" });
    const createRes = (await handleUsersApi(create, env as never, {} as never)) as Response;
    const createJ = (await createRes.json()) as { data: { user: { id: string; token: string } } };
    const { id, token } = createJ.data.user;
    await consumeUserHit(env as never, token, null);
    await consumeUserHit(env as never, token, null);
    const res = (await handleUsersApi(
      req(`/api/users/${id}/activity?days=1`, { method: "GET" }),
      env as never,
      {} as never,
    )) as Response;
    expect(res.status).toBe(200);
    const j = (await res.json()) as { data: { activity: Record<string, unknown>[] } };
    expect(j.data.activity).toEqual([{ day: dayKeyUtc(), requests: 2, bytesUp: 0, bytesDown: 0 }]);
    const serialized = JSON.stringify(j);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(await hashToken(token));
    expect(serialized).not.toContain("tokenHash");
  });

  it("GET activity defaults to 7 days and clamps the window to 1..31", async () => {
    const create = jsonReq("/api/users", "POST", { name: "Ranged" });
    const createRes = (await handleUsersApi(create, env as never, {} as never)) as Response;
    const createJ = (await createRes.json()) as { data: { user: { id: string } } };
    const id = createJ.data.user.id;
    const get = async (qs: string) =>
      ((await handleUsersApi(req(`/api/users/${id}/activity${qs}`, { method: "GET" }), env as never, {} as never)) as Response).json() as Promise<{
        data: { activity: { day: string; requests: number; bytesUp: number; bytesDown: number }[] };
      }>;
    expect(((await get("")).data.activity)).toHaveLength(7);
    expect(((await get("?days=3")).data.activity)).toHaveLength(3);
    expect(((await get("?days=0")).data.activity)).toHaveLength(1);
    expect(((await get("?days=999")).data.activity)).toHaveLength(31);
    expect(((await get("?days=abc")).data.activity)).toHaveLength(7);
    const three = (await get("?days=3")).data.activity;
    expect(three.map((r) => r.day)).toEqual([...three.map((r) => r.day)].sort());
    for (const row of three) expect(Object.keys(row).sort()).toEqual(["bytesDown", "bytesUp", "day", "requests"]);
  });

  it("GET activity is 404 for unknown or malformed ids and rejects non-GET methods", async () => {
    await expect(
      handleUsersApi(req("/api/users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/activity", { method: "GET" }), env as never, {} as never),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      handleUsersApi(req("/api/users/not-a-uuid/activity", { method: "GET" }), env as never, {} as never),
    ).rejects.toMatchObject({ status: 404 });
    const create = jsonReq("/api/users", "POST", { name: "Method" });
    const createRes = (await handleUsersApi(create, env as never, {} as never)) as Response;
    const createJ = (await createRes.json()) as { data: { user: { id: string } } };
    await expect(
      handleUsersApi(req(`/api/users/${createJ.data.user.id}/activity`, { method: "POST" }), env as never, {} as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  describe("bulk endpoint", () => {
    const SP = "bulkpath1";
    const SECRET = "s".repeat(64);

    interface BulkData {
      updated: number;
      deleted: number;
      unknown: number;
    }

    beforeEach(async () => {
      invalidateSettingsCache();
      clearSessionFloorCache();
      const settings = makeTestSettings({ securePath: SP, sessionSecret: SECRET });
      await kv.put(
        SETTINGS_KEY,
        JSON.stringify({ version: 1, updatedAt: Date.now(), data: settings }),
      );
    });

    async function create(name: string): Promise<{ id: string; token: string }> {
      const res = (await handleUsersApi(jsonReq("/api/users", "POST", { name }), env as never, {} as never)) as Response;
      const j = (await res.json()) as { data: { user: { id: string; token: string } } };
      return { id: j.data.user.id, token: j.data.user.token };
    }

    async function bulk(body: unknown): Promise<{ status: number; json: { ok: boolean; data: BulkData } }> {
      const res = (await handleUsersApi(jsonReq("/api/users/bulk", "POST", body), env as never, {} as never)) as Response;
      return { status: res.status, json: (await res.json()) as { ok: boolean; data: BulkData } };
    }

    function fakeId(n: number): string {
      return `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
    }

    it("disables and re-enables a batch", async () => {
      const a = await create("BulkA");
      const b = await create("BulkB");
      const c = await create("BulkC");
      const ids = [a.id, b.id, c.id];
      const off = await bulk({ ids, patch: { enabled: false } });
      expect(off.status).toBe(200);
      expect(off.json).toEqual({ ok: true, data: { updated: 3, deleted: 0, unknown: 0 } });
      expect((await listUsers(env as never)).every((u) => u.enabled === false)).toBe(true);
      const on = await bulk({ ids, patch: { enabled: true } });
      expect(on.json).toEqual({ ok: true, data: { updated: 3, deleted: 0, unknown: 0 } });
      expect((await listUsers(env as never)).every((u) => u.enabled === true)).toBe(true);
    });

    it("counts unknown ids without erroring", async () => {
      const known = await create("Known");
      const res = await bulk({ ids: [known.id, fakeId(1), "not-a-uuid"], patch: { enabled: false } });
      expect(res.json).toEqual({ ok: true, data: { updated: 1, deleted: 0, unknown: 2 } });
      expect((await listUsers(env as never))[0]!.enabled).toBe(false);
    });

    it("deletes a batch and skips unknown ids", async () => {
      const a = await create("DelA");
      const b = await create("DelB");
      const res = await bulk({ ids: [a.id, b.id, fakeId(2)], patch: { delete: true } });
      expect(res.json).toEqual({ ok: true, data: { updated: 0, deleted: 2, unknown: 1 } });
      expect(await listUsers(env as never)).toHaveLength(0);
    });

    it("sets and clears expiresAt in batch with single-user validation", async () => {
      const a = await create("ExpA");
      const b = await create("ExpB");
      const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const set = await bulk({ ids: [a.id, b.id], patch: { expiresAt: future } });
      expect(set.json).toEqual({ ok: true, data: { updated: 2, deleted: 0, unknown: 0 } });
      for (const u of await listUsers(env as never)) expect(u.expiresAt).toBe(future);
      const clear = await bulk({ ids: [a.id, b.id], patch: { expiresAt: null } });
      expect(clear.json.data.updated).toBe(2);
      for (const u of await listUsers(env as never)) expect(u.expiresAt).toBeNull();
    });

    it("rejects empty ids", async () => {
      await expect(handleUsersApi(jsonReq("/api/users/bulk", "POST", { ids: [], patch: { enabled: false } }), env as never, {} as never)).rejects.toMatchObject({
        fields: expect.objectContaining({ ids: expect.any(String) }),
      });
    });

    it("rejects over-50 ids and accepts exactly 50", async () => {
      const known = await create("Cap");
      const over = [known.id];
      for (let i = 0; i < 50; i++) over.push(fakeId(100 + i));
      expect(over).toHaveLength(51);
      await expect(handleUsersApi(jsonReq("/api/users/bulk", "POST", { ids: over, patch: { enabled: false } }), env as never, {} as never)).rejects.toMatchObject({
        fields: expect.objectContaining({ ids: expect.stringContaining("50") }),
      });
      const exact = [known.id];
      for (let i = 0; i < 49; i++) exact.push(fakeId(200 + i));
      const res = await bulk({ ids: exact, patch: { enabled: false } });
      expect(res.json).toEqual({ ok: true, data: { updated: 1, deleted: 0, unknown: 49 } });
    });

    it("rejects ambiguous, empty, or malformed patch", async () => {
      const known = await create("PatchShape");
      for (const patch of [
        {},
        { enabled: true, delete: true },
        { expiresAt: null, delete: true },
        { delete: false },
        { delete: "yes" },
        { enabled: true, turbo: true },
      ]) {
        await expect(
          handleUsersApi(jsonReq("/api/users/bulk", "POST", { ids: [known.id], patch }), env as never, {} as never),
        ).rejects.toMatchObject({ fields: expect.objectContaining({ patch: expect.any(String) }) });
      }
      await expect(
        handleUsersApi(jsonReq("/api/users/bulk", "POST", { ids: [known.id] }), env as never, {} as never),
      ).rejects.toMatchObject({ fields: expect.objectContaining({ patch: expect.any(String) }) });
      expect((await listUsers(env as never))[0]!.enabled).toBe(true);
    });

    it("rejects invalid field values without mutating anyone", async () => {
      const a = await create("ValA");
      const b = await create("ValB");
      await expect(
        handleUsersApi(jsonReq("/api/users/bulk", "POST", { ids: [a.id, b.id], patch: { expiresAt: Date.now() - 1000 } }), env as never, {} as never),
      ).rejects.toMatchObject({ fields: expect.objectContaining({ expiresAt: expect.any(String) }) });
      await expect(
        handleUsersApi(jsonReq("/api/users/bulk", "POST", { ids: [a.id], patch: { enabled: "yes" } }), env as never, {} as never),
      ).rejects.toMatchObject({ fields: expect.objectContaining({ enabled: expect.any(String) }) });
      await expect(
        handleUsersApi(jsonReq("/api/users/bulk", "POST", { ids: "nope", patch: { enabled: false } }), env as never, {} as never),
      ).rejects.toMatchObject({ fields: expect.objectContaining({ ids: expect.any(String) }) });
      for (const u of await listUsers(env as never)) {
        expect(u.enabled).toBe(true);
        expect(u.expiresAt).toBeNull();
      }
    });

    it("never returns tokens, hashes, or secrets", async () => {
      const a = await create("LeakA");
      const b = await create("LeakB");
      const hash = await hashToken(a.token);
      const patched = await bulk({ ids: [a.id, b.id], patch: { enabled: false } });
      const removed = await bulk({ ids: [a.id], patch: { delete: true } });
      for (const payload of [JSON.stringify(patched.json), JSON.stringify(removed.json)]) {
        expect(payload).not.toContain(a.token);
        expect(payload).not.toContain(b.token);
        expect(payload).not.toContain(hash);
        expect(payload).not.toContain("tokenHash");
        expect(payload).not.toContain("token");
      }
      expect(Object.keys(patched.json.data).sort()).toEqual(["deleted", "unknown", "updated"]);
    });

    it("rejects non-POST methods on bulk", async () => {
      await expect(
        handleUsersApi(req(`/api/users/bulk`, { method: "GET" }), env as never, {} as never),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("requires a session (401 without cookie)", async () => {
      const target = `https://example.com/${SP}/api/users/bulk`;
      await expect(
        routeRequest(
          new Request(target, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Q-Panel": "1" },
            body: JSON.stringify({ ids: [fakeId(1)], patch: { enabled: false } }),
          }),
          env as never,
        ),
      ).rejects.toMatchObject({ status: 401 });
    });

    it("requires the CSRF header (403 with session but no header)", async () => {
      const target = `https://example.com/${SP}/api/users/bulk`;
      const token = await issueSession(SECRET);
      await expect(
        routeRequest(
          new Request(target, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: `q_session=${token}` },
            body: JSON.stringify({ ids: [fakeId(1)], patch: { enabled: false } }),
          }),
          env as never,
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("accepts session plus CSRF and applies the batch", async () => {
      const known = await create("Routed");
      const target = `https://example.com/${SP}/api/users/bulk`;
      const token = await issueSession(SECRET);
      const res = (await routeRequest(
        new Request(target, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: `q_session=${token}`, "X-Q-Panel": "1" },
          body: JSON.stringify({ ids: [known.id, fakeId(9)], patch: { enabled: false } }),
        }),
        env as never,
      )) as Response;
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, data: { updated: 1, deleted: 0, unknown: 1 } });
      expect((await listUsers(env as never))[0]!.enabled).toBe(false);
    });
  });
});
