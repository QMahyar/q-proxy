import { describe, expect, it } from "vitest";
import { handleWarpSub } from "../../src/handlers/warp-sub";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import type { Settings } from "../../src/types/settings";
import { WARP_ACCOUNT_PREFIX, WARP_TOKEN_PREFIX } from "../../src/warp/store";
import { ASSETS } from "../../src/ui/assets";

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
  };
}

const TOKEN = "99999999-8888-4777-8666-555555555555";

function warpRows(): Record<string, unknown> {
  const account = {
    id: "acc-1",
    name: "Main WARP",
    token: TOKEN,
    created_at: "2026-01-01T00:00:00.000Z",
    warp_id: null,
    warp_token: null,
    config: {
      private_key: "a".repeat(43) + "=",
      public_key: "b".repeat(43) + "=",
      peer_public_key: "c".repeat(43) + "=",
      addresses: { ipv4: "172.16.0.2", ipv6: "2606:4700:110:8a36::1" },
      mtu: 1280,
      reserved: [12, 34, 56],
    },
    endpoint_list: { type: "custom", custom_endpoints: [{ ip: "162.159.192.1", port: 2408 }] },
    amnezia_overrides: null,
    dns: null,
  };
  return {
    [WARP_TOKEN_PREFIX + TOKEN]: "acc-1",
    [WARP_ACCOUNT_PREFIX + "acc-1"]: account,
  };
}

function request(format: string): Request {
  return new Request(`https://w.test/sp12345678/sub/wg/${TOKEN}/${format}`);
}

const DELETED_FORMATS = [
  "wireguard-conf-amnezia",
  "throne-amnezia",
  "wireguard-uri",
  "singbox-amnezia",
  "singbox-legacy",
  "singbox-legacy-amnezia",
  "xray",
  "clash",
  "clash-amnezia",
  "surge",
  "surfboard",
  "loon",
  "egern",
];

describe("handleWarpSub", () => {
  it("serves a surviving throne sub with the 60s cache-throttle headers", async () => {
    const res = await handleWarpSub(request("throne"), kvStub(warpRows()), settings());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(res.headers.get("profile-update-interval")).toBe("12");
    expect(res.headers.get("expires")).toBeTypeOf("string");
    const body = await res.text();
    expect(body.startsWith("wg://")).toBe(true);
    expect(body).toContain("162.159.192.1:2408");
  });

  it("serves deleted formats as camouflage identical to unknown names", async () => {
    const rows = kvStub(warpRows());
    const s = settings();
    for (const format of [...DELETED_FORMATS, "not-a-format"]) {
      const res = await handleWarpSub(request(format), rows, s);
      expect(res.status, format).toBe(200);
      expect(await res.text(), format).toBe(ASSETS.camo);
    }
  });

  it("returns 404 without cache headers for an unknown token", async () => {
    const res = await handleWarpSub(
      new Request(`https://w.test/sp12345678/sub/wg/${TOKEN}/throne`),
      kvStub({}),
      settings(),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("profile-update-interval")).toBeNull();
  });
});
