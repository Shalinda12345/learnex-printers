import "server-only";
import type { PoolClient } from "pg";
import { pool } from "@/lib/server/db";

export interface Actor {
  userId: number | null;
  username: string | null;
}

/** Records who did what. Pass the transaction's client to commit it together with the change. */
export async function audit(
  actor: Actor | null,
  action: string,
  target: string | null = null,
  details: Record<string, unknown> = {},
  client: Pick<PoolClient, "query"> = pool,
) {
  await client.query(
    `INSERT INTO audit_log (user_id, username, action, target, details) VALUES ($1, $2, $3, $4, $5)`,
    [actor?.userId ?? null, actor?.username ?? null, action, target, JSON.stringify(details)],
  );
}
