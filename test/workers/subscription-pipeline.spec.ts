import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { generateNodes } from "../../src/nodes/generate";
import { selectVariantNodes } from "../../src/subscription/render";
import type { Settings } from "../../src/types/settings";
import { seed, SETTINGS_KEY, testKv } from "../helpers/seed";

const kv = testKv(env);

const SP = "subpipeline";
const BASE = `https://example.com/${SP}`;

const CREDS = {
  vlessUuid: "d342d11e-d424-4583-b36e-524ab1f0afa4",
  randomizeSniCase: false,
};

const ONE_ADDRESS = ["203.0.113.10:443"];
const TWO_ADDRESSES = ["203.0.113.10:443", "203.0.113.20:443"];

async function readSettings(): Promise<{ settings: Settings; updatedAt: number }> {
  const raw = (await kv.get(SETTINGS_KEY)) as string | null;
  const blob = JSON.parse(raw ?? "null") as { updatedAt: number; data: Settings };
  return { settings: blob.data, updatedAt: blob.updatedAt };
}

function expectedNames(s: Settings): string[] {
  const nodes = selectVariantNodes(
    generateNodes({ settings: s, hostname: "example.com", request: new Request("https://example.com/") }),
    "normal",
  );
  return nodes.map((n) => n.name);
}

function singboxVlessTags(json: string): string[] {
  const doc = JSON.parse(json) as { outbounds: Array<{ type: string; tag: string }> };
  return doc.outbounds.filter((o) => o.type === "vless").map((o) => o.tag);
}

async function fetchSingbox(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/sub?target=singbox`);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("json");
  return res.text();
}

async function seedAddresses(customEndpoints: typeof ONE_ADDRESS): Promise<number> {
  await seed(kv, SP, { ...CREDS, customEndpoints });
  return (await readSettings()).updatedAt;
}

describe("subscription pipeline", () => {
  it("renders one sing-box vless outbound per generated node with all names present", async () => {
    await seedAddresses(ONE_ADDRESS);
    const { settings } = await readSettings();
    const body = await fetchSingbox();
    const tags = singboxVlessTags(body);
    const want = expectedNames(settings);
    expect(want.length).toBeGreaterThan(0);
    expect(tags).toHaveLength(want.length);
    for (const name of want) expect(tags).toContain(name);
  });

  it("picks up a settings change on the next fetch", async () => {
    const stamp = await seedAddresses(ONE_ADDRESS);
    const before = await fetchSingbox();
    while (Date.now() <= stamp) await new Promise((r) => setTimeout(r, 2));
    await seedAddresses(TWO_ADDRESSES);
    const { settings } = await readSettings();
    const after = await fetchSingbox();
    expect(after).not.toBe(before);
    const tags = singboxVlessTags(after);
    expect(tags).toHaveLength(expectedNames(settings).length);
    expect(tags.length).toBeGreaterThan(singboxVlessTags(before).length);
    for (const name of expectedNames(settings)) expect(tags).toContain(name);
  });

  it("renders one clash vless proxy per generated node with all names present", async () => {
    await seedAddresses(ONE_ADDRESS);
    const clashSettings = await readSettings();
    const clashRes = await SELF.fetch(`${BASE}/sub?target=clash`);
    expect(clashRes.status).toBe(200);
    expect(clashRes.headers.get("Content-Type")).toContain("yaml");
    const clashBody = await clashRes.text();
    for (const name of expectedNames(clashSettings.settings)) expect(clashBody).toContain(`name: ${name}`);
  });

  it("renders one xray vless outbound per generated node", async () => {
    await seedAddresses(ONE_ADDRESS);
    const { settings } = await readSettings();
    const res = await SELF.fetch(`${BASE}/sub?target=xray`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("json");
    const doc = JSON.parse(await res.text()) as { outbounds: Array<{ protocol: string }> };
    const tags = expectedNames(settings);
    expect(doc.outbounds.filter((o) => o.protocol === "vless")).toHaveLength(tags.length);
  });
  it("rejects deleted format targets as invalid", async () => {
    await seedAddresses(ONE_ADDRESS);
    for (const dead of ["surge", "loon", "quantumult"]) {
      const res = await SELF.fetch(`${BASE}/sub?target=${dead}`);
      expect(res.status, dead).toBe(400);
    }
  });
});
