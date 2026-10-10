import { beforeEach, describe, expect, it } from "vitest";
import { handleBootstrap } from "../../../src/handlers/api/bootstrap";
import { clearUsageMemoForTests } from "../../../src/core/counters";
import { invalidateSettingsCache, loadSettings, settingsEtag } from "../../../src/settings/store";
import { makeTestSettings } from "../../helpers/settings";

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

function bootstrapRequest(extraHeaders: Record<string, string> = {}): Request {
  return new Request("https://panel.example/mysecret1/api/bootstrap", { headers: extraHeaders });
}

function withColo(req: Request, colo: string): Request {
  Object.defineProperty(req, "cf", { value: { colo } });
  return req;
}

interface BootstrapPayload {
  ok: boolean;
  data: {
    settings: Record<string, unknown>;
    status: {
      version: string;
      killSwitch: boolean;
      colo: string | null;
      language: string;
      hasPassword: boolean;
      usage: Record<string, unknown>;
    };
    subUrls: { urls: Array<{ format: string; label: string; url: string }> };
  };
}

beforeEach(() => {
  invalidateSettingsCache();
  clearUsageMemoForTests();
});

describe("handleBootstrap", () => {
  it("serves the settings/status/subUrls aggregate without secrets", async () => {
    const kv = new FakeKV();
    const s = makeTestSettings({ killSwitch: true, language: "fa", passwordHash: "hash-value" });
    const res = await handleBootstrap(bootstrapRequest(), kv.asEnv() as never, s);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as BootstrapPayload;
    expect(payload.data.settings.securePath).toBe("mysecret1");
    expect(payload.data.settings.hasPassword).toBe(true);
    expect(payload.data.settings.rev).toBeNull();
    expect(payload.data.status.killSwitch).toBe(true);
    expect(payload.data.status.language).toBe("fa");
    expect(payload.data.status.colo).toBeNull();
    expect(typeof payload.data.status.version).toBe("string");
    expect(payload.data.status.usage.estimated).toBe(true);
    expect(payload.data.subUrls.urls.length).toBeGreaterThan(0);
    for (const entry of payload.data.subUrls.urls) {
      expect(entry.url).toContain("https://panel.example/mysecret1/sub");
    }
    const raw = JSON.stringify(payload);
    for (const secret of ["passwordHash", "passwordSalt", "sessionSecret", "botToken"]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("reports colo and password state from the request and settings", async () => {
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    const withPassword = makeTestSettings({ passwordHash: "hash-value" });
    const coloRes = await handleBootstrap(withColo(bootstrapRequest(), "FRA"), env, withPassword);
    const colo = ((await coloRes.json()) as BootstrapPayload).data.status;
    expect(colo.colo).toBe("FRA");
    expect(colo.hasPassword).toBe(true);

    const withoutPassword = makeTestSettings({ passwordHash: null, passwordSalt: null });
    const plainRes = await handleBootstrap(bootstrapRequest(), env, withoutPassword);
    const plain = ((await plainRes.json()) as BootstrapPayload).data.status;
    expect(plain.colo).toBeNull();
    expect(plain.hasPassword).toBe(false);
  });

  it("supports ETag revalidation once settings are cached", async () => {
    const kv = new FakeKV();
    const env = kv.asEnv() as never;
    const s = await loadSettings(env);
    expect(settingsEtag()).not.toBeNull();

    const first = await handleBootstrap(bootstrapRequest(), env, s);
    expect(first.status).toBe(200);
    const etag = first.headers.get("ETag");
    expect(etag).not.toBeNull();

    const cached = await handleBootstrap(bootstrapRequest({ "If-None-Match": etag! }), env, s);
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");

    const stale = await handleBootstrap(bootstrapRequest({ "If-None-Match": '"stale"' }), env, s);
    expect(stale.status).toBe(200);
  });
});
