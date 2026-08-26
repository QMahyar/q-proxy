import { afterEach, describe, expect, it, vi } from "vitest";
import { WarpApiError, registerWarpDevice } from "../../src/warp/api";

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
    const fetchMock = vi.fn(async () => new Response("boom", { status: 502 })).mockImplementationOnce(async () => new Response("boom", { status: 502 }));
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
