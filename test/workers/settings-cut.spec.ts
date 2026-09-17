import { describe, expect, it } from "vitest";
import { SELF, env as cfEnv } from "cloudflare:test";
import type { Env } from "../../src/types/env";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import { seed, SETTINGS_KEY, testKv } from "../helpers/seed";
import { invalidateSettingsCache } from "../../src/settings/store";

const env: Env = cfEnv as unknown as Env;
const kv = testKv(env);

const SP = "settingscut";
const BASE = `https://example.com/${SP}`;
const PASSWORD = "settings-cut-pass-1";

const REMOVED_KEYS = [
  "vmessEnabled",
  "trojanEnabled",
  "ssEnabled",
  "vmessUuid",
  "trojanPassword",
  "ssPassword",
  "ssMethod",
  "ssDirect",
  "vmessPath",
  "trojanPath",
  "ssPath",
  "proxyIpMode",
  "nat64Prefixes",
  "chainProxy",
  "remoteDns",
  "urlTestIntervalSec",
  "remoteNodes",
  "remoteSubUrls",
  "speedtestIntercept",
  "totp",
];

const SECRETS = ["passwordHash", "passwordSalt", "sessionSecret", "securePath", "botToken"];

function post(json: unknown, extra: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(json),
  };
}

function put(json: unknown, extra: Record<string, string> = {}): RequestInit {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(json),
  };
}

async function body(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

async function setupAdmin(): Promise<{ cookie: string; csrfHeaders: Record<string, string> }> {
  const res = await SELF.fetch(`${BASE}/api/auth/setup`, post({ newPassword: PASSWORD }, { "X-Q-Panel": "1" }));
  expect(res.status).toBe(200);
  const raw = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { data: Record<string, unknown> };
  raw.data.passwordIsBootstrap = false;
  await kv.put(SETTINGS_KEY, JSON.stringify(raw));
  invalidateSettingsCache();
  const cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0]!;
  return { cookie, csrfHeaders: { Cookie: cookie, "X-Q-Panel": "1" } };
}

describe("settings cutover (export / pre-cut reject / boot purge)", () => {
  it("exports surviving fields only with secrets stripped, and re-imports cleanly (T028)", async () => {
    await seed(kv, SP);
    const { cookie, csrfHeaders } = await setupAdmin();

    let res = await SELF.fetch(`${BASE}/api/settings/export`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const raw = await res.text();
    for (const key of [...REMOVED_KEYS, ...SECRETS, "camouflage"]) {
      if (key === "camouflage") continue;
      expect(raw, key).not.toContain(`"${key}"`);
    }
    const blob = JSON.parse(raw) as { kind: string; version: number; settings: Record<string, unknown> };
    expect(blob.kind).toBe("q-proxy-settings");
    expect(blob.version).toBe(3);

    res = await SELF.fetch(`${BASE}/api/settings`, put({ profileTitle: "Cutover Panel" }, csrfHeaders));
    expect(res.status).toBe(200);

    res = await SELF.fetch(`${BASE}/api/settings/export`, { headers: { Cookie: cookie } });
    const customized = JSON.parse(await res.text()) as { settings: Record<string, unknown> };
    res = await SELF.fetch(`${BASE}/api/settings/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ settings: customized.settings }),
    });
    expect(res.status).toBe(200);
    const imported = await body(res);
    expect(imported.data.saved).toBe(true);
    expect(imported.data.imported.profileTitle).toBe("Cutover Panel");
  });

  it("rejects a pre-cut backup whole with nothing applied (T029)", async () => {
    await seed(kv, SP);
    const { csrfHeaders } = await setupAdmin();

    const legacySettings = {
      ...structuredClone(DEFAULT_SETTINGS),
      version: 2,
      securePath: SP,
      vmessUuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      trojanPassword: "trojanpass123",
      remoteNodes: [],
      totp: { enabled: false, secret: "", recoveryCodes: [] },
    };
    const res = await SELF.fetch(`${BASE}/api/settings/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders },
      body: JSON.stringify({ settings: legacySettings }),
    });
    expect(res.status).toBe(422);
    const errBody = await body(res);
    expect(errBody.error.code).toBe("VALIDATION");
    expect(JSON.stringify(errBody.fields)).toContain("pre-cut");

    const check = await SELF.fetch(`${BASE}/api/settings`, { headers: { Cookie: csrfHeaders.Cookie! } });
    expect(((await body(check)).data as Record<string, unknown>).profileTitle).toBe(
      DEFAULT_SETTINGS.profileTitle,
    );
  });

  it("purges pre-cut user data on first boot, stamps v3, and is a no-op after (T030)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const legacyData = {
      ...structuredClone(DEFAULT_SETTINGS),
      securePath: SP,
      vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
    };
    await kv.put(
      SETTINGS_KEY,
      JSON.stringify({ version: 2, updatedAt: Date.now(), rev: 0, data: legacyData }),
    );
    await kv.put("qproxy:users", JSON.stringify([{ id: "x", name: "ghost" }]));
    await kv.put(`qproxy:user-usage:${today}:abc123`, JSON.stringify(3));
    invalidateSettingsCache();

    const res = await SELF.fetch(`${BASE}/sub?target=base64`);
    expect(res.status).toBe(200);

    expect(await kv.get("qproxy:users")).toBeNull();
    expect(await kv.get(`qproxy:user-usage:${today}:abc123`)).toBeNull();

    const stored = JSON.parse((await kv.get(SETTINGS_KEY)) as string) as { version: number };
    expect(stored.version).toBe(3);

    const usersTable = await env.QPROXY_DB.prepare("SELECT COUNT(*) AS n FROM users")
      .first()
      .then(() => "exists")
      .catch(() => "dropped");
    expect(usersTable).toBe("dropped");

    const again = await SELF.fetch(`${BASE}/sub?target=base64`);
    expect(again.status).toBe(200);
  });
});
