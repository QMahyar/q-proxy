import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../../../src/core/errors";
import { handleSaveSettings } from "../../../src/handlers/api/settings";
import { invalidateSettingsCache, loadSettings, readSettingsRev } from "../../../src/settings/store";

class FakeKV {
  map = new Map<string, string>();

  async get(key: string, _options?: unknown): Promise<unknown> {
    const raw = this.map.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as unknown);
  }

  async put(key: string, value: string, _options?: unknown): Promise<void> {
    this.map.set(key, value);
  }

  asEnv(): { QPROXY_KV: FakeKV } {
    return { QPROXY_KV: this };
  }
}

function saveRequest(body: unknown): Request {
  return new Request("https://panel.example/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function storedData(kv: FakeKV): Record<string, unknown> {
  return (JSON.parse(kv.map.get("qproxy:settings")!) as { data: Record<string, unknown> }).data;
}

async function seed(kv: FakeKV): Promise<{ env: never; s: Awaited<ReturnType<typeof loadSettings>> }> {
  invalidateSettingsCache();
  const env = kv.asEnv() as never;
  const s = await loadSettings(env);
  return { env, s };
}

describe("handleSaveSettings", () => {
  it("saves with a matching baseRev and echoes the new rev", async () => {
    const kv = new FakeKV();
    const { env, s } = await seed(kv);
    const rev = await readSettingsRev(env);
    const res = await handleSaveSettings(saveRequest({ profileTitle: "New Title", baseRev: rev }), env, s);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { ok: boolean; data: { saved: boolean; rev: number } };
    expect(payload.data).toEqual({ saved: true, rev: rev + 1 });
    expect(storedData(kv).profileTitle).toBe("New Title");
    expect(await readSettingsRev(env)).toBe(rev + 1);
  });

  it("rejects a stale baseRev with CONFLICT and applies nothing", async () => {
    const kv = new FakeKV();
    const { env, s } = await seed(kv);
    const rev0 = await readSettingsRev(env);
    const first = await handleSaveSettings(saveRequest({ profileTitle: "Winner", baseRev: rev0 }), env, s);
    expect(first.status).toBe(200);

    let caught: unknown = null;
    try {
      await handleSaveSettings(saveRequest({ profileTitle: "Loser", baseRev: rev0 }), env, s);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    const conflict = caught as ConflictError;
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe("CONFLICT");
    expect(storedData(kv).profileTitle).toBe("Winner");
    expect(await readSettingsRev(env)).toBe(rev0 + 1);
  });

  it("treats a missing or non-integer baseRev as a legacy write", async () => {
    const kv = new FakeKV();
    const { env, s } = await seed(kv);
    const rev0 = await readSettingsRev(env);
    const noRev = await handleSaveSettings(saveRequest({ profileTitle: "Legacy One" }), env, s);
    expect(noRev.status).toBe(200);
    expect(((await noRev.json()) as { data: { saved: boolean; rev: number } }).data).toEqual({
      saved: true,
      rev: rev0 + 1,
    });
    const sloppy = await handleSaveSettings(saveRequest({ profileTitle: "Legacy Two", baseRev: "7" }), env, s);
    expect(sloppy.status).toBe(200);
    expect(storedData(kv).profileTitle).toBe("Legacy Two");
    expect(await readSettingsRev(env)).toBe(rev0 + 2);
  });

  it("strips credential and identity fields from the body", async () => {
    const kv = new FakeKV();
    const { env, s } = await seed(kv);
    const before = { ...storedData(kv) };
    const res = await handleSaveSettings(
      saveRequest({
        profileTitle: "Kept Title",
        securePath: "hacked-path",
        passwordHash: "hacked-hash",
        passwordSalt: "hacked-salt",
        sessionSecret: "hacked-secret",
        passwordIsBootstrap: true,
        seededAt: 123,
      }),
      env,
      s,
    );
    expect(res.status).toBe(200);
    const after = storedData(kv);
    expect(after.profileTitle).toBe("Kept Title");
    expect(after.securePath).toBe(before.securePath);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.passwordSalt).toBe(before.passwordSalt);
    expect(after.sessionSecret).toBe(before.sessionSecret);
    expect(after.passwordIsBootstrap).toBe(before.passwordIsBootstrap);
    expect(after.seededAt).toBe(before.seededAt);
  });

  it("surfaces validation failures as VALIDATION with a fields map and writes nothing", async () => {
    const kv = new FakeKV();
    const { env, s } = await seed(kv);
    const revBefore = await readSettingsRev(env);
    let caught: unknown = null;
    try {
      await handleSaveSettings(saveRequest({ maxNodesPerFormat: 99999 }), env, s);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const validation = caught as ValidationError;
    expect(validation.status).toBe(422);
    expect(validation.code).toBe("VALIDATION");
    expect(validation.fields.maxNodesPerFormat).toBe("must be an integer between 1 and 2000");
    expect(await readSettingsRev(env)).toBe(revBefore);

    caught = null;
    try {
      await handleSaveSettings(saveRequest({ language: "xx" }), env, s);
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).fields.language).toBe("must be one of en, fa");
    expect(await readSettingsRev(env)).toBe(revBefore);
  });

  it("merges onto fresh KV state instead of the stale handler settings", async () => {
    const kv = new FakeKV();
    const { env, s: stale } = await seed(kv);
    const concurrent = JSON.parse(kv.map.get("qproxy:settings")!) as {
      rev: number;
      data: Record<string, unknown>;
    };
    concurrent.data.profileTitle = "concurrent-title";
    kv.map.set("qproxy:settings", JSON.stringify(concurrent));
    const res = await handleSaveSettings(saveRequest({ maxNodesPerFormat: 600 }), env, stale);
    expect(res.status).toBe(200);
    const stored = storedData(kv);
    expect(stored.profileTitle).toBe("concurrent-title");
    expect(stored.maxNodesPerFormat).toBe(600);
  });
});
