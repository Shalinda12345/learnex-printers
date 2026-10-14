import "server-only";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

/** The pool, or a connection inside a transaction. */
export type Db = Pick<PoolConnection, "query">;

// Every connection works in UTC (DATETIME columns hold UTC times) and in
// strict mode, so a value that doesn't fit its column is an error instead of
// being silently cut. Setting sql_mode also drops the IGNORE_SPACE mode
// mysql2 asks for, which would make names like `position` reserved words.
const SESSION_SETUP =
  "SET SESSION time_zone = '+00:00', sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'";

function createPool() {
  const pool = mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 10,
    timezone: "Z",
    // DATE columns come back as the plain "YYYY-MM-DD" text the app uses
    // everywhere, instead of a JS Date (which would shift with the timezone).
    dateStrings: ["DATE"],
    // JSON columns come back as text, parsed where they're read (MariaDB
    // stores JSON as text, so this behaves the same on MySQL and MariaDB).
    jsonStrings: true,
    // A BIGINT too big for a JS number comes back as a string, never rounded.
    supportBigNumbers: true,
    // An object passed as a query value is never expanded into SQL.
    stringifyObjects: true,
    // BOOLEAN columns are TINYINT(1) in MySQL: return them as true/false.
    typeCast: (field, next) => {
      if (field.type !== "TINY" || field.length !== 1) return next();
      const v = next();
      return v === null ? null : v === 1;
    },
  });
  pool.pool.on("connection", (conn) => {
    conn.query(SESSION_SETUP, (err) => {
      if (err) console.error("[db] could not set up a new connection", err);
    });
  });
  return pool;
}

// One pool per server process. In dev, hot reloads re-evaluate this module,
// so the pool is kept on globalThis to avoid leaking connections.
const globalForDb = globalThis as unknown as { learnexPool?: Pool };

export const pool = globalForDb.learnexPool ?? createPool();

if (process.env.NODE_ENV !== "production") globalForDb.learnexPool = pool;

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    // If the connection itself failed, rolling back fails too: drop the
    // connection (the server discards the transaction) and report the
    // original error.
    await conn.rollback().catch(() => conn.destroy());
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Runs `fn` while holding a named lock in this database, so callers using the
 * same name take turns. Unlike a table lock it survives the transactions `fn`
 * runs, and is released when `fn` finishes.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT GET_LOCK(CONCAT(DATABASE(), '.', ?), 10) AS locked",
      [name],
    );
    if (!rows[0].locked) throw new Error(`Timed out waiting for the "${name}" lock`);
    try {
      return await fn();
    } finally {
      // If this fails the connection is gone, and the server dropped the lock with it.
      await conn.query("DO RELEASE_LOCK(CONCAT(DATABASE(), '.', ?))", [name]).catch(() => conn.destroy());
    }
  } finally {
    conn.release();
  }
}
