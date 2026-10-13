import "server-only";
import { Pool, types, type PoolClient } from "pg";

// DATE columns come back as the plain "YYYY-MM-DD" text the app uses
// everywhere, instead of a JS Date (which would shift with the timezone).
types.setTypeParser(types.builtins.DATE, (v) => v);

// One pool per server process. In dev, hot reloads re-evaluate this module,
// so the pool is kept on globalThis to avoid leaking connections.
const globalForPg = globalThis as unknown as { learnexPool?: Pool };

export const pool =
  globalForPg.learnexPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForPg.learnexPool = pool;

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
