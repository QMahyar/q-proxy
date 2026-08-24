import { AppError, ValidationError } from "./errors";

const GENERIC_MESSAGE = "internal error";

export function jsonOk<T>(data: T, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: h });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  const body: Record<string, unknown> = {
    ok: false,
    error: { code, message },
  };
  if (fields) body.fields = fields;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function errorToResponse(err: unknown, debug: boolean): Response {
  if (err instanceof AppError) {
    const showMessage = err.expose || (debug && err.status >= 500);
    let res: Response;
    if (err instanceof ValidationError) {
      res = jsonError(err.status, err.code, err.message, err.fields);
    } else {
      res = jsonError(err.status, err.code, showMessage ? err.message : GENERIC_MESSAGE);
    }
    for (const [k, v] of Object.entries(err.headers)) res.headers.set(k, v);
    return res;
  }
  return jsonError(500, "INTERNAL", GENERIC_MESSAGE);
}

export function htmlResponse(html: string, status = 200, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "text/html; charset=utf-8");
  return new Response(html, { status, headers: h });
}

export function redirect(location: string, status: 302 | 308 = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}
