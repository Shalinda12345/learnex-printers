import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import { DATABASE_URL, pool, rows, one, log } from "./helpers.mjs";

after(() => pool.end());

test("DB-1 tests run on the separate test database, not the real one", async () => {
  const { db } = await one("SELECT DATABASE() AS db");
  log("connected to database:", db);
  assert.match(db, /_test$/);
});

test("DB-2 `npm run db:setup` is safe to re-run (applies nothing twice)", () => {
  const r = spawnSync(process.execPath, ["scripts/db-setup.mjs"], {
    env: { ...process.env, DATABASE_URL },
    encoding: "utf8",
  });
  log(r.stdout.trim().replace(/\n/g, " | "));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already up to date/);
});

test("DB-3 every module table, child table and view exists", async () => {
  const objects = await rows(
    `SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = DATABASE()`,
  );
  const tables = objects
    .filter((o) => o.type === "BASE TABLE")
    .map((o) => o.name)
    .sort();
  const views = objects
    .filter((o) => o.type === "VIEW")
    .map((o) => o.name)
    .sort();
  log(`${tables.length} tables:`, tables.join(", "));
  log(`${views.length} views:`, views.join(", "));
  assert.deepEqual(tables, [
    "app_meta",
    "app_users",
    "audit_log",
    "auth_role_permissions",
    "auth_roles",
    "auth_sessions",
    "auth_user_roles",
    "auth_users",
    "business_settings",
    "cash_accounts",
    "customers",
    "delivery_credit_bills",
    "delivery_run_items",
    "delivery_runs",
    "ledger_entries",
    "products",
    "purchase_order_items",
    "purchase_orders",
    "raw_material_usage",
    "raw_materials",
    "sales_order_items",
    "sales_order_payments",
    "sales_orders",
    "schema_migrations",
    "store_state",
    "suppliers",
  ]);
  assert.deepEqual(views, ["v_ledger", "v_purchase_lines", "v_sales_lines"]);
});

test("DB-4 child tables cascade-delete with their parent record", async () => {
  const fks = await rows(`
    SELECT table_name AS child, referenced_table_name AS parent, delete_rule AS rule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name NOT LIKE 'auth\\_%' AND table_name <> 'audit_log'
    ORDER BY table_name`);
  fks.forEach((f) => log(`${f.child} -> ${f.parent} (on delete ${f.rule.toLowerCase()})`));
  assert.equal(fks.length, 5);
  assert.ok(fks.every((f) => f.rule === "CASCADE"));
});

test("DB-9 account tables are linked safely (sessions/roles go with the user, roles in use can't vanish, the log keeps history)", async () => {
  const fks = await rows(`
    SELECT rc.table_name AS child, k.column_name AS col, rc.delete_rule AS rule
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage k
      ON k.constraint_schema = rc.constraint_schema AND k.table_name = rc.table_name
     AND k.constraint_name = rc.constraint_name
    WHERE rc.constraint_schema = DATABASE() AND (rc.table_name LIKE 'auth\\_%' OR rc.table_name = 'audit_log')`);
  const got = Object.fromEntries(fks.map((f) => [`${f.child}.${f.col}`, f.rule.toLowerCase()]));
  Object.entries(got).forEach(([k, v]) => log(`${k} -> on delete ${v}`));
  assert.deepEqual(got, {
    "audit_log.user_id": "set null",
    "auth_role_permissions.role_id": "cascade",
    "auth_sessions.user_id": "cascade",
    "auth_user_roles.granted_by": "set null",
    "auth_user_roles.role_id": "restrict",
    "auth_user_roles.user_id": "cascade",
    "auth_users.created_by": "set null",
  });
});

