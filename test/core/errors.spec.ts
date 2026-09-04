import { describe, expect, it } from "vitest";
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
} from "../../src/core/errors";

describe("AppError", () => {
  it("stores message, status, code, and defaults", () => {
    const err = new AppError("custom", 418, "TEAPOT");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe("custom");
    expect(err.status).toBe(418);
    expect(err.code).toBe("TEAPOT");
    expect(err.expose).toBe(true);
    expect(err.headers).toEqual({});
    expect(err.name).toBe("AppError");
  });

  it("honors explicit expose and headers", () => {
    const err = new AppError("hidden", 500, "INTERNAL", false, { "Retry-After": "3" });
    expect(err.expose).toBe(false);
    expect(err.headers).toEqual({ "Retry-After": "3" });
  });
});

describe("client error subclasses", () => {
  it("BadRequestError defaults to 400 BAD_REQUEST", () => {
    const err = new BadRequestError();
    expect(err.status).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("bad request");
    expect(err.expose).toBe(true);
    expect(err.headers).toEqual({});
    expect(err.name).toBe("BadRequestError");
    expect(new BadRequestError("nope").message).toBe("nope");
  });

  it("UnauthorizedError defaults to 401 UNAUTHORIZED", () => {
    const err = new UnauthorizedError();
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.message).toBe("unauthorized");
    expect(err.expose).toBe(true);
    expect(err.name).toBe("UnauthorizedError");
    expect(new UnauthorizedError("no session").message).toBe("no session");
  });

  it("ForbiddenError defaults to 403 FORBIDDEN", () => {
    const err = new ForbiddenError();
    expect(err.status).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("forbidden");
    expect(err.expose).toBe(true);
    expect(err.name).toBe("ForbiddenError");
    expect(new ForbiddenError("csrf missing").message).toBe("csrf missing");
  });

  it("NotFoundError defaults to 404 NOT_FOUND", () => {
    const err = new NotFoundError();
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("not found");
    expect(err.expose).toBe(true);
    expect(err.name).toBe("NotFoundError");
    expect(new NotFoundError("no such user").message).toBe("no such user");
  });

  it("every client error is an AppError and an Error", () => {
    const errs: AppError[] = [
      new BadRequestError(),
      new UnauthorizedError(),
      new ForbiddenError(),
      new NotFoundError(),
      new ValidationError({}),
      new RateLimitedError(),
    ];
    for (const err of errs) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toBeInstanceOf(Error);
      expect(err.expose).toBe(true);
    }
  });
});

describe("ValidationError", () => {
  it("carries status 422, code VALIDATION, and the fields map", () => {
    const fields = { "fragment.lengthMin": "must be a number", securePath: "required" };
    const err = new ValidationError(fields);
    expect(err.status).toBe(422);
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toBe("validation failed");
    expect(err.fields).toEqual(fields);
    expect(err.expose).toBe(true);
    expect(err.headers).toEqual({});
    expect(err.name).toBe("ValidationError");
  });

  it("accepts a custom message while keeping the fields", () => {
    const err = new ValidationError({ a: "bad" }, "custom validation message");
    expect(err.message).toBe("custom validation message");
    expect(err.fields).toEqual({ a: "bad" });
    expect(err.status).toBe(422);
  });
});

describe("RateLimitedError", () => {
  it("defaults to 429 RATE_LIMITED with no Retry-After header", () => {
    const err = new RateLimitedError();
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toBe("too many attempts");
    expect(err.expose).toBe(true);
    expect(err.headers).toEqual({});
    expect(err.name).toBe("RateLimitedError");
  });

  it("sets Retry-After from the retry delay", () => {
    expect(new RateLimitedError(30).headers).toEqual({ "Retry-After": "30" });
    expect(new RateLimitedError(1).headers).toEqual({ "Retry-After": "1" });
  });

  it("clamps non-positive delays up to 1", () => {
    expect(new RateLimitedError(0).headers).toEqual({ "Retry-After": "1" });
    expect(new RateLimitedError(-5).headers).toEqual({ "Retry-After": "1" });
  });

  it("accepts a custom message alongside the delay", () => {
    const err = new RateLimitedError(10, "slow down");
    expect(err.message).toBe("slow down");
    expect(err.headers).toEqual({ "Retry-After": "10" });
    expect(err.status).toBe(429);
  });
});

describe("UpstreamError", () => {
  it("is a 502 UPSTREAM error that is never exposed", () => {
    const err = new UpstreamError("http://secret-upstream/x");
    expect(err.status).toBe(502);
    expect(err.code).toBe("UPSTREAM");
    expect(err.message).toBe("http://secret-upstream/x");
    expect(err.expose).toBe(false);
    expect(err.headers).toEqual({});
    expect(err.name).toBe("UpstreamError");
  });
});
