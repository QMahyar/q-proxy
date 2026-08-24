export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly expose: boolean = true,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "bad request") {
    super(message, 400, "BAD_REQUEST");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>, message = "validation failed") {
    super(message, 422, "VALIDATION");
    this.fields = fields;
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds?: number, message = "too many attempts") {
    const headers: Record<string, string> = {};
    if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(Math.max(1, retryAfterSeconds));
    super(message, 429, "RATE_LIMITED", true, headers);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(message, 502, "UPSTREAM", false);
  }
}
