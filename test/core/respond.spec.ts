import { describe, expect, it } from "vitest";
import { AppError, BadRequestError, UpstreamError, ValidationError } from "../../src/core/errors";
import {
  errorToResponse,
  htmlResponse,
  jsonError,
  jsonOk,
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

  it("hides upstream errors unless debug", async () => {
    const hidden = await readJson(errorToResponse(new UpstreamError("http://secret-upstream"), false));
    expect((hidden.error as Record<string, unknown>).message).not.toContain("secret");
    const debug = await readJson(errorToResponse(new UpstreamError("leak-me"), true));
    expect((debug.error as Record<string, unknown>).message).toBe("leak-me");
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

  it("redirect sets location", () => {
    const r = redirect("/dest");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/dest");
  });
});
