// Creates the app's MySQL user + database (if missing) and applies every
// pending migration in db/migrations, in filename order.
//
//   npm run db:setup
//
// Needs two connection strings in .env:
//   MYSQL_ADMIN_URL  an administrator login (e.g. root), only used to create the user/database
//   DATABASE_URL     what the app connects with (user, password, database)
//
// MySQL can't roll back schema changes, so a migration that fails part-way
// stays partly applied. The migrations only create what's missing (IF NOT
// EXISTS / OR REPLACE): fix the cause and run this again.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const { DATABASE_URL, MYSQL_ADMIN_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env)");

const app = new URL(DATABASE_URL);
const user = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);
const database = decodeURIComponent(app.pathname.replace(/^\//, ""));

// The same session settings the app uses (lib/server/db.ts).
const SESSION_SETUP =
  "SET SESSION time_zone = '+00:00', sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'";
// A record is saved in one statement together with its attachment (e.g. a
// photo of a bill), which must fit in the server's max_allowed_packet.
const MIN_PACKET = 16 * 1024 * 1024;

if (MYSQL_ADMIN_URL) {
  const adminUrl = new URL(MYSQL_ADMIN_URL);
  adminUrl.pathname = "/";
  // The administrator login must be on the same server, or the app's user and
  // database would be created somewhere the app never connects to.
  const serverOf = (u) => `${u.hostname}:${u.port || 3306}`;
  if (serverOf(adminUrl) !== serverOf(app)) {
    throw new Error(
      `MYSQL_ADMIN_URL (${serverOf(adminUrl)}) and DATABASE_URL (${serverOf(app)}) point at different MySQL servers. ` +
        "For a hosted database whose user and database were created in the host's control panel, remove MYSQL_ADMIN_URL; " +
        "otherwise point both at the same server.",
    );
  }
  const admin = await mysql.createConnection(adminUrl.toString());
  try {
    // A database on this PC is only reachable from this PC; otherwise the
    // app's host isn't known, so its login works from any host.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname);
    const hosts = local ? ["localhost", "127.0.0.1", "::1"] : ["%"];
    for (const host of hosts) {
      const [found] = await admin.query("SELECT 1 FROM mysql.user WHERE user = ? AND host = ?", [user, host]);
      if (!found.length) {
        await admin.query("CREATE USER ?@? IDENTIFIED BY ?", [user, host, password]);
        console.log(`Created user ${user}@${host}`);
      }
    }
    const [dbFound] = await admin.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = ?", [
      database,
    ]);
    if (!dbFound.length) {
      await admin.query(
        `CREATE DATABASE ${mysql.escapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
      );
      console.log(`Created database ${database}`);
    }
    // `_` and `%` are wildcards in a GRANT's database name; escape them so the
    // app's login can reach this database only.
    const grantDb = mysql.escapeId(database.replace(/[_%]/g, "\\$&"));
    for (const host of hosts) await admin.query(`GRANT ALL PRIVILEGES ON ${grantDb}.* TO ?@?`, [user, host]);
  } finally {
    await admin.end();
  }
} else {
  console.log("MYSQL_ADMIN_URL not set — assuming the user and database already exist.");
}

const conn = await mysql.createConnection({ uri: DATABASE_URL, multipleStatements: true });
try {
  await conn.query(SESSION_SETUP);
  const [[{ packet }]] = await conn.query("SELECT @@max_allowed_packet AS packet");
  if (packet < MIN_PACKET) {
    console.warn(
      `Warning: this MySQL server's max_allowed_packet is ${Math.round(packet / 1024)} KB, so saving a ` +
        `record with a large attachment (e.g. a photo of a bill) will fail. Set max_allowed_packet=64M ` +
        `in the [mysqld] section of the server's my.ini / my.cnf (XAMPP: C:\\xampp\\mysql\\bin\\my.ini) ` +
        `and restart MySQL.`,
    );
  }
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       varchar(191) NOT NULL PRIMARY KEY,
    applied_at datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  const [rows] = await conn.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const dir = path.join(import.meta.dirname, "..", "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    try {
      await conn.query(sql);
    } catch (e) {
      throw new Error(`Migration ${file} failed (fix the cause and run db:setup again): ${e.message}`);
    }
    await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
    console.log(`Applied ${file}`);
    count++;
  }
  console.log(count ? `Database ${database} is up to date.` : `Database ${database} was already up to date.`);
} finally {
  await conn.end();
}
