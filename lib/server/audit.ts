import "server-only";
import { pool, type Db } from "@/lib/server/db";

export interface Actor {
  userId: number | null;
  username: string | null;
}

/** Records who did what. Pass the transaction's connection to commit it together with the change. */
export async function audit(
  actor: Actor | null,
  action: string,
  target: string | null = null,
  details: Record<string, unknown> = {},
  db: Db = pool,
) {
  await db.query(
    `INSERT INTO audit_log (user_id, username, action, target, details) VALUES (?, ?, ?, ?, ?)`,
    [actor?.userId ?? null, actor?.username ?? null, action, target, JSON.stringify(details)],
  );
}
