import { describe, expect, it } from "vitest";
import { AppError, BadRequestError, UpstreamError, ValidationError } from "../../src/core/errors";
import {
  errorToResponse,
  htmlResponse,
  jsonError,
  jsonOk,
  readJsonObject,
  redirect,
} from "../../src/core/respond";

const readJson = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

describe("jsonOk", () => {
  it("wraps data in envelope with no-store", async () => {
    const r = jsonOk({ a: 1 });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("application/json");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await readJson(r)).toEqual({ ok: true, data: { a: 1 } });
  });
});

describe("jsonError", () => {
  it("emits error envelope and fields", async () => {
    const r = jsonError(422, "VALIDATION", "bad", { x: "required" });
    expect(r.status).toBe(422);
    const body = await readJson(r);
    expect(body).toEqual({
      ok: false,
      error: { code: "VALIDATION", message: "bad" },
      fields: { x: "required" },
    });
  });
});

describe("errorToResponse", () => {
  it("exposes client errors verbatim", async () => {
    const body = await readJson(errorToResponse(new BadRequestError("nope"), false));
    expect((body.error as Record<string, unknown>).message).toBe("nope");
  });

  it("hides upstream errors even in debug", async () => {
    const hidden = await readJson(errorToResponse(new UpstreamError("http://secret-upstream"), false));
    expect((hidden.error as Record<string, unknown>).message).not.toContain("secret");
    const debug = await readJson(errorToResponse(new UpstreamError("leak-me"), true));
    expect((debug.error as Record<string, unknown>).message).not.toBe("leak-me");
    expect((debug.error as Record<string, unknown>).message).toBe("internal error");
  });

  it("maps ValidationError fields", async () => {
    const body = await readJson(
      errorToResponse(new ValidationError({ "fragment.lengthMin": "must be number" }), false),
    );
    expect(body.fields).toEqual({ "fragment.lengthMin": "must be number" });
    expect(body.ok).toBe(false);
  });

  it("unknown errors become generic 500", async () => {
    const r = errorToResponse(new Error("stack trace secret"), false);
    expect(r.status).toBe(500);
    const body = await readJson(r);
    expect(JSON.stringify(body)).not.toContain("stack trace secret");
  });

  it("AppError carries code/status", () => {
    const e = new AppError("x", 418, "TEAPOT");
    expect(e.status).toBe(418);
    expect(e.code).toBe("TEAPOT");
    expect(errorToResponse(e, false).status).toBe(418);
  });
});

describe("htmlResponse / redirect", () => {
  it("sets html content type", () => {
    const r = htmlResponse("<p>hi</p>", 404);
    expect(r.status).toBe(404);
    expect(r.headers.get("Content-Type")).toContain("text/html");
  });

  it("sets security headers on every html response", () => {
    const r = htmlResponse("<p>hi</p>");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(r.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(r.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
    );
  });

  it("caller-provided headers override the defaults", () => {
    const r = htmlResponse("<p>hi</p>", 200, {
      "Cache-Control": "no-store",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "origin",
    });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(r.headers.get("Referrer-Policy")).toBe("origin");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("readJsonObject parses object bodies and rejects others", async () => {
    const ok = await readJsonObject(new Request("https://x/", { method: "POST", body: '{"a":1}' }));
    expect(ok).toEqual({ a: 1 });
    await expect(
      readJsonObject(new Request("https://x/", { method: "POST", body: "[1,2]" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readJsonObject(new Request("https://x/", { method: "POST", body: "not json" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("redirect sets location", () => {
    const r = redirect("/dest");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/dest");
  });
});
