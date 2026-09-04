import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleProxyPoolApi } from "../../../src/handlers/api/proxy-pool";
import { clearSessionFloorCache, issueSession } from "../../../src/auth/session";
import { AppError } from "../../../src/core/errors";
import { UnauthorizedError } from "../../../src/core/errors";
import { clearRelayEndpointCache } from "../../../src/tunnel/proxyip-pool";
import { makeTestSettings } from "../../helpers/settings";

const { tcpProbeMock } = vi.hoisted(() => ({ tcpProbeMock: vi.fn() }));

vi.mock("../../../src/tunnel/proxyip-pool", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../../src/tunnel/proxyip-pool")>();
  return { ...orig, tcpProbe: tcpProbeMock };
});

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));

function stubEnv(): { QPROXY_KV: { get(key: string): Promise<unknown> } } {
  return { QPROXY_KV: { get: async () => null } };
}

async function authedGet(url: string, secret: string, init?: RequestInit): Promise<Request> {
  const token = await issueSession(secret);
  return new Request(url, { ...init, headers: { Cookie: `q_session=${token}` } });
}

interface PoolBody {
  ok: boolean;
  data: {
    pool: Array<{ ip: string; port: number }>;
    source: string;
    probe?: Array<{ ip: string; port: number; status: "ok" | "fail"; latencyMs: number | null }>;
  };
}

beforeEach(() => {
  clearSessionFloorCache();
  clearRelayEndpointCache();
  tcpProbeMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleProxyPoolApi", () => {
  it("returns the pool and list source without probing by default", async () => {
    const s = makeTestSettings({ proxyIps: ["203.0.113.1:443", "203.0.113.2:2053"], proxyIpPoolUrl: "" });
    const res = await handleProxyPoolApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PoolBody;
    expect(body.ok).toBe(true);
    expect(body.data.source).toBe("list");
    expect(body.data.pool).toEqual([
      { ip: "203.0.113.1", port: 443 },
      { ip: "203.0.113.2", port: 2053 },
    ]);
    expect(body.data.probe).toBeUndefined();
    expect(tcpProbeMock).not.toHaveBeenCalled();
  });

  it("identifies the url source when the list is empty and the pool url serves entries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("203.0.113.3\n203.0.113.4:2053")));
    const s = makeTestSettings({ proxyIps: [], proxyIpPoolUrl: "https://pool.example/list" });
    const res = await handleProxyPoolApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    const body = (await res.json()) as PoolBody;
    expect(body.data.source).toBe("url");
    expect(body.data.pool).toEqual([
      { ip: "203.0.113.3", port: 443 },
      { ip: "203.0.113.4", port: 2053 },
    ]);
    expect(body.data.probe).toBeUndefined();
  });

  it("probes pool endpoints only when probe=1 and maps null to fail", async () => {
    tcpProbeMock.mockResolvedValueOnce(11).mockResolvedValueOnce(null);
    const s = makeTestSettings({ proxyIps: ["203.0.113.1:443", "203.0.113.2:443"], proxyIpPoolUrl: "" });
    const res = await handleProxyPoolApi(
      await authedGet("https://panel.example/x?probe=1", s.sessionSecret),
      stubEnv() as never,
      s,
    );
    const body = (await res.json()) as PoolBody;
    expect(body.data.source).toBe("list");
    expect(body.data.pool).toEqual([
      { ip: "203.0.113.1", port: 443 },
      { ip: "203.0.113.2", port: 443 },
    ]);
    expect(body.data.probe).toEqual([
      { ip: "203.0.113.1", port: 443, status: "ok", latencyMs: 11 },
      { ip: "203.0.113.2", port: 443, status: "fail", latencyMs: null },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledTimes(2);
  });

  it("caps probing at eight endpoints while returning the full pool", async () => {
    tcpProbeMock.mockResolvedValue(4);
    const ips = Array.from({ length: 10 }, (_, i) => `203.0.113.${i + 1}:443`);
    const s = makeTestSettings({ proxyIps: ips, proxyIpPoolUrl: "" });
    const res = await handleProxyPoolApi(
      await authedGet("https://panel.example/x?probe=1", s.sessionSecret),
      stubEnv() as never,
      s,
    );
    const body = (await res.json()) as PoolBody;
    expect(body.data.pool).toHaveLength(10);
    expect(body.data.probe).toHaveLength(8);
    expect(body.data.probe!.map((p) => `${p.ip}:${p.port}`)).toEqual(
      body.data.pool.slice(0, 8).map((p) => `${p.ip}:${p.port}`),
    );
    expect(body.data.probe!.every((p) => p.status === "ok" && p.latencyMs === 4)).toBe(true);
    expect(tcpProbeMock).toHaveBeenCalledTimes(8);
  });

  it("rejects non-get methods with a 405 method error", async () => {
    const s = makeTestSettings({ proxyIps: ["203.0.113.1:443"], proxyIpPoolUrl: "" });
    const req = await authedGet("https://panel.example/x", s.sessionSecret, { method: "POST" });
    await expect(handleProxyPoolApi(req, stubEnv() as never, s)).rejects.toMatchObject({
      status: 405,
      code: "METHOD",
    });
    expect(tcpProbeMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before touching the pool", async () => {
    const s = makeTestSettings({ proxyIps: ["203.0.113.1:443"], proxyIpPoolUrl: "" });
    const req = new Request("https://panel.example/x?probe=1");
    let caught: unknown;
    try {
      await handleProxyPoolApi(req, stubEnv() as never, s);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnauthorizedError);
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).status).toBe(401);
    expect(tcpProbeMock).not.toHaveBeenCalled();
  });
});
