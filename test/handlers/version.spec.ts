import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateUpdate, fetchLatestVersion } from "../../src/handlers/api/version";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("evaluateUpdate", () => {
  it.each([
    ["v1.1.0", "v1.1.0", false],
    ["v1.1.0", "v1.1.1", true],
    ["v1.1.0", "v1.2.0", true],
    ["v1.1.0", "v2.0.0", true],
    ["v10.0.0", "v9.9.9", false],
    ["v2.0.0", "v1.99.99", false],
    ["v1.2.3", null, false],
    ["v1.2.3", "", false],
    ["v1.2.3", "garbage", false],
    ["v1.2.3", "1.2.3", false],
    ["unknown", "v9.9.9", false],
    ["", "v9.9.9", false],
  ])("current=%j latest=%j -> updateAvailable=%j", (current, latest, expected) => {
    const result = evaluateUpdate(current, latest);
    expect(result.current).toBe(current);
    expect(result.latest).toBe(latest);
    expect(result.updateAvailable).toBe(expected);
  });

  it("accepts tags without the leading v when comparing", () => {
    expect(evaluateUpdate("v1.0.0", "2.0.0").updateAvailable).toBe(true);
    expect(evaluateUpdate("2.0.0", "v1.0.0").updateAvailable).toBe(false);
  });

  it("ignores build metadata by rejecting non-semver shapes", () => {
    expect(evaluateUpdate("v1.0.0", "v1.0.0-beta.1").updateAvailable).toBe(false);
  });
});

describe("fetchLatestVersion", () => {
  it("returns the tag_name of a successful release payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ tag_name: "v9.8.7" })),
    );
    expect(await fetchLatestVersion()).toBe("v9.8.7");
  });

  it("returns null on http 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Not Found" }, 404)),
    );
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null on any other non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 502 })),
    );
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null when tag_name is missing or not a string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );
    expect(await fetchLatestVersion()).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ tag_name: 42 })),
    );
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null when the upstream request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchLatestVersion()).toBeNull();
  });
});
