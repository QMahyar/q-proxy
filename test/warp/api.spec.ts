import { afterEach, describe, expect, it, vi } from "vitest";
import { WarpApiError, registerWarpDevice } from "../../src/warp/api";
import { handleWarpApi } from "../../src/handlers/api/warp";
import { RateLimitedError, ValidationError } from "../../src/core/errors";

const PRIV = "eCtXvJp6Nv6gMdQDj8Sj9ABXQKwmLlTAmT7wvFjZB1I=";
const PUB = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";

const IMPORT_JSON: Record<string, unknown> = {
  private_key: PRIV,
  addresses: { ipv4: "10.2.0.2/32" },
  endpoint: "162.159.192.1:2408",
};

function registrationBody(): unknown {
  return {
    id: "device-123",
    token: "bearer-456",
    config: {
      interface: {
        addresses: { v4: "10.2.0.2/32", v6: "2606:4700:110:8d4a::/128" },
      },
      peers: [{ public_key: "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=" }],
      client_id: btoa(String.fromCharCode(5, 6, 7)),
    },
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerWarpDevice", () => {
  it("registers a device and builds the full config", async () => {
    const fetchMock = vi.fn(async () => okResponse(registrationBody()));
    vi.stubGlobal("fetch", fetchMock);
    const reg = await registerWarpDevice();
    expect(reg.warpId).toBe("device-123");
    expect(reg.warpToken).toBe("bearer-456");
    expect(reg.config.addresses.ipv4).toBe("10.2.0.2/32");
    expect(reg.config.reserved).toEqual([5, 6, 7]);
    expect(reg.config.private_key.length).toBeGreaterThan(40);
    expect(reg.config.public_key.length).toBeGreaterThan(40);
    expect(reg.config.mtu).toBe(1280);
    const call = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(call[0]).toBe("https://api.cloudflareclient.com/v0a4005/reg");
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
    expect(body.key).toBe(reg.config.public_key);
  });

  it("accepts the {data:{result}} envelope shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ data: { result: registrationBody() } })),
    );
    const reg = await registerWarpDevice();
    expect(reg.warpId).toBe("device-123");
  });

  it("retries on 5xx then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Response("boom", { status: 502 });
        return okResponse(registrationBody());
      }),
    );
    const reg = await registerWarpDevice();
    expect(reg.warpId).toBe("device-123");
  });

  it("does not retry on 4xx and surfaces the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    await expect(registerWarpDevice()).rejects.toMatchObject({ status: 403 });
  });

  it("throws when the response is unreadable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ hello: 1 })));
    await expect(registerWarpDevice()).rejects.toBeInstanceOf(WarpApiError);
  });
});

describe("handleWarpApi generate", () => {
  const settings = {} as Parameters<typeof handleWarpApi>[2];

  function fakeEnv() {
    const store = new Map<string, string>();
    return {
      store,
      QPROXY_KV: {
        get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
        put: async (key: string, value: string) => void store.set(key, value),
        delete: async (key: string) => void store.delete(key),
        list: async () => ({ keys: [] as Array<{ name: string }> }),
      },
    };
  }

  function generateRequest(body: unknown): Request {
    return new Request("http://panel.test/api/warp/account/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Q-Panel": "1" },
      body: JSON.stringify(body),
    });
  }

  async function expectRejection<T extends Error>(p: Promise<unknown>): Promise<T> {
    try {
      await p;
    } catch (err) {
      return err as T;
    }
    throw new Error("expected the handler to reject");
  }

  it("maps a 4xx warp api rejection to a distinct validation error", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await expectRejection<ValidationError>(handleWarpApi(generateRequest({}), fakeEnv() as never, settings));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fields.warp_api).toBe("warp api rejected registration (403)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a 429 to a rate limited error carrying Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow", { status: 429, headers: { "Retry-After": "0" } })),
    );
    const err = await expectRejection<RateLimitedError>(handleWarpApi(generateRequest({}), fakeEnv() as never, settings));
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.message).toBe("Cloudflare WARP registration is rate-limited; retry later");
    expect(err.headers["Retry-After"]).toBe("1");
  });

  it("maps a timeout or network failure to a distinct validation error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const err = await expectRejection<ValidationError>(handleWarpApi(generateRequest({}), fakeEnv() as never, settings));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fields.warp_api).toBe("WARP registration timed out or the network was unreachable");
  });

  it("maps an unreadable registration payload to a distinct validation error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({ hello: 1 })));
    const err = await expectRejection<ValidationError>(handleWarpApi(generateRequest({}), fakeEnv() as never, settings));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fields.warp_api).toBe("warp api returned an unreadable registration");
  });

  it("validates the body before contacting the warp api", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      handleWarpApi(generateRequest({ endpoint_list: { type: "custom" } }), fakeEnv() as never, settings),
    ).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers, then stores the account with the real config", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(registrationBody())));
    const env = fakeEnv();
    const res = await handleWarpApi(generateRequest({ name: "Gen" }), env as never, settings);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { data: { account: { config: { reserved: number[]; public_key: string } } } };
    expect(data.data.account.config.reserved).toEqual([5, 6, 7]);
    expect(data.data.account.config.public_key.length).toBeGreaterThan(40);
    expect(JSON.stringify(data.data)).not.toContain("private_key");
  });
});

