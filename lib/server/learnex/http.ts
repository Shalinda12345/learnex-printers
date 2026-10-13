import "server-only";
import { BadRequestError, HttpError } from "@/lib/server/errors";

// API responses carry business and account data: never cache them.
const NO_STORE = { "Cache-Control": "no-store" };

// Runs a handler and turns its result / failure into a JSON response.
export async function respond(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return Response.json(result ?? { ok: true }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof HttpError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
    }
    console.error("[learnex api]", e);
    return Response.json(
      { error: `Database error: ${describeError(e)}` },
      { status: 500, headers: NO_STORE },
    );
  }
}

// A refused connection to "localhost" (tried on IPv6 and IPv4) arrives as an
// AggregateError with an empty message, so fall back to its inner errors.
function describeError(e: unknown): string {
  const err = e as { message?: string; code?: string; errors?: unknown[] } | null;
  if (err?.message) return err.message;
  if (Array.isArray(err?.errors) && err.errors.length) return err.errors.map(describeError).join("; ");
  return err?.code || String(e);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (typeof body === "object" && body !== null) return body;
  } catch {}
  throw new BadRequestError("request body must be a JSON object");
}
