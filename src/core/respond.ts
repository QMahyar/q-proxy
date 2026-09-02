import { AppError, BadRequestError, ValidationError } from "./errors";

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

export function errorToResponse(err: unknown, _debug: boolean): Response {
  if (err instanceof AppError) {
    const showMessage = err.expose;
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
  const h = new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  h.set(
    "Content-Security-Policy",
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
  );
  for (const [key, value] of Object.entries(headers ?? {})) h.set(key, value);
  return new Response(html, { status, headers: h });
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const MAX_BODY_BYTES = 64 * 1024;
  const lenRaw = req.headers.get("content-length");
  if (lenRaw !== null) {
    const n = Number(lenRaw.trim());
    if (!Number.isInteger(n) || n < 0 || n > MAX_BODY_BYTES) throw new BadRequestError("body too large");
  }
  const reader = req.body?.getReader() ?? null;
  let text: string;
  try {
    if (reader === null) {
      text = "";
    } else {
      const decoder = new TextDecoder();
      let received = 0;
      let out = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          void reader.cancel().catch(() => {});
          throw new BadRequestError("body too large");
        }
        out += decoder.decode(value, { stream: true });
      }
      text = out + decoder.decode();
    }
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError("invalid json body");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequestError("invalid json body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError("body must be a json object");
  }
  return parsed as Record<string, unknown>;
}

export function redirect(location: string, status: 302 | 308 = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}
