import { describe, expect, it } from "vitest";
import { handleUserSub } from "../../src/handlers/users-sub";
import type { Env } from "../../src/types/env";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import type { Settings } from "../../src/types/settings";
import { USERS_KEY, hashToken } from "../../src/users/store";
import type { UserAccount } from "../../src/users/store";
import { decodeBase64 } from "../../src/utils/base64";

function kvStub(rows: Record<string, unknown>): Env {
  return {
    QPROXY_KV: {
      get: async (key: string) => (key in rows ? rows[key] : null),
      put: async () => undefined,
      delete: async () => undefined,
    },
  } as unknown as Env;
}

function settings(): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    securePath: "sp12345678",
    sessionSecret: "x".repeat(64),
    vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
    vmessUuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
    trojanPassword: "secretpass123",
    ssPassword: "sspass12345",
    randomizeSniCase: false,
    remoteSubUrls: [],
  };
}

const TOKEN = "11111111-2222-4333-8444-555555555555";

async function userRows(): Promise<Record<string, unknown>> {
  const user: UserAccount = {
    id: "u-1",
    name: "tester",
    tokenHash: await hashToken(TOKEN),
    tokenHint: "11111111…",
    enabled: true,
    expiresAt: null,
    dailyReqLimit: null,
    protocols: "all",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return { [USERS_KEY]: [user] };
}

function request(url: string, ua?: string): Request {
  const headers = new Headers();
  if (ua !== undefined) headers.set("user-agent", ua);
  return new Request(url, { headers });
}

describe("handleUserSub", () => {
  it("serves a scoped base64 sub with the 60s cache-throttle headers", async () => {
    const res = await handleUserSub(
      request(`https://w.test/sp12345678/sub/u/${TOKEN}?target=base64`, "v2rayNG/1.8.14"),
      kvStub(await userRows()),
      settings(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(res.headers.get("profile-update-interval")).toBe("60");
    expect(res.headers.get("expires")).toBeTypeOf("string");
    const raw = await res.text();
    const decoded = decodeBase64(raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    const text = new TextDecoder().decode(decoded.value);
    expect(text.split("\n").some((l) => l.startsWith("vless://"))).toBe(true);
  });

  it("keeps the throttle headers on a clash fetch via UA", async () => {
    const res = await handleUserSub(
      request(`https://w.test/sp12345678/sub/u/${TOKEN}`, "clash-verge/v2.0"),
      kvStub(await userRows()),
      settings(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(res.headers.get("profile-update-interval")).toBe("60");
  });
});
