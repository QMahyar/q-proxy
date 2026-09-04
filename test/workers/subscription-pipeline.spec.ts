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
  vmessUuid: "1386f85e-657b-4d6e-9d56-78badb75e1fd",
  trojanPassword: "secretpass12345",
  ssPassword: "sspass123456789",
  randomizeSniCase: false,
};

const ONE_ADDRESS = [{ address: "203.0.113.10", port: 443 }];
const TWO_ADDRESSES = [{ address: "203.0.113.10", port: 443 }, { address: "203.0.113.20", port: 443 }];

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

function clashProxyNames(yaml: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.indexOf("proxies:");
  const end = lines.indexOf("proxy-groups:");
  const names: string[] = [];
  for (const line of lines.slice(start + 1, end === -1 ? undefined : end)) {
    const m = /^  - name: "(.*)"$/.exec(line);
    if (m !== null) names.push(m[1]!);
  }
  return names;
}

function clashGroupProxies(yaml: string): string[] {
  const m = /^    proxies: (\[.*\])$/m.exec(yaml);
  return m === null ? [] : (JSON.parse(m[1]!) as string[]);
}

async function fetchClash(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/sub?target=clash`);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("yaml");
  return res.text();
}

async function seedAddresses(addresses: typeof ONE_ADDRESS): Promise<number> {
  await seed(kv, SP, { ...CREDS, addresses });
  return (await readSettings()).updatedAt;
}

describe("subscription pipeline", () => {
  it("renders one clash proxy per generated node with all names present", async () => {
    await seedAddresses(ONE_ADDRESS);
    const { settings } = await readSettings();
    const body = await fetchClash();
    const names = clashProxyNames(body);
    const want = expectedNames(settings);
    expect(want.length).toBeGreaterThan(0);
    expect(names).toHaveLength(want.length);
    for (const name of want) expect(names).toContain(name);
    expect(clashGroupProxies(body)).toEqual(names);
  });

  it("picks up a settings change on the next fetch", async () => {
    const stamp = await seedAddresses(ONE_ADDRESS);
    const before = await fetchClash();
    while (Date.now() <= stamp) await new Promise((r) => setTimeout(r, 2));
    await seedAddresses(TWO_ADDRESSES);
    const { settings } = await readSettings();
    const after = await fetchClash();
    expect(after).not.toBe(before);
    const names = clashProxyNames(after);
    expect(names).toHaveLength(expectedNames(settings).length);
    expect(names.length).toBeGreaterThan(clashProxyNames(before).length);
    for (const name of expectedNames(settings)) expect(names).toContain(name);
  });
});
