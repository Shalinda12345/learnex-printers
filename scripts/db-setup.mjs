// Creates the app's PostgreSQL role + database (if missing) and applies every
// pending migration in db/migrations, in filename order.
//
//   npm run db:setup
//
// Needs two connection strings in .env:
//   POSTGRES_ADMIN_URL  a superuser login, only used to create the role/database
//   DATABASE_URL        what the app connects with (role, password, database)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { DATABASE_URL, POSTGRES_ADMIN_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env)");

const app = new URL(DATABASE_URL);
const role = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);
const database = app.pathname.replace(/^\//, "");
const ident = (s) => '"' + s.replace(/"/g, '""') + '"';
const literal = (s) => "'" + s.replace(/'/g, "''") + "'";

if (POSTGRES_ADMIN_URL) {
  const adminUrl = new URL(POSTGRES_ADMIN_URL);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount: roleExists } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    if (!roleExists) {
      await admin.query(`CREATE ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)}`);
      console.log(`Created role ${role}`);
    }
    const { rowCount: dbExists } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      database,
    ]);
    if (!dbExists) {
      await admin.query(`CREATE DATABASE ${ident(database)} OWNER ${ident(role)} ENCODING 'UTF8'`);
      console.log(`Created database ${database}`);
    }
  } finally {
    await admin.end();
  }
} else {
  console.log("POSTGRES_ADMIN_URL not set — assuming the role and database already exist.");
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const dir = path.join(import.meta.dirname, "..", "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
      count++;
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
  }
  console.log(count ? `Database ${database} is up to date.` : `Database ${database} was already up to date.`);
} finally {
  await client.end();
}
