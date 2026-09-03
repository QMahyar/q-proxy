import { beforeEach, describe, expect, it } from "vitest";
import { handleUserSub } from "../../src/handlers/users-sub";
import { hashToken, saveUsers, tokenHintFor, type UserAccount } from "../../src/users/store";
import type { Settings } from "../../src/types/settings";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

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
    return { QPROXY_KV: this };
  }
}

const TOKEN = "22222222-2222-4222-8222-222222222222";

function baseSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    securePath: "s",
    vlessUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    vmessUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef",
    trojanPassword: "trojpass1",
    ssPassword: "sspass1",
    addresses: [
      { address: "1.1.1.1", port: 443, label: "Global" },
      { address: "2.2.2.2", port: 2053, label: "Other" },
    ],
  };
}

async function mkUser(env: { QPROXY_KV: FakeKV }, over: Partial<UserAccount> = {}): Promise<void> {
  const tokenHash = await hashToken(TOKEN);
  const user: UserAccount = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Alice",
    tokenHash,
    tokenHint: tokenHintFor(TOKEN),
    enabled: true,
    expiresAt: null,
    dailyReqLimit: null,
    protocols: "all",
    createdAt: "2026-08-25T00:00:00.000Z",
    ...over,
  };
  await saveUsers(env as never, [user]);
}

function subRequest(target = "base64"): Request {
  return new Request(`https://worker.example.com/s/sub/u/${TOKEN}?target=${target}`);
}

function authorityOf(uri: string): { host: string; port: number } {
  const url = new URL(uri.replace(/^[a-z]+:\/\//, "https://"));
  return { host: url.hostname, port: Number(url.port || "443") };
}

function tlsUris(uris: string[]): string[] {
  return uris.filter((u) => u.startsWith("vless://") || u.startsWith("trojan://"));
}

async function decodeBase64Sub(res: Response): Promise<string[]> {
  const text = await res.text();
  const decoded = Buffer.from(text, "base64").toString("utf8");
  return decoded.split("\n").filter((l: string) => l.length > 0);
}

describe("users-sub address override", () => {
  let kv: FakeKV;
  beforeEach(() => {
    kv = new FakeKV();
  });

  it("emits only the override address and port when set", async () => {
    const env = kv.asEnv();
    await mkUser(env as never, {
      addressOverride: { address: "9.9.9.9", port: 8443 },
    });
    const res = (await handleUserSub(subRequest(), env as never, baseSettings())) as Response;
    expect(res.status).toBe(200);
    const uris = tlsUris(await decodeBase64Sub(res));
    expect(uris.length).toBeGreaterThan(0);
    const authorities = uris.map(authorityOf);
    for (const a of authorities) {
      expect(a.host).toBe("9.9.9.9");
      expect(a.port).toBe(8443);
    }
  });

  it("uses override.port ?? settings.defaultPort when the override omits a port", async () => {
    const env = kv.asEnv();
    await mkUser(env as never, { addressOverride: { address: "9.9.9.9" } });
    const res = (await handleUserSub(subRequest(), env as never, baseSettings())) as Response;
    const uris = tlsUris(await decodeBase64Sub(res));
    expect(uris.length).toBeGreaterThan(0);
    const ports = new Set(uris.map((u) => authorityOf(u).port));
    expect(ports).toEqual(new Set([443]));
  });

  it("emits the global addresses when the override is null", async () => {
    const env = kv.asEnv();
    await mkUser(env as never, { addressOverride: null });
    const res = (await handleUserSub(subRequest(), env as never, baseSettings())) as Response;
    const uris = tlsUris(await decodeBase64Sub(res));
    expect(uris.length).toBeGreaterThan(0);
    const hosts = new Set(uris.map((u) => authorityOf(u).host));
    expect(hosts).toEqual(new Set(["1.1.1.1", "2.2.2.2"]));
  });

  it("applies the override host/sni to generated TLS nodes", async () => {
    const env = kv.asEnv();
    await mkUser(env as never, {
      addressOverride: { address: "9.9.9.9", port: 443, host: "cdn.example.com", sni: "sni.example.com" },
    });
    const s = { ...baseSettings(), randomizeSniCase: false };
    const res = (await handleUserSub(subRequest(), env as never, s)) as Response;
    const uris = tlsUris(await decodeBase64Sub(res));
    expect(uris.length).toBeGreaterThan(0);
    const vless = uris.find((u) => u.startsWith("vless://"))!;
    expect(vless).toContain("host=cdn.example.com");
    expect(vless).toContain("sni=sni.example.com");
  });

  it("still honors the user protocol filter alongside the override", async () => {
    const env = kv.asEnv();
    await mkUser(env as never, {
      protocols: ["trojan"],
      addressOverride: { address: "9.9.9.9", port: 8443 },
    });
    const res = (await handleUserSub(subRequest(), env as never, baseSettings())) as Response;
    const uris = tlsUris(await decodeBase64Sub(res));
    expect(uris.length).toBeGreaterThan(0);
    expect(uris.every((u) => u.startsWith("trojan://"))).toBe(true);
    const authorities = uris.map(authorityOf);
    for (const a of authorities) {
      expect(a.host).toBe("9.9.9.9");
      expect(a.port).toBe(8443);
    }
  });
});
