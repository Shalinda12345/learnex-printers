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
// not kept forever: after 90 days they go, and never more than KEEP_FAILED_ROWS of them
// are kept, so a flood cannot fill a small hosted database (at most once an hour, a few
// thousand a time).
const KEEP_FAILED_DAYS = 90;
const KEEP_FAILED_ROWS = 50_000;
let lastPrune = 0;
async function pruneFailedLogins() {
  if (Date.now() - lastPrune < 3_600_000) return;
  lastPrune = Date.now();
  await pool
    .query(`DELETE FROM audit_log WHERE action = 'auth.login_failed' AND at < NOW(6) - INTERVAL ? DAY LIMIT 5000`, [
      KEEP_FAILED_DAYS,
    ])
    .catch(() => {});
  await pool
    .query(
      `DELETE FROM audit_log WHERE action = 'auth.login_failed' AND id <
         (SELECT id FROM (SELECT id FROM audit_log WHERE action = 'auth.login_failed'
                          ORDER BY id DESC LIMIT 1 OFFSET ?) newest) LIMIT 5000`,
      [KEEP_FAILED_ROWS],
    )
    .catch(() => {});
}

// Sign-in failures for names that are not accounts, and attempts on locked accounts, cost
// the attacker nothing, so only so many are written per minute (per server instance); the
// rest are counted and summed up in one entry. Wrong passwords on real accounts are
// always written: the account lock keeps those few.
const FLOOD_PER_MINUTE = 30;
let floodWindowStart = 0;
let floodWritten = 0;
let floodSuppressed = 0;
export async function auditFloodable(
  actor: Actor | null,
  action: string,
  target: string | null,
  details: Record<string, unknown>,
) {
  const now = Date.now();
  if (now - floodWindowStart >= 60_000) {
    const suppressed = floodSuppressed;
    floodWindowStart = now;
    floodWritten = 0;
    floodSuppressed = 0;
    if (suppressed > 0) await audit(null, action, "(many)", { suppressedInPreviousMinute: suppressed });
  }
  if (floodWritten >= FLOOD_PER_MINUTE) {
    floodSuppressed++;
    return;
  }
  floodWritten++;
  await audit(actor, action, target, details);
}
