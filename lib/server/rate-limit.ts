import "server-only";
import { HttpError } from "@/lib/server/errors";

/* =====================================================================
   REQUEST LIMITER for the endpoints anyone can reach (sign-in, first-run
   setup) and the password check behind "change password".

   Every attempt costs the server ~0.3 s of CPU and 64 MiB of memory (the
   password hash), so one visitor sending hundreds a minute could make real
   sign-ins crawl. This is a sliding window kept in memory (per server
   instance): at most AUTH_RATE_LIMIT attempts per client in
   AUTH_RATE_WINDOW_SECONDS. Set the limit to 0 to switch it off.

   WHO IS THE CLIENT? The address comes from the X-Forwarded-For header. Next
   fills that header in from the connection only when the request has none, so
   when browsers reach the app directly a client that sends its own header can
   pretend to be someone else, and this limit then only stops senders that don't
   forge it. (There is deliberately no limit shared by everybody, because one
   visitor could use it up and lock everyone out; what bounds the cost of a flood
   is the hashing queue in lib/server/auth/password.ts, and the real protection
   of an account is its lock, which is kept in the database.) Behind a reverse
   proxy or on a host that sets the header (Vercel, see the README) the address
   is reliable; TRUST_PROXY_HOPS says how many proxies are in front (default 1:
   the last address in the list is the one the proxy saw).
===================================================================== */

const intSetting = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const WINDOW_MS = Math.max(1, intSetting("AUTH_RATE_WINDOW_SECONDS", 60)) * 1000;
const PER_CLIENT = intSetting("AUTH_RATE_LIMIT", 20);
const PROXY_HOPS = Math.max(1, intSetting("TRUST_PROXY_HOPS", 1));
const MAX_KEYS = 20_000;

// bucket -> times (ms) of the attempts still inside the window, oldest first
const attempts = new Map<string, number[]>();

/** The address the request came from (see the note above on how far it can be trusted). */
export function clientAddress(request: Request) {
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[Math.max(0, chain.length - PROXY_HOPS)] ?? "unknown";
  return ip.replace(/^::ffff:/i, "").toLowerCase().slice(0, 64);
}

function sweep(now: number) {
  for (const [key, times] of attempts) {
    while (times.length && times[0] <= now - WINDOW_MS) times.shift();
    if (!times.length) attempts.delete(key);
  }
  // still too many distinct clients (someone is inventing addresses): forget the oldest
  for (const key of attempts.keys()) {
    if (attempts.size <= MAX_KEYS) break;
    attempts.delete(key);
  }
}

/**
 * Counts one attempt of `scope` (e.g. "login") by this client, or throws a 429
 * with Retry-After when the client, or everybody together, has used up the window.
 * Refused attempts are not counted, so the block ends when the old ones expire.
 */
export function limitAttempts(scope: string, request: Request) {
  const now = Date.now();
  const buckets: [key: string, max: number][] = [];
  if (PER_CLIENT > 0) buckets.push([`${scope}|${clientAddress(request)}`, PER_CLIENT]);
  // No limit shared by everybody: a visitor could use it up and lock all real users out.
  // The cost of a flood is bounded by the hashing queue in lib/server/auth/password.ts.
  for (const [key, max] of buckets) {
    const times = attempts.get(key);
    if (!times) continue;
    while (times.length && times[0] <= now - WINDOW_MS) times.shift();
    if (times.length >= max) {
      const wait = Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000));
      throw new HttpError(
        429,
        `Too many attempts. Wait ${wait} second${wait === 1 ? "" : "s"} and try again.`,
        "rate_limited",
        { "Retry-After": String(wait) },
      );
    }
  }
  for (const [key] of buckets) {
    const times = attempts.get(key);
    if (times) times.push(now);
    else attempts.set(key, [now]);
  }
  if (attempts.size > MAX_KEYS) sweep(now);
}
