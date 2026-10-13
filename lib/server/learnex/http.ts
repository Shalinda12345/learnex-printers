import "server-only";
import { BadRequestError } from "@/lib/server/learnex/repository";

// Runs a handler and turns its result / failure into a JSON response.
export async function respond(fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    return Response.json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof BadRequestError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[learnex api]", e);
    return Response.json({ error: `Database error: ${describeError(e)}` }, { status: 500 });
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