test("DB-10 usernames and emails are unique regardless of upper/lower case", async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction(); // rolled back below: nothing is kept
    const add = (username, email) =>
      conn
        .query(`INSERT INTO auth_users (username, name, email, password_hash) VALUES (?, 'x', ?, 'x')`, [
          username,
          email,
        ])
        .then(
          () => "accepted",
          (e) => e.code,
        );
    const results = {
      "CaseTest / Case@Test.lk": await add("CaseTest", "Case@Test.lk"),
      "CASETEST (same username)": await add("CASETEST", null),
      "other / case@TEST.lk (same email)": await add("other", "case@TEST.lk"),
      "noemail1 (no email)": await add("noemail1", null),
      "noemail2 (no email)": await add("noemail2", null),
    };
    Object.entries(results).forEach(([k, v]) => log(`${k} -> ${v}`));
    assert.deepEqual(Object.values(results), [
      "accepted",
      "ER_DUP_ENTRY",
      "ER_DUP_ENTRY",
      "accepted",
      "accepted",
    ]);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test("DB-5 the app logs in with its own account, which can only reach the app's databases", async () => {
  const { me, db } = await one(`SELECT CURRENT_USER() AS me, DATABASE() AS db`);
  const at = me.lastIndexOf("@");
  const grantee = `'${me.slice(0, at)}'@'${me.slice(at + 1)}'`;
  const serverWide = (
    await rows(`SELECT privilege_type AS p FROM information_schema.user_privileges WHERE grantee = ?`, [
      grantee,
    ])
  ).map((r) => r.p);
  // Granted database names escape the `_` wildcard ("hashil\_test").
  const databases = [
    ...new Set(
      (
        await rows(`SELECT table_schema AS s FROM information_schema.schema_privileges WHERE grantee = ?`, [
          grantee,
        ])
      ).map((r) => r.s.replace(/\\(.)/g, "$1")),
    ),
  ];
  log(
    `app login: ${me}; server-wide privileges: ${serverWide.join(", ")}; databases: ${databases.join(", ")}`,
  );
  assert.notEqual(me.slice(0, at), "root");
  assert.deepEqual(serverWide, ["USAGE"]);
  // The same login also uses the real database ("hashil" next to "hashil_test").
  const appDatabases = [db, db.replace(/_test$/, "")];
  assert.ok(databases.includes(db));
  assert.deepEqual(
    databases.filter((d) => !appDatabases.includes(d)),
    [],
    "no other databases",
  );
});

test("DB-6 the migration is recorded in schema_migrations", async () => {
  const applied = await rows(`SELECT name, applied_at FROM schema_migrations ORDER BY name`);
  applied.forEach((m) => log(m.name, "applied", m.applied_at.toISOString()));
  assert.deepEqual(
    applied.map((m) => m.name),
    ["001_learnex_schema.sql", "002_auth.sql"],
  );
});

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];
const PASSWORD_PLUGINS = ["", "mysql_native_password", "caching_sha2_password", "sha256_password"];
test(
  "DB-7 MySQL only accepts logins from this PC, and every login needs a password",
  { skip: !process.env.MYSQL_ADMIN_URL && "MYSQL_ADMIN_URL not set" },
  async () => {
    const adminUrl = new URL(process.env.MYSQL_ADMIN_URL);
    adminUrl.pathname = "/";
    const admin = await mysql.createConnection(adminUrl.toString());
    try {
      const [[net]] = await admin.query("SELECT @@bind_address AS bind, @@skip_networking AS skip");
      const [accounts] = await admin.query("SELECT * FROM mysql.user");
      log(`bind_address = ${net.bind ?? "(all interfaces)"}; skip_networking = ${net.skip}`);
      const logins = accounts
        // MariaDB lists roles here; MySQL's built-in system accounts are locked.
        .filter((a) => a.is_role !== "Y" && a.account_locked !== "Y")
        .filter((a) => !/^(mariadb\.sys|mysql\.(sys|session|infoschema))$/.test(a.User));
      logins.forEach((a) =>
        log(
          `account ${a.User}@${a.Host} (${a.plugin || "default"}${a.authentication_string ? "" : ", no password"})`,
        ),
      );
      const localOnly =
        !!net.skip || (!!net.bind && net.bind.split(",").every((b) => LOCAL_HOSTS.includes(b.trim())));
      assert.ok(localOnly, "the server must only listen on this PC (bind-address=127.0.0.1)");
      assert.deepEqual(
        logins.filter((a) => !LOCAL_HOSTS.includes(a.Host)).map((a) => `${a.User}@${a.Host}`),
        [],
        "no account may log in from other machines",
      );
      assert.deepEqual(
        logins
          .filter((a) => !a.authentication_string && PASSWORD_PLUGINS.includes(a.plugin))
          .map((a) => `${a.User}@${a.Host}`),
        [],
        "no passwordless logins",
      );
    } finally {
      await admin.end();
    }
  },
);

test(
  "DB-8 MySQL runs as a Windows service that starts automatically",
  { skip: process.platform !== "win32" && "Windows only" },
  () => {
    const names = execFileSync("sc", ["query", "type=", "service", "state=", "all"], { encoding: "utf8" })
      .split("\n")
      .map((l) => /^SERVICE_NAME:\s*(.+)$/.exec(l.trim())?.[1])
      .filter((name) => name && /mysql|mariadb/i.test(name));
    const services = names.map((name) => ({
      name,
      running: /STATE\s+:\s+4\s+RUNNING/.test(execFileSync("sc", ["query", name], { encoding: "utf8" })),
      auto: /START_TYPE\s+:\s+2\s+AUTO_START/.test(execFileSync("sc", ["qc", name], { encoding: "utf8" })),
    }));
    if (!services.length) log("no MySQL / MariaDB Windows service is installed");
    services.forEach((s) => log(`${s.name}: running=${s.running}, auto-start=${s.auto}`));
    assert.ok(services.some((s) => s.running && s.auto));
  },
);
