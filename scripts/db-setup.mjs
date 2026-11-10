// Creates the app's MySQL user + database (if missing) and applies every
// pending migration in db/migrations, in filename order.
//
//   npm run db:setup
//
// Needs two connection strings in .env:
//   MYSQL_ADMIN_URL  an administrator login (e.g. root), only used to create the user/database,
//                    give the app's login its rights, and apply the migrations
//   DATABASE_URL     what the app connects with (user, password, database)
//
// The app's login is given only what the running app needs: SELECT, INSERT, UPDATE, DELETE on
// its own database. It cannot drop or alter tables, so a bug (or an attacker who found one) can
// change data but not destroy the database's structure. A database whose name ends in _test
// (the test suite wipes and rebuilds those) gets every right. Migrations are applied with the
// administrator login; without MYSQL_ADMIN_URL they run as the app's login, which then needs
// the right to change tables (a hosted database set up in the host's control panel: restrict
// that login there once the tables exist).
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
if (user.toLowerCase() === "root") {
  console.warn(
    "Warning: DATABASE_URL logs in as root. The app only needs its own database; use a limited account " +
      "(e.g. learnex_app with a strong password) here and keep root in MYSQL_ADMIN_URL only.",
  );
}

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
    const scratch = /_test$/.test(database);
    for (const host of hosts) {
      if (scratch) {
        await admin.query(`GRANT ALL PRIVILEGES ON ${grantDb}.* TO ?@?`, [user, host]);
        continue;
      }
      // take back anything beyond what the app needs (an older setup granted ALL PRIVILEGES) ...
      try {
        await admin.query(`REVOKE ALL PRIVILEGES ON ${grantDb}.* FROM ?@?`, [user, host]);
      } catch (e) {
        if (e.errno !== 1141) throw e; // 1141: it had no grant on this database yet
      }
      // ... and give exactly that
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${grantDb}.* TO ?@?`, [user, host]);
    }
    console.log(scratch ? "Granted all rights (test database)." : "Granted SELECT, INSERT, UPDATE, DELETE only.");
  } finally {
    await admin.end();
  }
} else {
  console.log("MYSQL_ADMIN_URL not set — assuming the user and database already exist.");
}

// Migrations change tables, which the app's own (restricted) login may not do: use the administrator.
const migrationUrl = new URL(MYSQL_ADMIN_URL || DATABASE_URL);
if (MYSQL_ADMIN_URL) migrationUrl.pathname = "/" + encodeURIComponent(database);
const conn = await mysql.createConnection({ uri: migrationUrl.toString(), multipleStatements: true });
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