describe("handleWarpApi import", () => {
  const settings = {} as Parameters<typeof handleWarpApi>[2];

  function fakeEnv() {
    const store = new Map<string, string>();
    return {
      store,
      QPROXY_KV: {
        get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
        put: async (key: string, value: string) => void store.set(key, value),
        delete: async (key: string) => void store.delete(key),
        list: async () => ({ keys: [] as Array<{ name: string }> }),
      },
    };
  }

  function importRequest(body: unknown): Request {
    return new Request("http://panel.test/api/warp/account/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Q-Panel": "1" },
      body: JSON.stringify(body),
    });
  }

  async function importedEndpointList(body: unknown): Promise<unknown> {
    const res = await handleWarpApi(importRequest(body), fakeEnv() as never, settings);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { data: { account: { endpoint_list: unknown } } };
    return data.data.account.endpoint_list;
  }

  it("stores a JSON config object's endpoint as custom_endpoints", async () => {
    expect(await importedEndpointList({ name: "Json", config: IMPORT_JSON })).toEqual({
      type: "custom",
      custom_endpoints: [{ ip: "162.159.192.1", port: 2408 }],
    });
  });

  it("stores a JSON config string's endpoint as custom_endpoints", async () => {
    expect(await importedEndpointList({ config: JSON.stringify(IMPORT_JSON) })).toEqual({
      type: "custom",
      custom_endpoints: [{ ip: "162.159.192.1", port: 2408 }],
    });
  });

  it("stores a .conf Peer Endpoint as custom_endpoints", async () => {
    const confText = [
      "[Interface]",
      `PrivateKey = ${PRIV}`,
      "Address = 10.2.0.2/32",
      "[Peer]",
      `PublicKey = ${PUB}`,
      "AllowedIPs = 0.0.0.0/0",
      "Endpoint = engage.cloudflareclient.com:2408",
    ].join("\n");
    expect(await importedEndpointList({ config: confText })).toEqual({
      type: "custom",
      custom_endpoints: [{ ip: "engage.cloudflareclient.com", port: 2408 }],
    });
  });

  it("keeps an explicit endpoint_list over parsed endpoints", async () => {
    const endpointList = await importedEndpointList({
      config: JSON.stringify(IMPORT_JSON),
      endpoint_list: { type: "custom", custom_endpoints: ["[2606:4700:d0::a29f:c001]:500"] },
    });
    expect(endpointList).toEqual({
      type: "custom",
      custom_endpoints: [{ ip: "2606:4700:d0::a29f:c001", port: 500 }],
    });
  });

  it("rejects an unreadable config with the parser reason", async () => {
    await expect(handleWarpApi(importRequest({ config: "nonsense" }), fakeEnv() as never, settings)).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("handleWarpApi presets", () => {
  const settings = {} as Parameters<typeof handleWarpApi>[2];

  function fakeEnv() {
    const store = new Map<string, string>();
    return {
      store,
      QPROXY_KV: {
        get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
        put: async (key: string, value: string) => void store.set(key, value),
        delete: async (key: string) => void store.delete(key),
        list: async () => ({ keys: [] as Array<{ name: string }> }),
      },
    };
  }

  function presetRequest(path: string, method: string, body?: unknown): Request {
    return new Request(`http://panel.test/api/warp/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("stores dns on preset create and updates it on PUT", async () => {
    const env = fakeEnv();
    const createRes = await handleWarpApi(
      presetRequest("presets", "POST", { name: "P", endpoints: ["162.159.192.1:2408"], dns: "9.9.9.9" }),
      env as never,
      settings,
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { data: { preset: { id: string; dns: string | null } } };
    expect(created.data.preset.dns).toBe("9.9.9.9");

    const updateRes = await handleWarpApi(
      presetRequest(`presets/${created.data.preset.id}`, "PUT", { dns: "1.0.0.1" }),
      env as never,
      settings,
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { data: { preset: { dns: string | null } } };
    expect(updated.data.preset.dns).toBe("1.0.0.1");
  });

  it("accepts a preset without dns and keeps dns when PUT omits it", async () => {
    const env = fakeEnv();
    const createRes = await handleWarpApi(
      presetRequest("presets", "POST", { name: "P2", endpoints: ["162.159.192.1:2408"] }),
      env as never,
      settings,
    );
    const created = (await createRes.json()) as { data: { preset: { id: string; dns: string | null } } };
    expect(created.data.preset.dns).toBeNull();

    const dnsRes = await handleWarpApi(
      presetRequest(`presets/${created.data.preset.id}`, "PUT", { dns: "1.1.1.1" }),
      env as never,
      settings,
    );
    await handleWarpApi(
      presetRequest(`presets/${created.data.preset.id}`, "PUT", { name: "P2 renamed" }),
      env as never,
      settings,
    );
    const after = (await dnsRes.json()) as { data: { preset: { id: string } } };
    const listRes = await handleWarpApi(presetRequest("presets", "GET"), env as never, settings);
    const list = (await listRes.json()) as { data: { presets: Array<{ id: string; name: string; dns: string | null }> } };
    const stored = list.data.presets.find((p) => p.id === after.data.preset.id);
    expect(stored?.dns).toBe("1.1.1.1");
    expect(stored?.name).toBe("P2 renamed");
  });
});
