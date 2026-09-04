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
  it("marks every address failed when all probes return null", async () => {
    tcpProbeMock.mockResolvedValue(null);
    const s = makeTestSettings({
      addresses: [
        { address: "203.0.113.1", port: 443 },
        { address: "203.0.113.2", port: 8443 },
      ],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "203.0.113.1", port: 443, label: "203.0.113.1", status: "fail", latencyMs: null },
      { ip: "203.0.113.2", port: 8443, label: "203.0.113.2", status: "fail", latencyMs: null },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledTimes(2);
    expect(tcpProbeMock).toHaveBeenNthCalledWith(1, "203.0.113.1", 443);
    expect(tcpProbeMock).toHaveBeenNthCalledWith(2, "203.0.113.2", 8443);
  });

  it("mixes ok and fail rows by probe outcome and keeps labels", async () => {
    tcpProbeMock.mockResolvedValueOnce(12).mockResolvedValueOnce(null);
    const s = makeTestSettings({
      addresses: [
        { address: "203.0.113.1", port: 443, label: "primary" },
        { address: "203.0.113.2", port: 443, label: "backup" },
      ],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "203.0.113.1", port: 443, label: "primary", status: "ok", latencyMs: 12 },
      { ip: "203.0.113.2", port: 443, label: "backup", status: "fail", latencyMs: null },
    ]);
  });

  it("skips disabled addresses without probing them", async () => {
    tcpProbeMock.mockResolvedValue(7);
    const s = makeTestSettings({
      addresses: [
        { address: "203.0.113.1", port: 443, enabled: false },
        { address: "203.0.113.2", port: 443 },
      ],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "203.0.113.2", port: 443, label: "203.0.113.2", status: "ok", latencyMs: 7 },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledTimes(1);
    expect(tcpProbeMock).toHaveBeenCalledWith("203.0.113.2", 443);
  });

  it("caps probing at eight addresses", async () => {
    tcpProbeMock.mockResolvedValue(3);
    const addresses = Array.from({ length: 10 }, (_, i) => ({ address: `203.0.113.${i + 1}`, port: 443 }));
    const s = makeTestSettings({ addresses });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    const results = await probeData(res);
    expect(results).toHaveLength(8);
    expect(results.map((r) => r.ip)).toEqual(addresses.slice(0, 8).map((a) => a.address));
    expect(tcpProbeMock).toHaveBeenCalledTimes(8);
  });

  it("rejects private addresses through the ssrf guard without probing", async () => {
    tcpProbeMock.mockResolvedValue(5);
    const s = makeTestSettings({
      addresses: [
        { address: "127.0.0.1", port: 443 },
        { address: "10.0.0.9", port: 443 },
        { address: "localhost", port: 443 },
        { address: "203.0.113.1", port: 443 },
      ],
    });
    const res = await handleAddressProbeApi(await authedGet("https://panel.example/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "127.0.0.1", port: 443, label: "127.0.0.1", status: "fail", latencyMs: null },
      { ip: "10.0.0.9", port: 443, label: "10.0.0.9", status: "fail", latencyMs: null },
      { ip: "localhost", port: 443, label: "localhost", status: "fail", latencyMs: null },
      { ip: "203.0.113.1", port: 443, label: "203.0.113.1", status: "ok", latencyMs: 5 },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledTimes(1);
    expect(tcpProbeMock).toHaveBeenCalledWith("203.0.113.1", 443);
  });

  it("falls back to the request hostname when no addresses are configured", async () => {
    tcpProbeMock.mockResolvedValue(9);
    const s = makeTestSettings({ addresses: [] });
    const res = await handleAddressProbeApi(await authedGet("https://203.0.113.7/x", s.sessionSecret), stubEnv() as never, s);
    expect(await probeData(res)).toEqual([
      { ip: "203.0.113.7", port: 443, label: "203.0.113.7", status: "ok", latencyMs: 9 },
    ]);
    expect(tcpProbeMock).toHaveBeenCalledWith("203.0.113.7", 443);
  });
});
