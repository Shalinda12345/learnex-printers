import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import pg from "pg";
import { DATABASE_URL, pool, rows, one, log } from "./helpers.mjs";

after(() => pool.end());

test("DB-1 tests run on the separate test database, not the real one", async () => {
  const { db } = await one("SELECT current_database() AS db");
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
  const tables = (await rows(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map(
    (r) => r.tablename,
  );
  const views = (await rows(`SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY 1`)).map(
    (r) => r.viewname,
  );
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
    SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, confdeltype
    FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text NOT LIKE 'auth\_%' AND conrelid::regclass::text <> 'audit_log' ORDER BY 1`);
  fks.forEach((f) =>
    log(`${f.child} -> ${f.parent} (on delete ${f.confdeltype === "c" ? "cascade" : f.confdeltype})`),
  );
  assert.equal(fks.length, 5);
  assert.ok(fks.every((f) => f.confdeltype === "c"));
});

const ON_DELETE = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };
test("DB-9 account tables are linked safely (sessions/roles go with the user, roles in use can't vanish, the log keeps history)", async () => {
  const fks = await rows(`
    SELECT conrelid::regclass::text AS child, a.attname AS col, confrelid::regclass::text AS parent, confdeltype
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE contype = 'f' AND (conrelid::regclass::text LIKE 'auth\_%' OR conrelid::regclass::text = 'audit_log')
    ORDER BY 1, 2`);
  const got = Object.fromEntries(fks.map((f) => [`${f.child}.${f.col}`, ON_DELETE[f.confdeltype]]));
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
  const idx = await rows(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'auth_users' AND indexdef LIKE '%UNIQUE%lower%'`,
  );
  idx.forEach((i) => log(i.indexdef));
  assert.equal(idx.length, 2);
});

test("DB-5 the app logs in with its own non-superuser role that owns the tables", async () => {
  const me = await one(`SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname = current_user`);
  const owners = await rows(`SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'`);
  log(
    `app role: ${me.u} (superuser: ${me.rolsuper}); table owner(s): ${owners.map((o) => o.tableowner).join(", ")}`,
  );
  assert.equal(me.rolsuper, false);
  assert.deepEqual(
    owners.map((o) => o.tableowner),
    [me.u],
  );
});

test("DB-6 the migration is recorded in schema_migrations", async () => {
  const applied = await rows(`SELECT name, applied_at FROM schema_migrations`);
  applied.forEach((m) => log(m.name, "applied", m.applied_at.toISOString()));
  assert.deepEqual(
    applied.map((m) => m.name),
    ["001_learnex_schema.sql", "002_auth.sql"],
  );
});

test(
  "DB-7 PostgreSQL only accepts network logins from this PC",
  { skip: !process.env.POSTGRES_ADMIN_URL && "POSTGRES_ADMIN_URL not set" },
  async () => {
    const admin = new pg.Client({ connectionString: process.env.POSTGRES_ADMIN_URL });
    await admin.connect();
    try {
      const { rows: listen } = await admin.query("SHOW listen_addresses");
      const { rows: rules } = await admin.query(
        `SELECT type, database, user_name, address, auth_method FROM pg_hba_file_rules WHERE error IS NULL`,
      );
      log("listen_addresses =", listen[0].listen_addresses);
      rules.forEach((r) =>
        log(`pg_hba: ${r.type} ${r.database} ${r.user_name} ${r.address ?? ""} ${r.auth_method}`),
      );
      const remote = rules.filter(
        (r) => r.type.startsWith("host") && !["127.0.0.1", "::1"].includes(r.address),
      );
      assert.deepEqual(remote, [], "no pg_hba rule may allow other machines");
      assert.ok(
        rules.every((r) => r.auth_method !== "trust"),
        "no passwordless logins",
      );
    } finally {
      await admin.end();
    }
  },
);

test(
  "DB-8 PostgreSQL runs as a Windows service that starts automatically",
  { skip: process.platform !== "win32" && "Windows only" },
  () => {
    const state = execFileSync("sc", ["query", "postgresql-x64-17"], { encoding: "utf8" });
    const config = execFileSync("sc", ["qc", "postgresql-x64-17"], { encoding: "utf8" });
    const running = /STATE\s+:\s+4\s+RUNNING/.test(state);
    const auto = /START_TYPE\s+:\s+2\s+AUTO_START/.test(config);
    log(`postgresql-x64-17: running=${running}, auto-start=${auto}`);
    assert.ok(running && auto);
  },
);
