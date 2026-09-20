import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAddressProbeApi } from "../../../src/handlers/api/address-probe";
import { clearSessionFloorCache, issueSession } from "../../../src/auth/session";
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

async function authedGet(url: string, secret: string): Promise<Request> {
  const token = await issueSession(secret);
  return new Request(url, { headers: { Cookie: `q_session=${token}` } });
}

interface ProbeRow {
  ip: string;
  port: number;
  label: string;
  status: "ok" | "fail";
  latencyMs: number | null;
}

async function probeData(res: Response): Promise<ProbeRow[]> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; data: { results: ProbeRow[] } };
  expect(body.ok).toBe(true);
  return body.data.results;
}

beforeEach(() => {
  clearSessionFloorCache();
  tcpProbeMock.mockReset();
});

describe("handleAddressProbeApi", () => {
  it("marks every endpoint failed when all probes return null", async () => {
    tcpProbeMock.mockResolvedValue(null);
    const s = makeTestSettings({
      customEndpoints: ["203.0.113.1:443", "203.0.113.2:8443"],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "203.0.113.1", port: 443, label: "203.0.113.1:443", status: "fail", latencyMs: null },
      { ip: "203.0.113.2", port: 8443, label: "203.0.113.2:8443", status: "fail", latencyMs: null },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledTimes(2);
    expect(tcpProbeMock).toHaveBeenNthCalledWith(1, "203.0.113.1", 443);
    expect(tcpProbeMock).toHaveBeenNthCalledWith(2, "203.0.113.2", 8443);
  });

  it("mixes ok and fail rows by probe outcome", async () => {
    tcpProbeMock.mockResolvedValueOnce(12).mockResolvedValueOnce(null);
    const s = makeTestSettings({
      customEndpoints: ["203.0.113.1:443", "203.0.113.2:443"],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "203.0.113.1", port: 443, label: "203.0.113.1:443", status: "ok", latencyMs: 12 },
      { ip: "203.0.113.2", port: 443, label: "203.0.113.2:443", status: "fail", latencyMs: null },
    ]);
  });

  it("probes ticked presets alongside custom lines", async () => {
    tcpProbeMock.mockResolvedValue(7);
    const s = makeTestSettings({
      cdnPresets: ["cf-443-a"],
      customEndpoints: ["203.0.113.2:443"],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "104.17.0.0", port: 443, label: "104.17.0.0:443", status: "ok", latencyMs: 7 },
      { ip: "203.0.113.2", port: 443, label: "203.0.113.2:443", status: "ok", latencyMs: 7 },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledTimes(2);
    expect(tcpProbeMock).toHaveBeenCalledWith("104.17.0.0", 443);
  });

  it("caps probing at eight endpoints", async () => {
    tcpProbeMock.mockResolvedValue(3);
    const customEndpoints = Array.from({ length: 10 }, (_, i) => `203.0.113.${i + 1}:443`);
    const s = makeTestSettings({ customEndpoints });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    const results = await probeData(res);
    expect(results).toHaveLength(8);
    expect(results.map((r) => r.ip)).toEqual(customEndpoints.slice(0, 8).map((l) => l.split(":")[0]));
    expect(tcpProbeMock).toHaveBeenCalledTimes(8);
  });

  it("rejects private addresses through the ssrf guard without probing", async () => {
    tcpProbeMock.mockResolvedValue(5);
    const s = makeTestSettings({
      customEndpoints: ["127.0.0.1:443", "10.0.0.9:443", "localhost:443", "203.0.113.1:443"],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "127.0.0.1", port: 443, label: "127.0.0.1:443", status: "fail", latencyMs: null },
      { ip: "10.0.0.9", port: 443, label: "10.0.0.9:443", status: "fail", latencyMs: null },
      { ip: "localhost", port: 443, label: "localhost:443", status: "fail", latencyMs: null },
      { ip: "203.0.113.1", port: 443, label: "203.0.113.1:443", status: "ok", latencyMs: 5 },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledTimes(1);
    expect(tcpProbeMock).toHaveBeenCalledWith("203.0.113.1", 443);
  });

  it("falls back to the request hostname when nothing is selected", async () => {
    tcpProbeMock.mockResolvedValue(9);
    const s = makeTestSettings({});
    const res = await handleAddressProbeApi(await authedGet("https://203.0.113.7/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "203.0.113.7", port: 443, label: "203.0.113.7", status: "ok", latencyMs: 9 },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledWith("203.0.113.7", 443);
  });
});
