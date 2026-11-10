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
      return Response.json(
        { error: e.message, code: e.code },
        { status: e.status, headers: { ...NO_STORE, ...e.headers } },
      );
    }
    // The full error goes to the server's log; the visitor (who may not be signed
    // in) only gets a plain explanation, never SQL, table names, addresses or ports.
    console.error("[learnex api]", loggable(e));
    return Response.json({ error: describeError(e) }, { status: 500, headers: NO_STORE });
  }
}

/**
 * What goes into the server's log for an unexpected failure. A database error from the driver
 * carries the whole SQL statement (with the business data being saved) and a message that can
 * quote parts of it; the log may be read by more people than the data, so for those only the
 * kind of error and where it happened are written. Other failures are our own bugs: logged whole.
 */
function loggable(e: unknown) {
  const err = e as { name?: unknown; code?: unknown; errno?: unknown; sqlState?: unknown; sql?: unknown; stack?: unknown } | null;
  // Not `errno`: Node's own errors (ENOENT, ...) have one too and are not database errors.
  const isDatabaseError =
    !!err &&
    typeof err === "object" &&
    ("sql" in err ||
      "sqlState" in err ||
      (typeof err.code === "string" && /^(ER_|PROTOCOL_|WARN_)/.test(err.code)));
  if (!isDatabaseError) return e;
  // The first lines of a stack are the message (which can span lines and quote SQL or data);
  // only the "at ..." frames are kept.
  const frames =
    typeof err.stack === "string"
      ? err.stack
          .split("\n")
          .filter((l) => /^\s+at\s/.test(l))
          .slice(0, 7)
          .join("\n")
      : "";
  return `database error ${String(err.code ?? "")} (errno ${String(err.errno ?? "?")}, state ${String(err.sqlState ?? "?")}) - details withheld\n${frames}`;
}

// Every error code found in an error and, for a refused connection to
// "localhost" (tried on IPv6 and IPv4: an AggregateError with an empty message),
// in the errors inside it.
function errorCodes(e: unknown, found = new Set<string>(), depth = 0): Set<string> {
  const err = e as { code?: unknown; errors?: unknown[]; cause?: unknown } | null;
  if (!err || typeof err !== "object" || depth > 4) return found;
  if (typeof err.code === "string") found.add(err.code);
  if (Array.isArray(err.errors)) for (const inner of err.errors) errorCodes(inner, found, depth + 1);
  if (err.cause) errorCodes(err.cause, found, depth + 1);
  return found;
}

const CANT_REACH = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
];

/** What to tell the browser about an unexpected failure: the kind of problem, never its details. */
function describeError(e: unknown): string {
  const codes = errorCodes(e);
  const has = (...wanted: string[]) => wanted.some((c) => codes.has(c));
  if (has(...CANT_REACH)) return "Database error: the database server can't be reached. Check that MySQL is running.";
  if (has("ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_NO_PASSWORD_ERROR"))
    return "Database error: the database refused the app's login. Check DATABASE_URL in .env.";
  if (has("ER_BAD_DB_ERROR")) return "Database error: the database doesn't exist yet. Run `npm run db:setup`.";
  if (has("ER_NO_SUCH_TABLE")) return "Database error: the database tables are missing. Run `npm run db:setup`.";
  if (has("ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS"))
    return "Database error: the database is busy. Try again in a moment.";
  if (has("ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK"))
    return "Database error: another change was in progress. Try again.";
  if (has("ER_NET_PACKET_TOO_LARGE"))
    return "Database error: a record is too large for the database (raise max_allowed_packet in my.ini).";
  if (codes.size > 0 && [...codes].some((c) => c.startsWith("ER_") || c.startsWith("PROTOCOL_")))
    return "Database error: the database could not complete the request. Details are in the server's log.";
  return "Server error: something went wrong. Details are in the server's log.";
}

/** How big a JSON request body each kind of endpoint accepts. */
export const BODY_LIMITS = {
  /** sign-in, setup and password change: a few short strings */
  auth: 16 * 1024,
  /** staff accounts, roles */
  admin: 256 * 1024,
  /** saving business data (records can carry photo attachments) */
  data: 64 * 1024 * 1024,
  /** importing or restoring a whole backup */
  import: 256 * 1024 * 1024,
};

const tooLarge = () => new HttpError(413, "That request is too large.", "too_large");

/**
 * Reads the request body as a JSON object, refusing anything bigger than
 * `maxBytes` without reading the rest of it into memory.
 */
export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  let text = "";
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
    text = new TextDecoder().decode(Buffer.concat(chunks));
  }
  try {
    const body = JSON.parse(text);
    if (typeof body === "object" && body !== null) return body;
  } catch {}
  throw new BadRequestError("request body must be a JSON object");
}
