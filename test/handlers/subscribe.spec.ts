import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSubscribe } from "../../src/handlers/subscribe";
import type { Env } from "../../src/types/env";
import { DEFAULT_SETTINGS } from "../../src/types/settings";
import type { Settings } from "../../src/types/settings";
import { decodeBase64 } from "../../src/utils/base64";

function envStub(): Env {
  return {
    QPROXY_KV: {
      get: async () => null,
      put: async () => undefined,
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

function request(url: string, ua?: string): Request {
  const headers = new Headers();
  if (ua !== undefined) headers.set("user-agent", ua);
  return new Request(url, { headers });
}

const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleSubscribe", () => {
  it("serves the bilingual info page to browsers with textual sub URLs", async () => {
    const res = await handleSubscribe(
      request("https://w.test/sp12345678/sub", BROWSER),
      envStub(),
      settings(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("https://w.test/sp12345678/sub?target=clash");
    expect(body).toContain("https://w.test/sp12345678/sub?target=singbox");
    expect(body).toContain("اندپوینت");
    expect(body.toLowerCase()).not.toContain("vless://");
  });

  it("emits base64 subscription with subscription headers and remote merge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(btoa("ss://remote@203.0.113.9:1#R"), { status: 200 })),
    );
    const s = settings();
    s.remoteSubUrls = ["https://r/sub"];
    const res = await handleSubscribe(
      request("https://w.test/sp12345678/sub", "v2rayNG/1.8.14"),
      envStub(),
      s,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("profile-title")).toBe("base64:USBQcm94eQ==");
    expect(res.headers.get("subscription-userinfo")).toBe("upload=0; download=0");
    expect(res.headers.get("profile-update-interval")).toBe("12");
    expect(res.headers.get("profile-web-page-url")).toBe("https://w.test/sp12345678/panel");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''Q%20Proxy.txt");
    const raw = await res.text();
    const r = decodeBase64(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const lines = new TextDecoder()
      .decode(r.value)
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines[0]!.startsWith("vless://")).toBe(true);
    expect(lines.some((l) => l.startsWith("ss://remote@203.0.113.9:1"))).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("negotiates clash via UA and serves yaml content type", async () => {
    const res = await handleSubscribe(
      request("https://w.test/sp12345678/sub", "clash-verge/v2.0"),
      envStub(),
      settings(),
    );
    expect(res.headers.get("content-type")).toBe("text/yaml; charset=utf-8");
    expect(await res.text()).toMatch(/^mixed-port: 7890\n/);
  });

  it("honors target=singbox overriding a browser UA", async () => {
    const res = await handleSubscribe(
      request("https://w.test/sp12345678/sub?target=singbox", BROWSER),
      envStub(),
      settings(),
    );
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const parsed = JSON.parse(await res.text()) as { outbounds: unknown[] };
    expect(parsed.outbounds.length).toBeGreaterThan(1);
  });

  it("emits vless+vmess+trojan and omits ss from surge output", async () => {
    const res = await handleSubscribe(
      request("https://w.test/sp12345678/sub?target=surge"),
      envStub(),
      settings(),
    );
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("[Proxy]");
    expect(body).toContain("= vless,");
    expect(body).toContain("= vmess,");
    expect(body).toContain("= trojan,");
    expect(body).not.toContain("= ss");
  });

  it("throws NotFound when the route is not sub", async () => {
    await expect(
      handleSubscribe(request("https://w.test/sp12345678/other"), envStub(), settings()),
    ).rejects.toMatchObject({ status: 404 });
  });
});
