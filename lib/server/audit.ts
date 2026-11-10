import "server-only";
import { pool, type Db } from "@/lib/server/db";

export interface Actor {
  userId: number | null;
  username: string | null;
}

// The target can contain text typed by anyone (e.g. the username of a failed
// sign-in), so it is cut to a sensible size: a log entry is a note, not a store.
const MAX_TARGET = 255;

/** Records who did what. Pass the transaction's connection to commit it together with the change. */
export async function audit(
  actor: Actor | null,
  action: string,
  target: string | null = null,
  details: Record<string, unknown> = {},
  db: Db = pool,
) {
  const shortTarget = target !== null && target.length > MAX_TARGET ? target.slice(0, MAX_TARGET) + "…" : target;
  await db.query(
    `INSERT INTO audit_log (user_id, username, action, target, details) VALUES (?, ?, ?, ?, ?)`,
    [actor?.userId ?? null, actor?.username ?? null, action, shortTarget, JSON.stringify(details)],
  );
  if (action === "auth.login_failed") void pruneFailedLogins();
}

// Failed sign-ins can be sent by anyone, so they are the one kind of entry that is
// not kept forever: after 90 days they go (at most once an hour, a few thousand a time).
const KEEP_FAILED_DAYS = 90;
let lastPrune = 0;
async function pruneFailedLogins() {
  if (Date.now() - lastPrune < 3_600_000) return;
  lastPrune = Date.now();
  await pool
    .query(`DELETE FROM audit_log WHERE action = 'auth.login_failed' AND at < NOW(6) - INTERVAL ? DAY LIMIT 5000`, [
      KEEP_FAILED_DAYS,
    ])
    .catch(() => {});
}
